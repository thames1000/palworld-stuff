/**
 * Breeding-route search.
 *
 * The search is a bounded dynamic program over states of `(species, passive bitmask)`,
 * where the bitmask records which of the target's required passives a Pal carries. Each
 * round combines the surviving nodes pairwise; a pair's child species comes from the
 * datamined breeding table and its mask is the union of the parents' masks. The best node
 * per state is kept, and a beam of the most promising nodes is carried into the next
 * round so the pairwise step stays tractable.
 *
 * Modelling assumptions, stated plainly because they drive the hatch estimates:
 *  - An owned Pal's parent pool is its real passive list, junk included. A Pal with four
 *    passives is genuinely a poor parent and the math reflects that.
 *  - A *bred* intermediate is assumed to carry only the passives the plan wants from it.
 *    In practice you re-roll until you get a reasonably clean child, so this is the
 *    optimistic end of the range; `expectedUnwanted` reports the risk separately.
 *  - Success at a step means the child has all the wanted passives; extras are tolerated.
 *  - When IV floors are requested, every bred intermediate must meet them. Passive and IV
 *    inheritance are treated as independent when their probabilities are combined.
 */
import { MECHANICS, SPECIES } from '../data/index.js';
import { breedingResult, isReachable, minBreedingSteps } from '../data/breeding.js';
import type { Pal } from '../save/types.js';
import { expectedProductionCycles, ivRollModelForCake } from './cakes.js';
import {
  isMutationPassive,
  mutationChancePerHatch,
  mutationPassiveChance,
  mutationResultChanceForChild,
  mutationResultsForPair,
} from './mutations.js';
import { breedingStep, leavesCanBreed } from './pairing.js';
import {
  childIvDistribution,
  expectedUnwantedPassives,
  genderProbability,
  ivSuccessProbability,
  knownIvDistribution,
  passiveInheritanceProbability,
  popcount,
} from './probability.js';
import type {
  MutationAttempt,
  MutationStepInfo,
  OptimizationMode,
  PlanNode,
  SolveResult,
  TargetSpec,
} from './types.js';

/** Guards against a pathological search eating all memory on a huge Palbox. */
const MAX_NODES_PER_ROUND = 20000;
const MUTATION_IV_FLOOR = 90;

function ivVector(pal: Pal): number[] {
  return [pal.ivs.hp, pal.ivs.attack, pal.ivs.defense];
}

function thresholdVector(spec: TargetSpec): (number | null)[] {
  return [spec.minIvs.hp, spec.minIvs.attack, spec.minIvs.defense];
}

function mutationIvSuccess(thresholds: readonly (number | null)[]): number {
  const requested = thresholds.filter((threshold) => threshold != null && threshold > 0);
  if (requested.length === 0) return 1;
  return requested.every((threshold) => threshold! <= MUTATION_IV_FLOOR) ? 1 : 0;
}

function mutationIvDistribution(thresholds: readonly (number | null)[]) {
  return knownIvDistribution(
    [MUTATION_IV_FLOOR, MUTATION_IV_FLOOR, MUTATION_IV_FLOOR],
    thresholds,
  );
}

function planUsesMutation(node: PlanNode | null): boolean {
  if (!node) return false;
  if (node.mutation) return true;
  return Boolean(node.parents && (planUsesMutation(node.parents[0]) || planUsesMutation(node.parents[1])));
}

function ownedPalsCanBreed(a: Pal, b: Pal): boolean {
  if (a.instanceId === b.instanceId) return false;
  if (a.gender === 'Unknown' || b.gender === 'Unknown') return true;
  return a.gender !== b.gender;
}

