/**
 * Regenerates src/core/data/tables.ts from PalCalc's datamined dataset.
 *
 * PalCalc extracts these tables straight from the game's .pak files, so they track real
 * in-game behaviour including the special/unique combos. We deliberately do NOT compute
 * breeding results from a BreedingPower formula -- Palworld's real breeding math is not a
 * simple average of the two parents, and a formula gets a large fraction of pairs wrong.
 * The full datamined pair table is the source of truth.
 *
 *   npm run gen-data
 *   PALCALC_CACHE=/path/to/dir npm run gen-data
 *
 * Output is a .ts module rather than JSON so that Node, tsx, and the browser bundler all
 * consume it identically -- no fs, no fetch, no JSON import attributes. The two 288x288
 * matrices are base64-packed little-endian int16 to keep the file small and quick to parse.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'src', 'core', 'data');
const OUT_FILE = join(OUT_DIR, 'tables.ts');
const MATRIX_FILE = join(OUT_DIR, 'matrices.ts');
const RAW = 'https://raw.githubusercontent.com/tylercamp/palcalc/main/PalCalc.Model';

/** Sentinel PalCalc uses in MinBreedingSteps for "no breeding route exists". */
const UNREACHABLE = 10000;

interface PalCalcPal {
  Id: { PalDexNo: number; IsVariant: boolean };
  Name: string;
  InternalName: string;
  BreedingPower: number;
  Rarity: number;
  Nocturnal: boolean;
  Hp: number;
  Attack: number;
  Defense: number;
  MinWildLevel: number | null;
  MaxWildLevel: number | null;
  GuaranteedPassivesInternalIds: string[];
  WorkSuitability: Record<string, number>;
}

interface PalCalcPassive {
  Name: string;
  InternalName: string;
  Rank: number;
  IsStandardPassiveSkill: boolean;
  RandomInheritanceAllowed: boolean;
  RandomInheritanceWeight: number;
  Description: string | null;
}

interface PalCalcActive {
  Name: string;
  InternalName: string;
  ElementInternalName: string | null;
}

interface PalCalcDb {
  Version: string;
  Pals: PalCalcPal[];
  PassiveSkills: PalCalcPassive[];
  ActiveSkills: PalCalcActive[];
  BreedingMechanics: {
    IVInheritanceWeights: Record<string, number>;
    PassiveInheritanceWeights: Record<string, number>;
    PassiveRandomWeights: Record<string, number>;
  };
  BreedingGenderProbability: Record<string, { MALE: number; FEMALE: number }>;
}

interface BreedingEntry {
  Parent1InternalName: string;
  Parent1Gender: string;
  Parent2InternalName: string;
  Parent2Gender: string;
  ChildInternalName: string;
}

interface PalCalcBreeding {
  Breeding: BreedingEntry[];
  MinBreedingSteps: Record<string, Record<string, number>>;
}

