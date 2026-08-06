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

/**
 * Probability mass over the eight possible threshold-satisfaction masks for HP, attack
 * and defense. A set bit means that stat meets its requested threshold. Keeping the joint
 * mask, rather than three independent percentages, preserves correlations introduced by
 * the game's "inherit k stats" roll while remaining tiny enough to carry through a route.
 */
export type IvDistribution = readonly [number, number, number, number, number, number, number, number];

export interface IvRollModel {
  /** Minimum bonus added to a fresh IV roll before checking the requested threshold. */
  freshBonusMin?: number;
  /** Maximum bonus added to a fresh IV roll before checking the requested threshold. */
  freshBonusMax?: number;
}

function emptyIvDistribution(): number[] {
  return Array<number>(8).fill(0);
}

export function requiredIvMask(thresholds: readonly (number | null)[]): number {
  let mask = 0;
  for (let i = 0; i < 3; i++) {
    if (thresholds[i] != null && thresholds[i]! > 0) mask |= 1 << i;
  }
  return mask;
}

/** Threshold state for a Pal whose exact IV values are known. */
export function knownIvDistribution(
  ivs: readonly number[],
  thresholds: readonly (number | null)[],
): IvDistribution {
  let mask = 0;
  for (let i = 0; i < 3; i++) {
    const threshold = thresholds[i];
    if (threshold != null && threshold > 0 && (ivs[i] ?? 0) >= threshold) mask |= 1 << i;
  }
  const distribution = emptyIvDistribution();
  distribution[mask] = 1;
  return distribution as unknown as IvDistribution;
}

/**
 * Propagates threshold odds through one breeding step.
 *
 * Parent distributions may themselves come from earlier breeding steps. For every parent
 * state and inherited-stat subset, the child either takes that stat from a random parent or
 * rolls it fresh. Enumerating only eight masks retains the useful joint probability without
 * tracking all 101^3 exact IV combinations.
 */
export function childIvDistribution(
  parentA: IvDistribution,
  parentB: IvDistribution,
  thresholds: readonly (number | null)[],
  model: IvRollModel = {},
): IvDistribution {
  const requiredMask = requiredIvMask(thresholds);
  if (requiredMask === 0) return knownIvDistribution([], thresholds);

  const out = emptyIvDistribution();
  for (let maskA = 0; maskA < 8; maskA++) {
    const weightA = parentA[maskA] ?? 0;
    if (weightA === 0) continue;
    for (let maskB = 0; maskB < 8; maskB++) {
      const weightB = parentB[maskB] ?? 0;
      const parentWeight = weightA * weightB;
      if (parentWeight === 0) continue;

      for (const [inheritedCount, countWeight] of P_IV_INHERIT_COUNT) {
        const subsets = choose(3, inheritedCount);
        if (subsets === 0) continue;
        for (let inheritedMask = 0; inheritedMask < 8; inheritedMask++) {
          if (popcount(inheritedMask) !== inheritedCount) continue;

          const passChance = [0, 0, 0];
          for (let stat = 0; stat < 3; stat++) {
            if ((requiredMask & (1 << stat)) === 0) continue;
            if ((inheritedMask & (1 << stat)) !== 0) {
              passChance[stat] =
                (((maskA & (1 << stat)) !== 0 ? 1 : 0) +
                  ((maskB & (1 << stat)) !== 0 ? 1 : 0)) /
                2;
            } else {
              passChance[stat] = freshIvSuccessProbability(thresholds[stat]!, model);
            }
          }

          for (let childMask = 0; childMask < 8; childMask++) {
            if ((childMask & ~requiredMask) !== 0) continue;
            let probability = 1;
            for (let stat = 0; stat < 3; stat++) {
              if ((requiredMask & (1 << stat)) === 0) continue;
              const passes = (childMask & (1 << stat)) !== 0;
              probability *= passes ? passChance[stat]! : 1 - passChance[stat]!;
            }
            out[childMask] =
              (out[childMask] ?? 0) + (parentWeight * countWeight * probability) / subsets;
          }
        }
      }
    }
  }
  return out as unknown as IvDistribution;
}

function freshIvSuccessProbability(threshold: number, model: IvRollModel): number {
  const min = Math.max(0, Math.floor(model.freshBonusMin ?? 0));
  const max = Math.max(min, Math.floor(model.freshBonusMax ?? min));
  let probability = 0;
  for (let bonus = min; bonus <= max; bonus++) {
    const effectiveThreshold = Math.max(0, threshold - bonus);
    probability += Math.max(0, Math.min(1, (100 - effectiveThreshold + 1) / 101));
  }
  return probability / (max - min + 1);
}

export function ivSuccessProbability(
  distribution: IvDistribution,
  thresholds: readonly (number | null)[],
): number {
  return distribution[requiredIvMask(thresholds)] ?? 0;
}

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
  model: IvRollModel = {},
): number {
  const distribution = childIvDistribution(
    knownIvDistribution(parentA, thresholds),
    knownIvDistribution(parentB, thresholds),
    thresholds,
    model,
  );
  return ivSuccessProbability(distribution, thresholds);
}

export function popcount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}