function mutationPassiveOutlook(
  a: Pal,
  b: Pal,
  required: readonly string[],
  requiredIndex: ReadonlyMap<string, number>,
): {
  success: number;
  missing: string[];
  assumed: string[];
  inherited: string[];
  mutationPassiveChance: number;
} {
  if (required.length === 0) {
    return { success: 1, missing: [], assumed: [], inherited: [], mutationPassiveChance: 1 };
  }

  let mask = 0;
  const pool = new Set<string>();
  for (const passive of [...a.passives, ...b.passives]) {
    const key = passive.toLowerCase();
    pool.add(key);
    const index = requiredIndex.get(key);
    if (index !== undefined) mask |= 1 << index;
  }

  const inherited = maskedRequiredPassives(mask, required);
  const assumed = required.filter(
    (passive, index) => (mask & (1 << index)) === 0 && isMutationPassive(passive),
  );
  const missing = required.filter(
    (passive, index) => (mask & (1 << index)) === 0 && !isMutationPassive(passive),
  );
  const mutationRollChance = mutationPassiveChance(assumed);
  if (missing.length > 0 || mutationRollChance <= 0) {
    return { success: 0, missing, assumed, inherited, mutationPassiveChance: mutationRollChance };
  }
  return {
    success: passiveInheritanceProbability(Math.max(1, pool.size), inherited.length),
    missing,
    assumed,
    inherited,
    mutationPassiveChance: mutationRollChance,
  };
}

function requiredPassiveMask(
  passives: readonly string[],
  requiredIndex: ReadonlyMap<string, number>,
): number {
  let mask = 0;
  for (const passive of passives) {
    const idx = requiredIndex.get(passive.toLowerCase());
    if (idx !== undefined) mask |= 1 << idx;
  }
  return mask;
}

function maskedRequiredPassives(mask: number, required: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < required.length; i++) {
    if (mask & (1 << i)) out.push(required[i]!);
  }
  return out;
}

function compareMutationAttempts(a: MutationAttempt, b: MutationAttempt): number {
  const aExpected = a.expectedTargetHatches ?? a.expectedSpeciesHatches;
  const bExpected = b.expectedTargetHatches ?? b.expectedSpeciesHatches;
  return (
    aExpected - bExpected ||
    b.targetChancePerHatch - a.targetChancePerHatch ||
    b.speciesChancePerHatch - a.speciesChancePerHatch ||
    a.parentA.location.label.localeCompare(b.parentA.location.label) ||
    a.parentB.location.label.localeCompare(b.parentB.location.label)
  );
}

function allMutationAttempts(
  candidates: readonly Pal[],
  spec: TargetSpec,
  requiredIndex: ReadonlyMap<string, number>,
  thresholds: readonly (number | null)[],
): MutationAttempt[] {
  const attempts: MutationAttempt[] = [];
  const mutationChance = mutationChancePerHatch(spec.cake);
  const targetGenderProbability = genderProbability(spec.speciesIndex, spec.gender);
  const ivSuccess = mutationIvSuccess(thresholds);

  if (mutationChance <= 0 || targetGenderProbability <= 0) return [];

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]!;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j]!;
      if (!ownedPalsCanBreed(a, b)) continue;

      const targetShare = mutationResultChanceForChild(
        a.speciesIndex,
        b.speciesIndex,
        spec.speciesIndex,
      );
      if (targetShare <= 0) continue;

      const passive = mutationPassiveOutlook(a, b, spec.requiredPassives, requiredIndex);
      const speciesChancePerHatch = mutationChance * (targetShare / 100) * targetGenderProbability;
      const targetChancePerHatch =
        speciesChancePerHatch * passive.success * passive.mutationPassiveChance * ivSuccess;
      attempts.push({
        parentA: a,
        parentB: b,
        targetShare,
        mutationChancePerHatch: mutationChance,
        speciesChancePerHatch,
        targetChancePerHatch,
        expectedSpeciesHatches: 1 / speciesChancePerHatch,
        expectedTargetHatches: targetChancePerHatch > 0 ? 1 / targetChancePerHatch : null,
        targetGenderProbability,
        passiveSuccess: passive.success,
        mutationPassiveChance: passive.mutationPassiveChance,
        assumedPassives: passive.assumed,
        inheritedPassives: passive.inherited,
        missingPassives: passive.missing,
        ivSuccess,
        mutationIvFloor: MUTATION_IV_FLOOR,
        reasons: [],
      });
    }
  }

  return attempts.sort(compareMutationAttempts);
}