async function fetchJson<T>(name: string): Promise<T> {
  const cache = process.env.PALCALC_CACHE;
  if (cache) {
    const local = join(cache, name);
    if (existsSync(local)) {
      console.log(`  ${name}: using cache ${local}`);
      return JSON.parse(await readFile(local, 'utf8')) as T;
    }
  }
  const url = `${RAW}/${name}`;
  console.log(`  ${name}: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Terraria crossover event monsters: not obtainable in normal play, only noise here. */
function isEventOnly(p: PalCalcPal): boolean {
  return p.InternalName.toLowerCase().startsWith('yakushima');
}

/** Packs a square int16 matrix as base64, little-endian, row-major. */
function packMatrix(matrix: number[][]): string {
  const n = matrix.length;
  const bytes = new Uint8Array(n * n * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      view.setInt16((i * n + j) * 2, matrix[i]![j]!, true);
    }
  }
  return Buffer.from(bytes).toString('base64');
}

async function main() {
  console.log('Fetching PalCalc dataset...');
  const db = await fetchJson<PalCalcDb>('db.json');
  const breeding = await fetchJson<PalCalcBreeding>('breeding.json');
  console.log(`Dataset version: ${db.Version}`);

  const pals = db.Pals.filter((p) => !isEventOnly(p));
  // Stable, human-meaningful ordering: paldex number, base form before variant.
  pals.sort((a, b) => a.Id.PalDexNo - b.Id.PalDexNo || Number(a.Id.IsVariant) - Number(b.Id.IsVariant));

  const indexOf = new Map<string, number>();
  pals.forEach((p, i) => indexOf.set(p.InternalName, i));

  // Two pals share the English name "Gumoss" (PlantSlime and PlantSlime_Flower), so a
  // display name is not a unique key. Disambiguate the variant rather than silently
  // letting one shadow the other in name lookups.
  const nameCounts = new Map<string, number>();
  for (const p of pals) nameCounts.set(p.Name, (nameCounts.get(p.Name) ?? 0) + 1);
  const displayName = (p: PalCalcPal): string =>
    (nameCounts.get(p.Name) ?? 0) > 1 && p.Id.IsVariant ? `${p.Name} (Special)` : p.Name;

  const species = pals.map((p) => ({
    internalName: p.InternalName,
    name: displayName(p),
    paldexNo: p.Id.PalDexNo,
    isVariant: p.Id.IsVariant,
    breedingPower: p.BreedingPower,
    rarity: p.Rarity,
    nocturnal: p.Nocturnal,
    baseHp: p.Hp,
    baseAttack: p.Attack,
    baseDefense: p.Defense,
    minWildLevel: p.MinWildLevel,
    maxWildLevel: p.MaxWildLevel,
    guaranteedPassives: p.GuaranteedPassivesInternalIds,
    workSuitability: Object.fromEntries(Object.entries(p.WorkSuitability).filter(([, v]) => v > 0)),
    // Several pals are skewed (e.g. 0.4/0.6), which changes how many eggs a plan needs
    // when a specific gender is required.
    genderMale: db.BreedingGenderProbability[p.InternalName]?.MALE ?? 0.5,
    genderFemale: db.BreedingGenderProbability[p.InternalName]?.FEMALE ?? 0.5,
  }));

  // --- breeding matrix -------------------------------------------------------
  const n = pals.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  const gendered: Array<{
    parentA: number;
    parentAGender: string;
    parentB: number;
    parentBGender: string;
    child: number;
  }> = [];

  let skipped = 0;
  for (const e of breeding.Breeding) {
    const a = indexOf.get(e.Parent1InternalName);
    const b = indexOf.get(e.Parent2InternalName);
    const c = indexOf.get(e.ChildInternalName);
    if (a === undefined || b === undefined || c === undefined) {
      skipped++; // references a filtered-out event pal
      continue;
    }
    if (e.Parent1Gender === 'WILDCARD' && e.Parent2Gender === 'WILDCARD') {
      matrix[a]![b] = c;
      matrix[b]![a] = c;
    } else {
      // Gender-dependent pairs: the same two species give different children depending on
      // which parent is male. Recorded separately so the solver can surface the
      // requirement instead of silently picking one outcome.
      gendered.push({
        parentA: a,
        parentAGender: e.Parent1Gender,
        parentB: b,
        parentBGender: e.Parent2Gender,
        child: c,
      });
      if (matrix[a]![b] === -1) {
        matrix[a]![b] = c;
        matrix[b]![a] = c;
      }
    }
  }

  let missing = 0;
  let missingExample = '';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i]![j] === -1) {
        missing++;
        if (!missingExample) missingExample = `${pals[i]!.InternalName} x ${pals[j]!.InternalName}`;
      }
    }
  }

  // --- min breeding steps (admissible heuristic for route search) -------------
  const minSteps: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(UNREACHABLE));
  for (let i = 0; i < n; i++) {
    const row = breeding.MinBreedingSteps[pals[i]!.InternalName] ?? {};
    for (const [target, steps] of Object.entries(row)) {
      const j = indexOf.get(target);
      if (j !== undefined) minSteps[i]![j] = Math.min(steps, UNREACHABLE);
    }
  }

  const passives = db.PassiveSkills.filter((p) => p.IsStandardPassiveSkill).map((p) => ({
    internalName: p.InternalName,
    name: p.Name,
    rank: p.Rank,
    randomInheritanceAllowed: p.RandomInheritanceAllowed,
    randomInheritanceWeight: p.RandomInheritanceWeight,
    description: p.Description,
  }));

  const activeSkills = db.ActiveSkills.map((s) => ({
    internalName: s.InternalName,
    name: s.Name,
    element: s.ElementInternalName,
  }));

  const mechanics = {
    ivInheritanceWeights: db.BreedingMechanics.IVInheritanceWeights,
    passiveInheritanceWeights: db.BreedingMechanics.PassiveInheritanceWeights,
    passiveRandomWeights: db.BreedingMechanics.PassiveRandomWeights,
    unreachableSentinel: UNREACHABLE,
  };

  const source = `/**
 * GENERATED FILE -- do not edit by hand.
 * Run \`npm run gen-data\` to regenerate from the PalCalc dataset.
 *
 * Source: https://github.com/tylercamp/palcalc (datamined from the game's .pak files)
 * Dataset version: ${db.Version}
 */

export interface SpeciesRow {
  internalName: string;
  name: string;
  paldexNo: number;
  isVariant: boolean;
  breedingPower: number;
  rarity: number;
  nocturnal: boolean;
  baseHp: number;
  baseAttack: number;
  baseDefense: number;
  /** Null for the handful of Pals that never spawn in the wild (raid bosses). */
  minWildLevel: number | null;
  maxWildLevel: number | null;
  guaranteedPassives: string[];
  workSuitability: Record<string, number>;
  genderMale: number;
  genderFemale: number;
}

export interface PassiveRow {
  internalName: string;
  name: string;
  rank: number;
  randomInheritanceAllowed: boolean;
  randomInheritanceWeight: number;
  description: string | null;
}

export interface ActiveSkillRow {
  internalName: string;
  name: string;
  element: string | null;
}

export interface GenderedComboRow {
  parentA: number;
  parentAGender: string;
  parentB: number;
  parentBGender: string;
  child: number;
}

export const DATASET_VERSION = ${JSON.stringify(db.Version)};
export const SPECIES_COUNT = ${n};

export const SPECIES_TABLE: SpeciesRow[] = ${JSON.stringify(species)};

export const PASSIVES_TABLE: PassiveRow[] = ${JSON.stringify(passives)};

export const ACTIVE_SKILLS_TABLE: ActiveSkillRow[] = ${JSON.stringify(activeSkills)};

export const GENDERED_COMBOS_TABLE: GenderedComboRow[] = ${JSON.stringify(gendered)};

export const MECHANICS_TABLE = ${JSON.stringify(mechanics)};

`;

  const matrixSource = `/**
 * GENERATED FILE -- do not edit by hand.
 * Run \`npm run gen-data\` to regenerate from the PalCalc dataset.
 *
 * Split out from tables.ts because only the breeding solver needs these; keeping them in a
 * separate module lets a UI bundle that just wants species names skip ~440 kB.
 */

export const MATRIX_SIZE = ${n};

/** ${n}x${n} int16 matrix, little-endian, row-major: child species index per parent pair. */
export const BREEDING_MATRIX_PACKED = ${JSON.stringify(packMatrix(matrix))};

/** ${n}x${n} int16 matrix: fewest breeding steps from species a to species b. */
export const MIN_STEPS_PACKED = ${JSON.stringify(packMatrix(minSteps))};
`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, source, 'utf8');
  await writeFile(MATRIX_FILE, matrixSource, 'utf8');

  console.log(`\nwrote ${OUT_FILE}`);
  console.log(`wrote ${MATRIX_FILE}`);
  console.log(`species: ${species.length}`);
  console.log(`passives: ${passives.length}  activeSkills: ${activeSkills.length}`);
  console.log(`gender-dependent pairs: ${gendered.length}`);
  console.log(`breeding entries skipped (event pals): ${skipped}`);
  if (missing > 0) {
    // Every ordered species pair should resolve to a child. A gap means the dataset
    // changed shape and the solver would silently treat that pair as un-breedable.
    console.warn(`WARNING: ${missing} parent pairs have no recorded child, e.g. ${missingExample}`);
  } else {
    console.log('breeding matrix: complete (every species pair resolves)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
