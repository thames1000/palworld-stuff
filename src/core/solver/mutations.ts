import { cakeInfo } from './cakes.js';
import { SPECIES } from '../data/index.js';
import { breedingResult, type ParentPair } from '../data/breeding.js';
import type { CakeVariant } from './types.js';

/** Current public/datamined-community mutation odds are per produced egg/hatch. */
const BASE_MUTATION_CHANCE = 0.01;
const EXTRAVAGANT_MUTATION_CHANCE = 0.03;

const MUTATION_RANK_COEFFICIENT = 0.5;
const MUTATION_RANK_DIFF_PENALTY = 0.4;
const MUTATION_RANDOM_COEFFICIENT = 0.1;

/**
 * Pals Palpedia marks `ignoreCombi`, meaning they can exist in breeding data but should not
 * appear as mutated-egg result species. PalForge's current generated table does not carry
 * that flag, so keep this small compatibility list until the data generator imports it.
 */
const MUTATION_RESULT_EXCLUDED_INTERNAL_NAMES = new Set([
  'BlackCentaur',
  'BlackGriffon',
  'BlueSkyDragon',
  'DarkAlien',
  'DarkMechaDragon',
  'ElecPanda',
  'FlowerPrince',
  'Horus',
  'Horus_Water',
  'IceHorse',
  'IceHorse_Dark',
  'JetDragon',
  'KingBahamut_Dragon',
  'KingWhale',
  'LegendDeer',
  'LilyQueen',
  'LilyQueen_Dark',
  'MimicDog',
  'MoonQueen',
  'Mothman',
  'NightLady',
  'NightLady_Dark',
  'PoseidonOrca',
  'SaintCentaur',
  'SnowTigerBeastman',
  'ThunderDragonMan',
  'WhiteAlienDragon',
]);

export interface MutationResult {
  speciesIndex: number;
  /** Share of this pair's mutation-result score range, not chance per produced egg. */
  relativeChance: number;
  targetCount: number;
  rangeSize: number;
}

export interface MutationParentLookup {
  selfPairs: number[];
  eligibleParentIds: ReadonlySet<number>;
  totalPairs: number;
  partnersOf(parent: number): number[];
}

export function mutationChancePerHatch(cake: CakeVariant | undefined): number {
  return cakeInfo(cake).id === 'extravagant-vegetable'
    ? EXTRAVAGANT_MUTATION_CHANCE
    : BASE_MUTATION_CHANCE;
}

export function mutationChanceAfterHatches(
  hatches: number,
  chancePerHatch: number,
): number {
  if (hatches <= 0 || chancePerHatch <= 0) return 0;
  if (chancePerHatch >= 1) return 1;
  return 1 - (1 - chancePerHatch) ** hatches;
}

export function expectedMutationCount(hatches: number, chancePerHatch: number): number {
  return Math.max(0, hatches) * Math.max(0, chancePerHatch);
}

export function hatchesForMutationConfidence(
  chancePerHatch: number,
  confidence: number,
): number {
  if (confidence <= 0) return 0;
  if (chancePerHatch <= 0) return Infinity;
  if (chancePerHatch >= 1) return 1;
  return Math.ceil(Math.log(1 - Math.min(confidence, 0.999999)) / Math.log(1 - chancePerHatch));
}

let mutationSpeciesCache: number[] | null = null;
let mutationParentSpeciesCache: number[] | null = null;

function mutationRounded(value: number): number {
  return Math.trunc(Math.round(2 * value + 0.5) / 2);
}

function mutationTiePriority(index: number): number {
  const species = SPECIES[index];
  if (!species) return -Infinity;
  return (
    species.breedingPower * 10000 +
    species.rarity * 100 +
    (species.isVariant ? 10 : 0) -
    species.paldexNo / 1000
  );
}

function speciesAt(index: number) {
  const species = SPECIES[index];
  if (!species) throw new Error(`Unknown species index ${index}`);
  return species;
}

function candidateAt(candidates: readonly number[], index: number): number {
  const candidate = candidates[index];
  if (candidate === undefined) throw new Error(`Unknown mutation candidate slot ${index}`);
  return candidate;
}

function byMutationRank(a: number, b: number): number {
  const speciesA = speciesAt(a);
  const speciesB = speciesAt(b);
  return (
    speciesA.breedingPower - speciesB.breedingPower ||
    mutationTiePriority(b) - mutationTiePriority(a) ||
    speciesA.name.localeCompare(speciesB.name)
  );
}

export function isMutationBreedableSpecies(index: number): boolean {
  const species = SPECIES[index];
  return Boolean(species && Number.isFinite(species.breedingPower) && breedingResult(index, index) === index);
}

export function isMutationResultSpecies(index: number): boolean {
  const species = SPECIES[index];
  return Boolean(
    species &&
      isMutationBreedableSpecies(index) &&
      !MUTATION_RESULT_EXCLUDED_INTERNAL_NAMES.has(species.internalName),
  );
}

export function mutationSpecies(): readonly number[] {
  mutationSpeciesCache ??= SPECIES.map((_, index) => index)
    .filter(isMutationResultSpecies)
    .sort(byMutationRank);
  return mutationSpeciesCache;
}

function mutationParentSpecies(): readonly number[] {
  mutationParentSpeciesCache ??= SPECIES.map((_, index) => index)
    .filter(isMutationBreedableSpecies)
    .sort(byMutationRank);
  return mutationParentSpeciesCache;
}