function mutationSeedNode(
  parentA: PlanNode,
  parentB: PlanNode,
  speciesIndex: number,
  targetShare: number,
  kind: MutationStepInfo['kind'],
  assumedPassive: string | null,
  spec: TargetSpec,
  requiredIndex: ReadonlyMap<string, number>,
  thresholds: readonly (number | null)[],
): PlanNode | null {
  const sourceA = parentA.source;
  const sourceB = parentB.source;
  if (!sourceA || !sourceB) return null;

  const mutationChance = mutationChancePerHatch(spec.cake);
  const speciesChancePerHatch = mutationChance * (targetShare / 100);
  if (speciesChancePerHatch <= 0) return null;

  const parentPool = new Set<string>();
  for (const passive of [...sourceA.passives, ...sourceB.passives]) parentPool.add(passive.toLowerCase());
  const inheritedMask = parentA.mask | parentB.mask;
  const assumedMask = assumedPassive
    ? requiredPassiveMask([assumedPassive], requiredIndex)
    : 0;
  const assumedPassives = assumedPassive ? [assumedPassive] : [];
  const mutationRollChance = mutationPassiveChance(assumedPassives);
  if (mutationRollChance <= 0) return null;
  const childMask = inheritedMask | assumedMask;
  const inheritedCount = popcount(inheritedMask);
  const passiveSuccess = passiveInheritanceProbability(Math.max(1, parentPool.size), inheritedCount);
  if (passiveSuccess <= 0) return null;

  const ivDistribution = mutationIvDistribution(thresholds);
  const wantsIvs = thresholds.some((threshold) => threshold != null && threshold > 0);
  const ivStepSuccess = wantsIvs ? ivSuccessProbability(ivDistribution, thresholds) : 1;
  if (ivStepSuccess <= 0) return null;

  const stepEggs = 1 / (speciesChancePerHatch * passiveSuccess * mutationRollChance * ivStepSuccess);
  const mutation: MutationStepInfo = {
    kind,
    targetShare,
    mutationChancePerHatch: mutationChance,
    speciesChancePerHatch,
    mutationPassiveChance: mutationRollChance,
    assumedPassives,
    inheritedPassives: maskedRequiredPassives(inheritedMask, spec.requiredPassives),
    mutationIvFloor: MUTATION_IV_FLOOR,
  };

  return {
    speciesIndex,
    mask: childMask,
    generation: 1,
    poolSize: Math.max(1, popcount(childMask)),
    stepEggs,
    passiveSuccess,
    genderFactor: 1,
    genderRequirement: null,
    totalEggs: parentA.totalEggs + parentB.totalEggs + stepEggs,
    expectedUnwanted: expectedUnwantedPassives(Math.max(1, parentPool.size), inheritedCount),
    ivDistribution,
    ivStepSuccess,
    source: null,
    parents: [parentA, parentB],
    requiredGender: null,
    mutation,
  };
}

