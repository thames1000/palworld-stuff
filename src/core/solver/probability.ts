/**
 * Breeding probability math, driven by the datamined inheritance weights.
 *
 * The weights come from the game files (see data/mechanics.json):
 *   passiveInheritanceWeights - how many passives are drawn from the combined parent pool
 *   passiveRandomWeights      - how many extra random passives are added on top
 *   ivInheritanceWeights      - how many of the three IVs are taken from the parents
 */
import { MECHANICS, SPECIES } from '../data/index.js';

/** Maximum passive slots a Pal can hold. */
export const MAX_PASSIVE_SLOTS = 4;

function normalize(weights: Record<string, number>): Map<number, number> {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const out = new Map<number, number>();
  for (const [k, v] of Object.entries(weights)) out.set(Number(k), v / total);
  return out;
}

const P_INHERIT_COUNT = normalize(MECHANICS.passiveInheritanceWeights);
const P_RANDOM_COUNT = normalize(MECHANICS.passiveRandomWeights);
const P_IV_INHERIT_COUNT = normalize(MECHANICS.ivInheritanceWeights);

const binomCache = new Map<number, number>();
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const key = n * 100 + k;
  const cached = binomCache.get(key);
  if (cached !== undefined) return cached;
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  result = Math.round(result);
  binomCache.set(key, result);
  return result;
}

/**
 * Probability that a child inherits every one of `desiredCount` specific passives,
 * given a combined parent pool of `poolSize` distinct passives.
 *
 * Extra passives on the child are tolerated -- this is the probability of getting *at
 * least* the wanted set, which is what a player actually accepts when hatching.
 */
export function passiveInheritanceProbability(poolSize: number, desiredCount: number): number {
  if (desiredCount === 0) return 1;
  if (desiredCount > poolSize) return 0;
  let p = 0;
  for (const [k, weight] of P_INHERIT_COUNT) {
    if (k >= poolSize) {
      // Drawing at least the whole pool: every desired passive is guaranteed.
      p += weight;
    } else if (k >= desiredCount) {
      // Hypergeometric: all `desiredCount` wanted passives land in a draw of k.
      p += (weight * choose(poolSize - desiredCount, k - desiredCount)) / choose(poolSize, k);
    }
  }
  return p;
}

/**
 * Expected number of passives on the child that are NOT in the wanted set.
 *
 * Counts both unwanted passives pulled from the parent pool and the randomly rolled
 * additions. Used to rank routes by how much passive-cleaning they will need.
 */
export function expectedUnwantedPassives(poolSize: number, desiredCount: number): number {
  let fromPool = 0;
  const unwantedInPool = Math.max(0, poolSize - desiredCount);
  if (poolSize > 0) {
    for (const [k, weight] of P_INHERIT_COUNT) {
      const drawn = Math.min(k, poolSize);
      fromPool += weight * drawn * (unwantedInPool / poolSize);
    }
  }
  let fromRandom = 0;
  for (const [j, weight] of P_RANDOM_COUNT) fromRandom += weight * j;

  // A Pal cannot hold more than four passives, so the wanted ones crowd out junk.
  const room = Math.max(0, MAX_PASSIVE_SLOTS - desiredCount);
  return Math.min(room, fromPool + fromRandom);
}

/** Chance a child of this species is born the requested gender. */
export function genderProbability(speciesIndex: number, gender: 'Male' | 'Female' | null): number {
  if (!gender) return 1;
  const s = SPECIES[speciesIndex];
  if (!s) return 0.5;
  return gender === 'Male' ? s.genderMale : s.genderFemale;
}

/**
 * Probability that a child meets every IV threshold, given both parents' IVs.
 *
 * Model: `k` of the three stats are inherited (k drawn from the datamined weights), each
 * inherited stat taken from a uniformly chosen parent; the remaining stats roll fresh.
 * Fresh rolls are treated as uniform over 0-100, which is an approximation of the game's
 * actual roll distribution.
 */
export function ivProbability(
  parentA: readonly number[],
  parentB: readonly number[],
  thresholds: readonly (number | null)[],
): number {
  const required: number[] = [];
  for (let i = 0; i < 3; i++) if (thresholds[i] != null && thresholds[i]! > 0) required.push(i);
  if (required.length === 0) return 1;

  // Per-stat probability of satisfying the threshold, conditional on whether that stat
  // was inherited or rolled fresh.
  const pInherited: number[] = [];
  const pRandom: number[] = [];
  for (const i of required) {
    const t = thresholds[i]!;
    const a = parentA[i] ?? 0;
    const b = parentB[i] ?? 0;
    pInherited.push(((a >= t ? 1 : 0) + (b >= t ? 1 : 0)) / 2);
    pRandom.push(Math.max(0, (100 - t + 1) / 101));
  }

  let total = 0;
  for (const [k, weight] of P_IV_INHERIT_COUNT) {
    // Each subset of k inherited stats is equally likely.
    const subsets = choose(3, k);
    if (subsets === 0) continue;
    let acc = 0;
    for (let mask = 0; mask < 8; mask++) {
      if (popcount(mask) !== k) continue;
      let p = 1;
      required.forEach((statIndex, idx) => {
        p *= (mask & (1 << statIndex)) !== 0 ? pInherited[idx]! : pRandom[idx]!;
      });
      acc += p;
    }
    total += (weight * acc) / subsets;
  }
  return total;
}

export function popcount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}
