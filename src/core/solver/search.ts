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
 * Modelling assumptions, stated plainly because they drive the egg estimates:
 *  - An owned Pal's parent pool is its real passive list, junk included. A Pal with four
 *    passives is genuinely a poor parent and the math reflects that.
 *  - A *bred* intermediate is assumed to carry only the passives the plan wants from it.
 *    In practice you re-roll until you get a reasonably clean child, so this is the
 *    optimistic end of the range; `expectedUnwanted` reports the risk separately.
 *  - Success at a step means the child has all the wanted passives; extras are tolerated.
 */
import { MECHANICS, SPECIES } from '../data/index.js';
import { breedingResult, isReachable, minBreedingSteps } from '../data/breeding.js';
import type { Pal } from '../save/types.js';
import { breedingStep, leavesCanBreed } from './pairing.js';
import {
  expectedUnwantedPassives,
  genderProbability,
  ivProbability,
  popcount,
} from './probability.js';
import type { OptimizationMode, PlanNode, SolveResult, TargetSpec } from './types.js';

/** Guards against a pathological search eating all memory on a huge Palbox. */
const MAX_NODES_PER_ROUND = 20000;

function ivVector(pal: Pal): number[] {
  return [pal.ivs.hp, pal.ivs.attack, pal.ivs.defense];
}

function thresholdVector(spec: TargetSpec): (number | null)[] {
  return [spec.minIvs.hp, spec.minIvs.attack, spec.minIvs.defense];
}

/** Lower is better. Ties are broken so plans stay stable between runs. */
function cost(node: PlanNode, mode: OptimizationMode): number {
  switch (mode) {
    case 'generations':
      return node.generation * 1e6 + node.totalEggs;
    case 'eggs':
      return node.totalEggs;
    case 'clean':
      return node.expectedUnwanted * 1e4 + node.totalEggs;
    case 'balanced':
      // Generations dominate, but a route that needs hundreds of eggs should lose to a
      // slightly longer one that needs a dozen.
      return node.generation * 50 + Math.log1p(node.totalEggs) * 10 + node.expectedUnwanted * 5;
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

  if (!speciesReachable) {
    return {
      feasibility: 'species-unreachable',
      plan: null,
      alternatives: [],
      missingPassives,
      existingMatches: [],
      finalGenderProbability: genderProbability(spec.speciesIndex, spec.gender),
      finalIvProbability: null,
      diagnostics,
      searchedNodes: 0,
      elapsedMs: Date.now() - started,
    };
  }

  if (missingPassives.length > 0) {
    diagnostics.push(
      `No owned Pal carries: ${missingPassives.join(', ')}. A guaranteed (non-mutation) route is impossible.`,
    );
  }

  // --- seed the search with owned Pals --------------------------------------
  const best = new Map<number, PlanNode>();
  const consider = (node: PlanNode): void => {
    const key = stateKey(node.speciesIndex, node.mask, maskCount);
    const current = best.get(key);
    if (!current || cost(node, spec.mode) < cost(current, spec.mode)) best.set(key, node);
  };

  for (const pal of candidates) {
    let mask = 0;
    for (const s of pal.passives) {
      const idx = requiredIndex.get(s.toLowerCase());
      if (idx !== undefined) mask |= 1 << idx;
    }
    consider({
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
      source: pal,
      parents: null,
      requiredGender: null,
    });
  }

  // --- breed outward --------------------------------------------------------
  const targetKeyFull = stateKey(spec.speciesIndex, fullMask, maskCount);
  let searched = best.size;

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
        return cost(a, spec.mode) - cost(b, spec.mode);
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
        // A step whose child lands on a state a parent already occupies buys nothing the
        // search can use, and always costs eggs, so skip it outright.
        if (
          (childSpecies === a.speciesIndex && childMask === a.mask) ||
          (childSpecies === b.speciesIndex && childMask === b.mask)
        ) {
          continue;
        }

        const step = breedingStep(a, b, childMask);
        if (step.successPerEgg <= 0) continue;

        const child: PlanNode = {
          speciesIndex: childSpecies,
          mask: childMask,
          generation: Math.max(a.generation, b.generation) + 1,
          poolSize: Math.max(1, desiredCount),
          stepEggs: step.stepEggs,
          passiveSuccess: step.passiveSuccess,
          genderFactor: step.genderFactor,
          genderRequirement: step.genderRequirement,
          totalEggs: a.totalEggs + b.totalEggs + step.stepEggs,
          expectedUnwanted: expectedUnwantedPassives(step.pool, desiredCount),
          source: null,
          parents: [a, b],
          requiredGender: null,
        };
        if (child.generation > spec.maxGenerations) continue;

        const key = stateKey(childSpecies, childMask, maskCount);
        const current = best.get(key);
        if (!current || cost(child, spec.mode) < cost(current, spec.mode)) {
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
    (a, b) => popcount(b.mask) - popcount(a.mask) || cost(a, spec.mode) - cost(b, spec.mode),
  );

  let finalIvProbability: number | null = null;
  if (plan?.parents && wantsIvs) {
    const [pa, pb] = plan.parents;
    // IVs only propagate from actual Pals; a bred parent's IVs are whatever you settle
    // for, so this is only meaningful when both parents are owned.
    if (pa.source && pb.source) {
      finalIvProbability = ivProbability(ivVector(pa.source), ivVector(pb.source), thresholds);
    }
  }
  if (wantsIvs && finalIvProbability === null) {
    diagnostics.push(
      'IV thresholds could not be evaluated for the final step because at least one parent is itself bred. ' +
        'Treat the IV target as uncertain and check ancestors as you go.',
    );
  }

  let feasibility: SolveResult['feasibility'];
  if (plan) feasibility = 'breedable';
  else if (missingPassives.length > 0) feasibility = 'missing-passives';
  else feasibility = 'species-unreachable';

  if (!plan && missingPassives.length === 0) {
    diagnostics.push(
      `No route found within ${spec.maxGenerations} generation(s). Try raising --max-generations or --beam.`,
    );
    feasibility = 'missing-passives';
  }

  return {
    feasibility,
    plan,
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