function regularChildMutationNode(
  a: PlanNode,
  b: PlanNode,
  speciesIndex: number,
  inheritedMask: number,
  assumedPassive: string | null,
  step: ReturnType<typeof breedingStep>,
  spec: TargetSpec,
  requiredIndex: ReadonlyMap<string, number>,
  thresholds: readonly (number | null)[],
): PlanNode | null {
  const mutationChance = mutationChancePerHatch(spec.cake);
  if (mutationChance <= 0) return null;

  const assumedMask = assumedPassive
    ? requiredPassiveMask([assumedPassive], requiredIndex)
    : 0;
  const assumedPassives = assumedPassive ? [assumedPassive] : [];
  const mutationRollChance = mutationPassiveChance(assumedPassives);
  if (mutationRollChance <= 0) return null;
  const childMask = inheritedMask | assumedMask;
  const desiredCount = popcount(inheritedMask);

  const ivDistribution = mutationIvDistribution(thresholds);
  const wantsIvs = thresholds.some((threshold) => threshold != null && threshold > 0);
  const ivStepSuccess = wantsIvs ? ivSuccessProbability(ivDistribution, thresholds) : 1;
  if (ivStepSuccess <= 0) return null;

  const stepEggs = step.stepEggs / (mutationChance * mutationRollChance * ivStepSuccess);
  const mutation: MutationStepInfo = {
    kind: 'regular-child',
    targetShare: 100,
    mutationChancePerHatch: mutationChance,
    speciesChancePerHatch: mutationChance,
    mutationPassiveChance: mutationRollChance,
    assumedPassives,
    inheritedPassives: maskedRequiredPassives(inheritedMask, spec.requiredPassives),
    mutationIvFloor: MUTATION_IV_FLOOR,
  };

  return {
    speciesIndex,
    mask: childMask,
    generation: Math.max(a.generation, b.generation) + 1,
    poolSize: Math.max(1, popcount(childMask)),
    stepEggs,
    passiveSuccess: step.passiveSuccess,
    genderFactor: step.genderFactor,
    genderRequirement: step.genderRequirement,
    totalEggs: a.totalEggs + b.totalEggs + stepEggs,
    expectedUnwanted: expectedUnwantedPassives(step.pool, desiredCount),
    ivDistribution,
    ivStepSuccess,
    source: null,
    parents: [a, b],
    requiredGender: null,
    mutation,
  };
}

function mutationAttemptsForResult(
  attempts: readonly MutationAttempt[],
  spec: TargetSpec,
  thresholds: readonly (number | null)[],
  plan: PlanNode | null,
): MutationAttempt[] {
  const wantsIvs = thresholds.some((threshold) => threshold != null && threshold > 0);
  const regularCycles =
    plan && Number.isFinite(plan.totalEggs)
      ? expectedProductionCycles(plan.totalEggs, spec.cake)
      : Infinity;

  return attempts
    .map((attempt) => {
      const reasons: MutationAttempt['reasons'] = [];
      if (!plan) reasons.push('no-regular-route');
      if (
        plan &&
        wantsIvs &&
        attempt.expectedTargetHatches != null &&
        expectedProductionCycles(attempt.expectedTargetHatches, spec.cake) < regularCycles
      ) {
        reasons.push('faster-iv-target');
      }
      return { ...attempt, reasons };
    })
    .filter((attempt) => attempt.reasons.length > 0)
    .sort(compareMutationAttempts)
    .slice(0, 5);
}

/** Lower is better. Ties are broken so plans stay stable between runs. */
function cost(node: PlanNode, mode: OptimizationMode, thresholds: readonly (number | null)[]): number {
  const ivSuccess = node.ivDistribution
    ? ivSuccessProbability(node.ivDistribution, thresholds)
    : 1;
  // IV targets now influence which route survives for a species/passive state. Step 4 will
  // turn this probability into explicit per-step keep rules and egg costs; for now a
  // logarithmic penalty avoids allowing a tiny probability to swamp the primary mode.
  const ivPenalty = -Math.log(Math.max(ivSuccess, 1e-12)) * 20;
  switch (mode) {
    case 'generations':
      return node.generation * 1e6 + node.totalEggs + ivPenalty;
    case 'eggs':
      return node.totalEggs + ivPenalty;
    case 'clean':
      return node.expectedUnwanted * 1e4 + node.totalEggs + ivPenalty;
    case 'balanced':
      // Generations dominate, but a route that needs hundreds of eggs should lose to a
      // slightly longer one that needs a dozen.
      return node.generation * 50 + Math.log1p(node.totalEggs) * 10 + node.expectedUnwanted * 5 + ivPenalty;
  }
}

function stateKey(speciesIndex: number, mask: number, maskCount: number): number {
  return speciesIndex * (1 << maskCount) + mask;
}