function nearestMutationSpecies(candidates: readonly number[], score: number): number {
  if (candidates.length === 0) throw new Error('Cannot choose a mutation species from an empty list');
  let low = 0;
  let high = candidates.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (speciesAt(candidateAt(candidates, mid)).breedingPower < score) low = mid + 1;
    else high = mid;
  }

  let best = candidateAt(candidates, low);
  let bestDistance = Math.abs(speciesAt(best).breedingPower - score);
  const consider = (candidate: number) => {
    const distance = Math.abs(speciesAt(candidate).breedingPower - score);
    if (
      distance < bestDistance ||
      (distance === bestDistance && mutationTiePriority(candidate) > mutationTiePriority(best))
    ) {
      best = candidate;
      bestDistance = distance;
    }
  };

  for (
    let i = low - 1;
    i >= 0 && score - speciesAt(candidateAt(candidates, i)).breedingPower <= bestDistance;
    i--
  ) {
    consider(candidateAt(candidates, i));
  }
  for (
    let i = low + 1;
    i < candidates.length && speciesAt(candidateAt(candidates, i)).breedingPower - score <= bestDistance;
    i++
  ) {
    consider(candidateAt(candidates, i));
  }
  return best;
}

function mutationScoreRange(a: number, b: number): { start: number; end: number; size: number } | null {
  const parentA = SPECIES[a];
  const parentB = SPECIES[b];
  if (!parentA || !parentB || !isMutationBreedableSpecies(a) || !isMutationBreedableSpecies(b)) {
    return null;
  }

  const lowerPower = Math.min(parentA.breedingPower, parentB.breedingPower);
  const diff = Math.abs(parentA.breedingPower - parentB.breedingPower);
  const base =
    mutationRounded(lowerPower * MUTATION_RANK_COEFFICIENT) +
    mutationRounded(diff * MUTATION_RANK_DIFF_PENALTY);
  const width = Math.max(1, mutationRounded(lowerPower * MUTATION_RANDOM_COEFFICIENT));
  const start = Math.max(1, base + 1);
  const end = base + width;
  if (end < start) return null;
  return { start, end, size: end - start + 1 };
}

export function mutationResultsForPair(a: number, b: number): MutationResult[] {
  const range = mutationScoreRange(a, b);
  const candidates = mutationSpecies();
  if (!range || candidates.length === 0) return [];

  const bySpecies = new Map<number, number>();
  for (let score = range.start; score <= range.end; score++) {
    const speciesIndex = nearestMutationSpecies(candidates, score);
    bySpecies.set(speciesIndex, (bySpecies.get(speciesIndex) ?? 0) + 1);
  }

  return [...bySpecies.entries()]
    .map(([speciesIndex, targetCount]) => ({
      speciesIndex,
      targetCount,
      rangeSize: range.size,
      relativeChance: (targetCount / range.size) * 100,
    }))
    .sort(
      (a, b) =>
        b.relativeChance - a.relativeChance ||
        speciesAt(b.speciesIndex).breedingPower - speciesAt(a.speciesIndex).breedingPower ||
        speciesAt(a.speciesIndex).name.localeCompare(speciesAt(b.speciesIndex).name),
    );
}

export function mutationResultChanceForChild(a: number, b: number, child: number): number {
  return mutationResultsForPair(a, b).find((result) => result.speciesIndex === child)?.relativeChance ?? 0;
}

function mutationTargetBounds(child: number, candidates: readonly number[]): { low: number; high: number } | null {
  const index = candidates.indexOf(child);
  if (index < 0) return null;

  const power = speciesAt(child).breedingPower;
  const previous = index > 0 ? speciesAt(candidateAt(candidates, index - 1)).breedingPower : -Infinity;
  const next =
    index < candidates.length - 1 ? speciesAt(candidateAt(candidates, index + 1)).breedingPower : Infinity;
  return {
    low: previous === -Infinity ? -Infinity : (previous + power) / 2,
    high: next === Infinity ? Infinity : (power + next) / 2,
  };
}

function mutationRangeCanHit(a: number, b: number, low: number, high: number): boolean {
  const range = mutationScoreRange(a, b);
  return Boolean(range && range.end >= low && range.start <= high);
}

export function mutationParentsForChild(child: number): MutationParentLookup {
  const candidates = mutationSpecies();
  const bounds = mutationTargetBounds(child, candidates);
  if (!bounds) {
    return {
      selfPairs: [],
      eligibleParentIds: new Set<number>(),
      totalPairs: 0,
      partnersOf: () => [],
    };
  }

  const parents = mutationParentSpecies();
  const selfPairs = parents.filter((parent) => mutationRangeCanHit(parent, parent, bounds.low, bounds.high));
  const eligibleParentIds = new Set<number>();
  let totalPairs = 0;

  for (let i = 0; i < parents.length; i++) {
    for (let j = i; j < parents.length; j++) {
      const a = candidateAt(parents, i);
      const b = candidateAt(parents, j);
      if (!mutationRangeCanHit(a, b, bounds.low, bounds.high)) continue;
      totalPairs++;
      eligibleParentIds.add(a);
      eligibleParentIds.add(b);
    }
  }

  return {
    selfPairs,
    eligibleParentIds,
    totalPairs,
    partnersOf(parent: number) {
      if (!isMutationBreedableSpecies(parent)) return [];
      return parents.filter((partner) => mutationRangeCanHit(parent, partner, bounds.low, bounds.high));
    },
  };
}

export function mutationParentPairsForChild(child: number): ParentPair[] {
  const lookup = mutationParentsForChild(child);
  const parents = mutationParentSpecies();
  const pairs: ParentPair[] = [];
  for (let i = 0; i < parents.length; i++) {
    const a = candidateAt(parents, i);
    if (!lookup.eligibleParentIds.has(a)) continue;
    for (const b of lookup.partnersOf(a)) {
      if (a <= b) pairs.push([a, b]);
    }
  }
  return pairs;
}
