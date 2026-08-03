/**
 * Unwraps Palworld's .sav container down to the raw GVAS bytes.
 *
 * Two container formats exist in the wild:
 *   PlZ  - zlib, used up to game version 0.5.x
 *   PlM  - Oodle Kraken, used from 0.6 onward (including 1.0)
 * Either may additionally be wrapped in a CNK header on Xbox/Game Pass saves.
 *
 * Inflation goes through the platform's DecompressionStream, which exists both in browsers
 * and in Node 18+, so this module needs no Node built-ins at all.
 */

export type SaveContainer = 'PlZ' | 'PlM';

export interface DecompressedSave {
  gvas: Uint8Array;
  /** Container magic, which also tells you which game era wrote the save. */
  container: SaveContainer;
  /** 0x30 CNK, 0x31 single-zlib or Oodle, 0x32 double-zlib. */
  saveType: number;
  /** True when the payload sat behind an extra Xbox CNK header. */
  chunked: boolean;
}

const MAGIC_PLZ = 'PlZ';
const MAGIC_PLM = 'PlM';
const MAGIC_CNK = 'CNK';

interface SavHeader {
  uncompressedLen: number;
  compressedLen: number;
  magic: string;
  saveType: number;
  dataOffset: number;
  chunked: boolean;
}

function magicAt(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset]!, data[offset + 1]!, data[offset + 2]!);
}

function parseHeader(data: Uint8Array): SavHeader {
  if (data.length < 24) {
    throw new Error('File is too small to be a Palworld save (need at least 24 bytes).');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let uncompressedLen = view.getUint32(0, true);
  let compressedLen = view.getUint32(4, true);
  let magic = magicAt(data, 8);
  let saveType = data[11]!;
  let dataOffset = 12;
  let chunked = false;

  if (magic === MAGIC_CNK) {
    // Xbox/Game Pass container: the real header starts 12 bytes in.
    uncompressedLen = view.getUint32(12, true);
    compressedLen = view.getUint32(16, true);
    magic = magicAt(data, 20);
    saveType = data[23]!;
    dataOffset = 24;
    chunked = true;
  }

  if (magic !== MAGIC_PLZ && magic !== MAGIC_PLM) {
    if (magic === '\0\0\0' && uncompressedLen === 0 && compressedLen === 0) {
      throw new Error('Not a Palworld save: the file is all null bytes and is likely corrupted.');
    }
    throw new Error(
      `Not a compressed Palworld save: found magic ${JSON.stringify(magic)}, expected "PlZ" or "PlM". ` +
        `Make sure you picked Level.sav and not a different file.`,
    );
  }
  return { uncompressedLen, compressedLen, magic, saveType, dataOffset, chunked };
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // Fed through a ReadableStream rather than a Blob: it avoids copying the whole
  // compressed payload, and sidesteps Blob's requirement that views be backed by a
  // non-shared ArrayBuffer.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  // TypeScript 5.7 splits typed arrays into Uint8Array<ArrayBuffer> vs <ArrayBufferLike>,
  // and the DOM's DecompressionStream is declared over the narrower BufferSource. The two
  // are identical at runtime, so the mismatch is erased here rather than infecting every
  // byte-handling signature in the codebase.
  const inflated = source.pipeThrough(
    new DecompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = inflated.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Oodle decoding is a WASM blob that only PlM saves need, so it is imported lazily. That
 * keeps it out of the initial page load for anyone opening an older zlib save.
 */
let oozPromise: Promise<{ decompress(data: Uint8Array, rawSize: number): Uint8Array }> | null = null;
function loadOoz() {
  if (!oozPromise) {
    oozPromise = import('ooz-wasm').catch((err) => {
      oozPromise = null;
      throw new Error(
        `This is a PlM (Oodle-compressed) save from Palworld 0.6+, and the Oodle decoder ` +
          `failed to load. In a browser this usually means WebAssembly SIMD is unavailable.\n` +
          `Original error: ${String(err)}`,
      );
    });
  }
  return oozPromise;
}

export async function decompressSav(data: Uint8Array): Promise<DecompressedSave> {
  const header = parseHeader(data);
  const { magic, saveType, dataOffset, compressedLen, uncompressedLen } = header;
  const container: SaveContainer = magic === MAGIC_PLZ ? 'PlZ' : 'PlM';

  let gvas: Uint8Array;

  if (container === 'PlM') {
    // Oodle payload: one Kraken block whose decompressed length is in the header.
    const ooz = await loadOoz();
    const payload = data.subarray(dataOffset, dataOffset + compressedLen);
    gvas = ooz.decompress(payload, uncompressedLen);
  } else {
    if (saveType !== 0x30 && saveType !== 0x31 && saveType !== 0x32) {
      throw new Error(`Unknown save type: 0x${saveType.toString(16)}`);
    }
    if (saveType === 0x30) {
      throw new Error(`Unhandled compression type: 0x${saveType.toString(16)}`);
    }
    if (saveType === 0x31 && compressedLen !== data.length - dataOffset) {
      throw new Error(
        `Incorrect compressed length: header says ${compressedLen}, file has ${data.length - dataOffset}.`,
      );
    }
    gvas = await inflate(data.subarray(dataOffset));
    if (saveType === 0x32) {
      // Double-compressed: the first inflate yields the still-compressed payload.
      if (compressedLen !== gvas.length) {
        throw new Error(
          `Incorrect compressed length: header says ${compressedLen}, got ${gvas.length}.`,
        );
      }
      gvas = await inflate(gvas);
    }
  }

  if (uncompressedLen !== gvas.length) {
    throw new Error(
      `Incorrect uncompressed length: header says ${uncompressedLen}, got ${gvas.length}. ` +
        `The save may be truncated or corrupted.`,
    );
  }
  return { gvas, container, saveType, chunked: header.chunked };
}

/** Cheap format probe that does not decompress. Useful for error messages up front. */
export function inspectSav(data: Uint8Array): { container: SaveContainer; saveType: number } | null {
  try {
    const h = parseHeader(data);
    return { container: h.magic as SaveContainer, saveType: h.saveType };
  } catch {
    return null;
  }
}
