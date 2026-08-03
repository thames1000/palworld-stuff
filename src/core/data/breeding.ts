/**
 * The two big breeding matrices, kept apart from the rest of the game data.
 *
 * Together these are around 440 kB of packed data that only the solver needs. Importing
 * them from a separate module means a UI bundle that just wants species and passive names
 * never has to download or decode them.
 */
import { BREEDING_MATRIX_PACKED, MATRIX_SIZE, MIN_STEPS_PACKED } from './matrices.js';
import { MECHANICS } from './index.js';

/**
 * Unpacks a base64 little-endian int16 square matrix into per-row views.
 *
 * Decoded through an explicit DataView rather than casting the byte buffer to an
 * Int16Array, so the result does not depend on the host being little-endian.
 */
function unpackMatrix(packed: string, n: number): Int16Array[] {
  const binary = atob(packed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const rows: Int16Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Int16Array(n);
    for (let j = 0; j < n; j++) row[j] = view.getInt16((i * n + j) * 2, true);
    rows[i] = row;
  }
  return rows;
}

/** `BREEDING_MATRIX[a][b]` is the species index produced by breeding a with b. */
export const BREEDING_MATRIX: readonly Int16Array[] = unpackMatrix(
  BREEDING_MATRIX_PACKED,
  MATRIX_SIZE,
);

/**
 * `MIN_BREEDING_STEPS[a][b]` is the fewest breeding steps to get from species a to b,
 * ignoring passives and IVs. Used as an admissible heuristic and for fast reachability
 * checks. Equal to `MECHANICS.unreachableSentinel` when no route exists.
 */
export const MIN_BREEDING_STEPS: readonly Int16Array[] = unpackMatrix(
  MIN_STEPS_PACKED,
  MATRIX_SIZE,
);

/** The child species produced by breeding two species, or -1 if the pair cannot breed. */
export function breedingResult(a: number, b: number): number {
  return BREEDING_MATRIX[a]?.[b] ?? -1;
}

export function isReachable(from: number, to: number): boolean {
  return (
    (MIN_BREEDING_STEPS[from]?.[to] ?? MECHANICS.unreachableSentinel) <
    MECHANICS.unreachableSentinel
  );
}

export function minBreedingSteps(from: number, to: number): number {
  return MIN_BREEDING_STEPS[from]?.[to] ?? MECHANICS.unreachableSentinel;
}
