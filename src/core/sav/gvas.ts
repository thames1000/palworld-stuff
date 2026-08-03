/** GVAS is Unreal Engine's save-game format; it sits inside the decompressed .sav payload. */
import { FArchiveReader, type CustomPropertyDecoder, type PathFilter, type Properties } from './reader.js';

export interface GvasHeader {
  magic: number;
  saveGameVersion: number;
  packageFileVersionUe4: number;
  packageFileVersionUe5: number;
  engineVersionMajor: number;
  engineVersionMinor: number;
  engineVersionPatch: number;
  engineVersionChangelist: number;
  engineVersionBranch: string;
  customVersionFormat: number;
  customVersions: Array<[string, number]>;
  saveGameClassName: string;
}

/** "GVAS" as a little-endian int32. */
const GVAS_MAGIC = 0x53415647;

export function readGvasHeader(r: FArchiveReader): GvasHeader {
  const magic = r.i32();
  if (magic !== GVAS_MAGIC) {
    throw new Error('Invalid GVAS magic: the decompressed payload is not an Unreal save.');
  }
  const saveGameVersion = r.i32();
  if (saveGameVersion !== 3) {
    throw new Error(`Expected GVAS save game version 3, got ${saveGameVersion}`);
  }
  const header: GvasHeader = {
    magic,
    saveGameVersion,
    packageFileVersionUe4: r.i32(),
    packageFileVersionUe5: r.i32(),
    engineVersionMajor: r.u16(),
    engineVersionMinor: r.u16(),
    engineVersionPatch: r.u16(),
    engineVersionChangelist: r.u32(),
    engineVersionBranch: r.fstring(),
    customVersionFormat: 0,
    customVersions: [],
    saveGameClassName: '',
  };
  header.customVersionFormat = r.i32();
  if (header.customVersionFormat !== 3) {
    throw new Error(`Expected custom version format 3, got ${header.customVersionFormat}`);
  }
  header.customVersions = r.tarray((rr) => [rr.guid(), rr.i32()] as [string, number]);
  header.saveGameClassName = r.fstring();
  return header;
}

export interface GvasFile {
  header: GvasHeader;
  properties: Properties;
  /** Non-empty trailer usually means the property tree did not fully parse. */
  trailerLength: number;
}

export function readGvas(
  data: Uint8Array,
  opts: {
    typeHints?: Record<string, string>;
    customProperties?: Record<string, CustomPropertyDecoder>;
    shouldParse?: PathFilter;
  } = {},
): GvasFile {
  const r = new FArchiveReader(data, opts);
  const header = readGvasHeader(r);
  const properties = r.propertiesUntilEnd();
  const trailer = r.readToEnd();
  return { header, properties, trailerLength: trailer.length };
}
