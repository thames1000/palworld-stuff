/**
 * Reader for Unreal Engine's FArchive serialization as Palworld writes it.
 *
 * Ported from cheahjs/palworld-save-tools (MIT), which is the reference implementation for
 * this format. Kept deliberately close to the original so it stays easy to diff against
 * upstream when a game patch changes the layout.
 *
 * Uses only Uint8Array / DataView / TextDecoder, so the same code runs unchanged in Node
 * and in a browser Web Worker.
 */

/** Parsed property trees are heterogeneous by nature; callers narrow as needed. */
export type PropertyValue = any;
export type Properties = Record<string, PropertyValue>;

/**
 * Decides whether to fully parse a property or skip its bytes.
 *
 * Level.sav is dominated by data PalForge never looks at (foliage, map objects, work
 * assignments). Skipping those by their recorded byte length turns a multi-minute parse
 * into a few seconds, so this is a correctness-neutral but essential optimization.
 */
export type PathFilter = (path: string) => boolean;

const utf16Decoder = new TextDecoder('utf-16le');

/** Chunk size for building single-byte strings without blowing the call stack. */
const FROM_CHAR_CODE_CHUNK = 4096;

export class FArchiveReader {
  readonly buf: Uint8Array;
  readonly size: number;
  offset: number;
  private readonly view: DataView;
  private readonly typeHints: Record<string, string>;
  private readonly customProperties: Record<string, CustomPropertyDecoder>;
  private readonly shouldParse: PathFilter;