export function solve(pals: Pal[], spec: TargetSpec): SolveResult {
  const started = Date.now();
  const diagnostics: string[] = [];
  const required = spec.requiredPassives;
  const maskCount = required.length;
  const fullMask = (1 << maskCount) - 1;
  const requiredIndex = new Map(required.map((p, i) => [p.toLowerCase(), i]));
  const excluded = new Set(spec.excludedPassives.map((p) => p.toLowerCase()));
  const thresholds = thresholdVector(spec);
  const wantsIvs = thresholds.some((t) => t != null && t > 0);
  const ivRollModel = ivRollModelForCake(spec.cake);

  // --- candidate pool -------------------------------------------------------
  let candidates = pals;
  if (!spec.allowExcludedParents && excluded.size > 0) {
    const before = candidates.length;
    candidates = candidates.filter((p) => !p.passives.some((s) => excluded.has(s.toLowerCase())));
    const removed = before - candidates.length;
    if (removed > 0) {
      diagnostics.push(
        `Excluded ${removed} Pal(s) from consideration because they carry a passive you ruled out. ` +
          `Pass --allow-excluded-parents to use them anyway.`,
      );
    }
  }

  if (candidates.length === 0) {
    return {
      feasibility: 'no-pals',
      plan: null,
      mutationAttempts: [],
      alternatives: [],
      missingPassives: required,
      existingMatches: [],
      finalGenderProbability: genderProbability(spec.speciesIndex, spec.gender),
      finalIvProbability: null,
      diagnostics,
      searchedNodes: 0,
      elapsedMs: Date.now() - started,
    };
  }

  // --- do you already own it? -----------------------------------------------
  const existingMatches = candidates.filter((p) => {
    if (p.speciesIndex !== spec.speciesIndex) return false;
    const have = new Set(p.passives.map((s) => s.toLowerCase()));
    if (!required.every((r) => have.has(r.toLowerCase()))) return false;
    if (spec.gender && p.gender !== spec.gender) return false;
    if (wantsIvs) {
      const v = ivVector(p);
      for (let i = 0; i < 3; i++) if (thresholds[i] != null && v[i]! < thresholds[i]!) return false;
    }
    return true;
  });

  // --- which required passives exist anywhere? ------------------------------
  const availablePassives = new Set<string>();
  for (const p of candidates) for (const s of p.passives) availablePassives.add(s.toLowerCase());
  const missingPassives = required.filter((r) => !availablePassives.has(r.toLowerCase()));

  // --- is the species reachable at all? -------------------------------------
  const ownedSpecies = new Set(candidates.map((p) => p.speciesIndex));
  const speciesReachable =
    ownedSpecies.has(spec.speciesIndex) ||
    [...ownedSpecies].some((s) => isReachable(s, spec.speciesIndex));

  if (existingMatches.length > 0) {
    return {
      feasibility: 'already-owned',
      plan: null,
      mutationAttempts: [],
      alternatives: [],
      missingPassives,
      existingMatches,
      finalGenderProbability: 1,
      finalIvProbability: 1,
      diagnostics,
      searchedNodes: 0,
      elapsedMs: Date.now() - started,
    };
  }

  let mutationCandidateCache: MutationAttempt[] | null = null;
  const mutationCandidates = (): MutationAttempt[] => {
    mutationCandidateCache ??= allMutationAttempts(candidates, spec, requiredIndex, thresholds);
    return mutationCandidateCache;
  };

  if (missingPassives.length > 0) {
    const mutationOnlyMissing = missingPassives.filter(isMutationPassive);
    const ordinaryMissing = missingPassives.filter((passive) => !isMutationPassive(passive));
    if (ordinaryMissing.length > 0) {
      diagnostics.push(
        `No owned Pal carries: ${ordinaryMissing.join(', ')}. A guaranteed route is impossible.`,
      );
    }
    if (mutationOnlyMissing.length > 0) {
      diagnostics.push(
        `No owned Pal carries mutation passive(s): ${mutationOnlyMissing.join(', ')}. ` +
          'Mutation-created Pals can be used as assumed sources for those passives.',
      );
    }
  }

  // --- seed the search with owned Pals --------------------------------------
  const best = new Map<number, PlanNode>();
  const consider = (node: PlanNode): boolean => {
    const key = stateKey(node.speciesIndex, node.mask, maskCount);
    const current = best.get(key);
    if (!current || cost(node, spec.mode, thresholds) < cost(current, spec.mode, thresholds)) {
      best.set(key, node);
      return true;
    }
    return false;
  };

  const ownedNodes: PlanNode[] = [];
  for (const pal of candidates) {
    const mask = requiredPassiveMask(pal.passives, requiredIndex);
    const node: PlanNode = {
      speciesIndex: pal.speciesIndex,
      mask,
      generation: 0,
      poolSize: pal.passives.length,
      stepEggs: 0,
      passiveSuccess: 1,
      genderFactor: 1,
      genderRequirement: null,
      totalEggs: 0,
      expectedUnwanted: pal.passives.length - popcount(mask),
      ivDistribution: knownIvDistribution(ivVector(pal), thresholds),
      ivStepSuccess: 1,
      source: pal,
      parents: null,
      requiredGender: null,
    };
    ownedNodes.push(node);
    consider(node);
  }

  // --- breed outward --------------------------------------------------------
  const targetKeyFull = stateKey(spec.speciesIndex, fullMask, maskCount);
  let searched = best.size;

  const missingMutationPassives = missingPassives.filter(isMutationPassive);
  const mutationCanSatisfyIvTarget = mutationIvSuccess(thresholds) > 0;
  const needsMutationSeeds =
    missingMutationPassives.length > 0 ||
    (wantsIvs && mutationCanSatisfyIvTarget) ||
    !speciesReachable;
  const mutationAssumedOptions = missingMutationPassives.length > 0 ? missingMutationPassives : [null];

  if (needsMutationSeeds && spec.maxGenerations >= 1) {
    const remainingAfterMutation = spec.maxGenerations - 1;
    let mutationSeedCount = 0;
    for (let i = 0; i < ownedNodes.length; i++) {
      const a = ownedNodes[i]!;
      for (let j = i + 1; j < ownedNodes.length; j++) {
        const b = ownedNodes[j]!;
        if (!leavesCanBreed(a, b)) continue;
        for (const result of mutationResultsForPair(a.speciesIndex, b.speciesIndex)) {
          if (minBreedingSteps(result.speciesIndex, spec.speciesIndex) > remainingAfterMutation) {
            continue;
          }
          for (const assumedPassive of mutationAssumedOptions) {
            const node = mutationSeedNode(
              a,
              b,
              result.speciesIndex,
              result.relativeChance,
              'species-result',
              assumedPassive,
              spec,
              requiredIndex,
              thresholds,
            );
            if (node && consider(node)) {
              searched++;
              mutationSeedCount++;
            }
          }
        }
        const normalChild = breedingResult(a.speciesIndex, b.speciesIndex);
        if (
          normalChild >= 0 &&
          minBreedingSteps(normalChild, spec.speciesIndex) <= remainingAfterMutation
        ) {
          for (const assumedPassive of mutationAssumedOptions) {
            const node = mutationSeedNode(
              a,
              b,
              normalChild,
              100,
              'regular-child',
              assumedPassive,
              spec,
              requiredIndex,
              thresholds,
            );
            if (node && consider(node)) {
              searched++;
              mutationSeedCount++;
            }
          }
        }
      }
    }
    if (mutationSeedCount > 0) {
      diagnostics.push(
        `Considered ${mutationSeedCount.toLocaleString()} mutation-created route starter(s).`,
      );
    }
  }

  for (let generation = 1; generation <= spec.maxGenerations; generation++) {
    // Only nodes that can still reach the target in the remaining generations are worth
    // pairing, which prunes most of the 288-species space immediately.
    const remaining = spec.maxGenerations - generation + 1;
    const frontier = [...best.values()]
      .filter((n) => minBreedingSteps(n.speciesIndex, spec.speciesIndex) <= remaining)
      .sort((a, b) => {
        // Prefer nodes carrying more of the wanted passives, then cheaper ones.
        const byMask = popcount(b.mask) - popcount(a.mask);
        if (byMask !== 0) return byMask;
        return cost(a, spec.mode, thresholds) - cost(b, spec.mode, thresholds);
      })
      .slice(0, Math.min(spec.beamSize, MAX_NODES_PER_ROUND));

    if (frontier.length < 2) break;

    let improved = false;
    for (let i = 0; i < frontier.length; i++) {
      const a = frontier[i]!;
      for (let j = i; j < frontier.length; j++) {
        const b = frontier[j]!;
        if (!leavesCanBreed(a, b)) continue;

        const childSpecies = breedingResult(a.speciesIndex, b.speciesIndex);
        if (childSpecies < 0) continue;
        // Discard children that can no longer reach the target in time.
        if (minBreedingSteps(childSpecies, spec.speciesIndex) > remaining - 1) continue;

        const childMask = a.mask | b.mask;
        const desiredCount = popcount(childMask);
        const step = breedingStep(a, b, childMask);
        if (step.successPerEgg <= 0) continue;

        if (needsMutationSeeds) {
          for (const assumedPassive of mutationAssumedOptions) {
            const mutatedChild = regularChildMutationNode(
              a,
              b,
              childSpecies,
              childMask,
              assumedPassive,
              step,
              spec,
              requiredIndex,
              thresholds,
            );
            if (mutatedChild && mutatedChild.generation <= spec.maxGenerations && consider(mutatedChild)) {
              improved = true;
              searched++;
            }
          }
        }

        // A step whose child lands on a state a parent already occupies buys nothing the
        // search can use, and always costs eggs, so skip it outright.
        if (
          (childSpecies === a.speciesIndex && childMask === a.mask) ||
          (childSpecies === b.speciesIndex && childMask === b.mask)
        ) {
          continue;
        }

        const inheritedIvs = childIvDistribution(
          a.ivDistribution!,
          b.ivDistribution!,
          thresholds,
          ivRollModel,
        );
        const ivStepSuccess = wantsIvs ? ivSuccessProbability(inheritedIvs, thresholds) : 1;
        if (ivStepSuccess <= 0) continue;
        // A bred intermediate is retained only when it meets every requested floor. Once
        // selected, its threshold state is known for the next step even though its exact IVs
        // above those floors are not.
        const keptIvs = wantsIvs
          ? knownIvDistribution(
              thresholds.map((threshold) => threshold ?? 0),
              thresholds,
            )
          : inheritedIvs;
        const stepEggs = step.stepEggs / ivStepSuccess;

        const child: PlanNode = {
          speciesIndex: childSpecies,
          mask: childMask,
          generation: Math.max(a.generation, b.generation) + 1,
          poolSize: Math.max(1, desiredCount),
          stepEggs,
          passiveSuccess: step.passiveSuccess,
          genderFactor: step.genderFactor,
          genderRequirement: step.genderRequirement,
          totalEggs: a.totalEggs + b.totalEggs + stepEggs,
          expectedUnwanted: expectedUnwantedPassives(step.pool, desiredCount),
          ivDistribution: keptIvs,
          ivStepSuccess,
          source: null,
          parents: [a, b],
          requiredGender: null,
        };
        if (child.generation > spec.maxGenerations) continue;

        const key = stateKey(childSpecies, childMask, maskCount);
        const current = best.get(key);
        if (!current || cost(child, spec.mode, thresholds) < cost(current, spec.mode, thresholds)) {
          best.set(key, child);
          improved = true;
          searched++;
        }
      }
    }
    if (!improved) break;
  }

  const plan = best.get(targetKeyFull) ?? null;

  // Runner-up plans: same species, but carrying fewer of the wanted passives. These are
  // what the user falls back to when the full build is out of reach.
  const alternatives: PlanNode[] = [];
  for (let mask = fullMask - 1; mask >= 0; mask--) {
    const node = best.get(stateKey(spec.speciesIndex, mask, maskCount));
    if (node) alternatives.push(node);
  }
  alternatives.sort(
    (a, b) =>
      popcount(b.mask) - popcount(a.mask) ||
      cost(a, spec.mode, thresholds) - cost(b, spec.mode, thresholds),
  );

  let finalIvProbability: number | null = null;
  if (plan && wantsIvs) {
    finalIvProbability = plan.ivStepSuccess ?? null;
  }
  if (wantsIvs && plan && finalIvProbability === null) {
    diagnostics.push(
      'No final IV odds are available for this route because its IV state could not be evaluated.',
    );
  }

  const mutationAttempts =
    !plan || wantsIvs ? mutationAttemptsForResult(mutationCandidates(), spec, thresholds, plan) : [];
  if (!plan && mutationAttempts.length > 0) {
    diagnostics.push(
      `No guaranteed breeding route was found within ${spec.maxGenerations} generation(s), ` +
        'but mutation attempts can still produce the target species.',
    );
    if (spec.requiredPassives.length > 0 && mutationAttempts.some((attempt) => attempt.missingPassives.length > 0)) {
      diagnostics.push(
        'Some mutation attempts are species-only because the parent pair does not carry every required passive.',
      );
    }
  }
  if (plan && mutationAttempts.some((attempt) => attempt.reasons.includes('faster-iv-target'))) {
    diagnostics.push(
      `Mutation attempts are shown because mutated eggs have minimum ${MUTATION_IV_FLOOR} IVs ` +
        'and are expected to beat the regular IV route.',
    );
  }
  if (planUsesMutation(plan)) {
    diagnostics.push(
      'This route uses at least one mutation-created Pal before continuing with normal breeding.',
    );
  }
  const ivMutationCandidates = plan && wantsIvs ? mutationCandidates() : [];
  if (ivMutationCandidates.length > 0 && ivMutationCandidates.every((attempt) => attempt.ivSuccess <= 0)) {
    diagnostics.push(
      `Mutation IV shortcuts are not counted because one or more requested IV floors exceed ${MUTATION_IV_FLOOR}.`,
    );
  }

  let feasibility: SolveResult['feasibility'];
  if (plan) feasibility = planUsesMutation(plan) ? 'mutation-assisted' : 'breedable';
  else if (mutationAttempts.length > 0) feasibility = 'mutation-only';
  else if (!speciesReachable) feasibility = 'species-unreachable';
  else if (missingPassives.length > 0) feasibility = 'missing-passives';
  else feasibility = 'species-unreachable';

  if (!plan && speciesReachable && missingPassives.length === 0 && mutationAttempts.length === 0) {
    diagnostics.push(
      `No route found within ${spec.maxGenerations} generation(s). Try raising --max-generations or --beam.`,
    );
    feasibility = 'missing-passives';
  }
  if (!plan && !speciesReachable && mutationAttempts.length === 0) {
    diagnostics.push(
      `No route found from owned species to ${SPECIES[spec.speciesIndex]?.name ?? 'the target'}, ` +
        'including mutation-created starters.',
    );
  }

  return {
    feasibility,
    plan,
    mutationAttempts,
    alternatives: alternatives.slice(0, 5),
    missingPassives,
    existingMatches: [],
    finalGenderProbability: genderProbability(spec.speciesIndex, spec.gender),
    finalIvProbability,
    diagnostics,
    searchedNodes: searched,
    elapsedMs: Date.now() - started,
  };
}

/** Species that could produce the target within `maxSteps`, for "what should I catch?" hints. */
export function speciesLeadingTo(targetSpecies: number, maxSteps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < SPECIES.length; i++) {
    const steps = minBreedingSteps(i, targetSpecies);
    if (steps > 0 && steps <= maxSteps && steps < MECHANICS.unreachableSentinel) out.push(i);
  }
  return out;
}