  constructor(
    buf: Uint8Array,
    opts: {
      typeHints?: Record<string, string>;
      customProperties?: Record<string, CustomPropertyDecoder>;
      shouldParse?: PathFilter;
    } = {},
  ) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.offset = 0;
    this.size = buf.byteLength;
    this.typeHints = opts.typeHints ?? {};
    this.customProperties = opts.customProperties ?? {};
    this.shouldParse = opts.shouldParse ?? (() => true);
  }

  /** A reader over a nested byte blob, inheriting hints and custom decoders. */
  internalCopy(buf: Uint8Array): FArchiveReader {
    return new FArchiveReader(buf, {
      typeHints: this.typeHints,
      customProperties: this.customProperties,
      shouldParse: this.shouldParse,
    });
  }

  eof(): boolean {
    return this.offset >= this.size;
  }

  private require(n: number): void {
    if (this.offset + n > this.size) {
      throw new Error(
        `read past end of archive: wanted ${n} bytes at ${this.offset}, size ${this.size}`,
      );
    }
  }

  read(n: number): Uint8Array {
    this.require(n);
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  readToEnd(): Uint8Array {
    return this.read(this.size - this.offset);
  }

  skip(n: number): void {
    this.require(n);
    this.offset += n;
  }

  byte(): number {
    this.require(1);
    return this.buf[this.offset++]!;
  }

  bool(): boolean {
    return this.byte() > 0;
  }

  i16(): number {
    this.require(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u16(): number {
    this.require(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i32(): number {
    this.require(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u32(): number {
    this.require(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Returned as a JS number; Palworld's 64-bit fields stay well inside 2^53. */
  i64(): number {
    this.require(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return Number(v);
  }

  u64(): number {
    this.require(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return Number(v);
  }

  float(): number {
    this.require(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  double(): number {
    this.require(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  byteList(n: number): Uint8Array {
    return this.read(n).slice();
  }

  /**
   * True latin1 decode: one byte, one code point.
   *
   * Deliberately not TextDecoder('latin1'), which the encoding spec aliases to
   * windows-1252 and which therefore remaps 0x80-0x9F. Upstream treats these bytes as
   * ASCII, so a faithful byte-for-byte mapping is the closest match and never throws on
   * high bytes in player-supplied names.
   */
  private latin1(length: number): string {
    const start = this.offset;
    this.offset += length;
    const end = start + length;
    if (length <= FROM_CHAR_CODE_CHUNK) {
      return String.fromCharCode(...this.buf.subarray(start, end));
    }
    let out = '';
    for (let i = start; i < end; i += FROM_CHAR_CODE_CHUNK) {
      out += String.fromCharCode(...this.buf.subarray(i, Math.min(i + FROM_CHAR_CODE_CHUNK, end)));
    }
    return out;
  }

  /**
   * UE length-prefixed string. A negative length means UTF-16LE and the magnitude counts
   * code units, not bytes. Both encodings include a trailing null that is dropped here.
   */
  fstring(): string {
    const size = this.i32();
    if (size === 0) return '';
    if (size < 0) {
      const units = -size;
      const data = this.read(units * 2);
      return utf16Decoder.decode(data.subarray(0, data.length - 2));
    }
    this.require(size);
    return this.latin1(size).slice(0, -1); // drop the trailing null
  }

  /**
   * Palworld stores GUIDs in a byte order that is neither big- nor little-endian for the
   * whole value; this mirrors upstream's formatting exactly so IDs match other tools.
   */
  guid(): string {
    const b = this.read(16);
    const hex8 = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
    const hex4 = (v: number) => (v & 0xffff).toString(16).padStart(4, '0');
    return [
      hex8(((b[3]! << 24) | (b[2]! << 16) | (b[1]! << 8) | b[0]!) >>> 0),
      hex4((b[7]! << 8) | b[6]!),
      hex4((b[5]! << 8) | b[4]!),
      hex4((b[0xb]! << 8) | b[0xa]!),
      hex4((b[9]! << 8) | b[8]!) +
        hex8(((b[0xf]! << 24) | (b[0xe]! << 16) | (b[0xd]! << 8) | b[0xc]!) >>> 0),
    ].join('-');
  }

  optionalGuid(): string | null {
    return this.byte() ? this.guid() : null;
  }

  tarray<T>(readItem: (r: FArchiveReader) => T): T[] {
    const count = this.u32();
    const out: T[] = new Array(count);
    for (let i = 0; i < count; i++) out[i] = readItem(this);
    return out;
  }

  private getTypeOr(path: string, fallback: string): string {
    return this.typeHints[path] ?? fallback;
  }

  propertiesUntilEnd(path = ''): Properties {
    const properties: Properties = {};
    for (;;) {
      const name = this.fstring();
      if (name === 'None') break;
      const typeName = this.fstring();
      const size = this.u64();
      properties[name] = this.property(typeName, size, `${path}.${name}`);
    }
    return properties;
  }

  property(typeName: string, size: number, path: string, nestedCallerPath = ''): PropertyValue {
    const custom = this.customProperties[path];
    if (custom && (path !== nestedCallerPath || nestedCallerPath === '')) {
      const value = custom(this, typeName, size, path);
      value.custom_type = path;
      value.type = typeName;
      return value;
    }

    // Skipping is only safe for the container types, whose value region is exactly `size`
    // bytes after a fixed preamble. Scalars are cheap, so they are always parsed.
    if (
      !this.shouldParse(path) &&
      (typeName === 'StructProperty' || typeName === 'ArrayProperty' || typeName === 'MapProperty')
    ) {
      return this.skipProperty(typeName, size);
    }

    let value: PropertyValue;
    switch (typeName) {
      case 'StructProperty':
        value = this.struct(path);
        break;
      case 'IntProperty':
        value = { id: this.optionalGuid(), value: this.i32() };
        break;
      case 'UInt16Property':
        value = { id: this.optionalGuid(), value: this.u16() };
        break;
      case 'UInt32Property':
        value = { id: this.optionalGuid(), value: this.u32() };
        break;
      case 'Int64Property':
        value = { id: this.optionalGuid(), value: this.i64() };
        break;
      case 'FixedPoint64Property':
        value = { id: this.optionalGuid(), value: this.i32() };
        break;
      case 'FloatProperty':
        value = { id: this.optionalGuid(), value: this.float() };
        break;
      case 'DoubleProperty':
        value = { id: this.optionalGuid(), value: this.double() };
        break;
      case 'StrProperty':
        value = { id: this.optionalGuid(), value: this.fstring() };
        break;
      case 'NameProperty':
        value = { id: this.optionalGuid(), value: this.fstring() };
        break;
      case 'EnumProperty': {
        const enumType = this.fstring();
        const id = this.optionalGuid();
        const enumValue = this.fstring();
        value = { id, value: { type: enumType, value: enumValue } };
        break;
      }
      case 'BoolProperty':
        value = { value: this.bool(), id: this.optionalGuid() };
        break;
      case 'ByteProperty': {
        const enumType = this.fstring();
        const id = this.optionalGuid();
        const enumValue = enumType === 'None' ? this.byte() : this.fstring();
        value = { id, value: { type: enumType, value: enumValue } };
        break;
      }
      case 'ArrayProperty': {
        const arrayType = this.fstring();
        value = {
          array_type: arrayType,
          id: this.optionalGuid(),
          value: this.arrayProperty(arrayType, size - 4, path),
        };
        break;
      }
      case 'MapProperty': {
        const keyType = this.fstring();
        const valueType = this.fstring();
        const id = this.optionalGuid();
        this.u32();
        const count = this.u32();
        const keyPath = `${path}.Key`;
        const valuePath = `${path}.Value`;
        const keyStructType = keyType === 'StructProperty' ? this.getTypeOr(keyPath, 'Guid') : null;
        const valueStructType =
          valueType === 'StructProperty' ? this.getTypeOr(valuePath, 'StructProperty') : null;
        const values: Array<{ key: PropertyValue; value: PropertyValue }> = new Array(count);
        for (let i = 0; i < count; i++) {
          const key = this.propValue(keyType, keyStructType, keyPath);
          const val = this.propValue(valueType, valueStructType, valuePath);
          values[i] = { key, value: val };
        }
        value = {
          key_type: keyType,
          value_type: valueType,
          key_struct_type: keyStructType,
          value_struct_type: valueStructType,
          id,
          value: values,
        };
        break;
      }
      default:
        throw new Error(`Unknown property type: ${typeName} (${path})`);
    }
    value.type = typeName;
    return value;
  }

  /** Consumes a container property's preamble then jumps over its `size`-byte body. */
  private skipProperty(typeName: string, size: number): PropertyValue {
    if (typeName === 'StructProperty') {
      const structType = this.fstring();
      this.skip(16); // struct id
      this.optionalGuid();
      this.skip(size);
      return { type: typeName, struct_type: structType, skipped: true };
    }
    if (typeName === 'ArrayProperty') {
      const arrayType = this.fstring();
      this.optionalGuid();
      this.skip(size);
      return { type: typeName, array_type: arrayType, skipped: true };
    }
    // MapProperty
    const keyType = this.fstring();
    const valueType = this.fstring();
    this.optionalGuid();
    this.skip(size);
    return { type: typeName, key_type: keyType, value_type: valueType, skipped: true };
  }

  private propValue(typeName: string, structTypeName: string | null, path: string): PropertyValue {
    switch (typeName) {
      case 'StructProperty':
        return this.structValue(structTypeName ?? 'StructProperty', path);
      case 'EnumProperty':
      case 'NameProperty':
      case 'StrProperty':
        return this.fstring();
      case 'IntProperty':
        return this.i32();
      case 'Int64Property':
        return this.i64();
      case 'FloatProperty':
        return this.float();
      case 'BoolProperty':
        return this.bool();
      default:
        throw new Error(`Unknown property value type: ${typeName} (${path})`);
    }
  }

  private struct(path: string): PropertyValue {
    const structType = this.fstring();
    const structId = this.guid();
    const id = this.optionalGuid();
    const value = this.structValue(structType, path);
    return { struct_type: structType, struct_id: structId, id, value };
  }

  structValue(structType: string, path = ''): PropertyValue {
    switch (structType) {
      case 'Vector':
        return { x: this.double(), y: this.double(), z: this.double() };
      case 'DateTime':
        return this.u64();
      case 'Guid':
        return this.guid();
      case 'Quat':
        return { x: this.double(), y: this.double(), z: this.double(), w: this.double() };
      case 'LinearColor':
        return { r: this.float(), g: this.float(), b: this.float(), a: this.float() };
      default:
        return this.propertiesUntilEnd(path);
    }
  }

  private arrayProperty(arrayType: string, size: number, path: string): PropertyValue {
    const count = this.u32();
    if (arrayType === 'StructProperty') {
      const propName = this.fstring();
      const propType = this.fstring();
      this.u64();
      const typeName = this.fstring();
      const id = this.guid();
      this.skip(1);
      const values: PropertyValue[] = new Array(count);
      for (let i = 0; i < count; i++) values[i] = this.structValue(typeName, `${path}.${propName}`);
      return { prop_name: propName, prop_type: propType, values, type_name: typeName, id };
    }
    return { values: this.arrayValue(arrayType, count, size, path) };
  }

  private arrayValue(arrayType: string, count: number, size: number, path: string): PropertyValue {
    switch (arrayType) {
      case 'EnumProperty':
      case 'NameProperty':
      case 'StrProperty': {
        const out: string[] = new Array(count);
        for (let i = 0; i < count; i++) out[i] = this.fstring();
        return out;
      }
      case 'Guid': {
        const out: string[] = new Array(count);
        for (let i = 0; i < count; i++) out[i] = this.guid();
        return out;
      }
      case 'ByteProperty':
        if (size === count) return this.byteList(count);
        throw new Error(`Labelled ByteProperty not implemented (${path})`);
      default:
        throw new Error(`Unknown array type: ${arrayType} (${path})`);
    }
  }
}

export type CustomPropertyDecoder = (
  reader: FArchiveReader,
  typeName: string,
  size: number,
  path: string,
) => PropertyValue;

export function instanceIdReader(r: FArchiveReader): { guid: string; instance_id: string } {
  return { guid: r.guid(), instance_id: r.guid() };
}

export function uuidReader(r: FArchiveReader): string {
  return r.guid();
}
