/**
 * The cost of a single pairing.
 *
 * Both the automatic search and the hand-built tree have to answer the same question --
 * "if I put these two together, how many eggs is that?" -- and if they answered it
 * differently the manual planner would quietly disagree with the solver about the same
 * pairing. So the math lives here once and both call it.
 */
import {
  expectedUnwantedPassives,
  genderProbability,
  passiveInheritanceProbability,
  popcount,
} from './probability.js';
import type { PlanNode } from './types.js';

/** Two Pals you already own can only breed if they are one male and one female. */
export function leavesCanBreed(a: PlanNode, b: PlanNode): boolean {
  if (!a.source || !b.source) return true;
  if (a.source.instanceId === b.source.instanceId) return false;
  if (a.source.gender === 'Unknown' || b.source.gender === 'Unknown') return true;
  return a.source.gender !== b.source.gender;
}

/**
 * Why a pairing costs more than its passive odds alone.
 *
 * This is emphatically *not* uncertainty about the child: a given pair of species always
 * produces the same child. It is the cost of getting the parents themselves to be one male
 * and one female, which the model charges to the step that consumes them.
 */
export type GenderRequirement =
  /** A parent you have to breed must come out a particular sex, at this species' ratio. */
  | { kind: 'species-ratio'; speciesIndex: number; gender: 'Male' | 'Female'; probability: number }
  /** Both parents are bred, so they have to land opposite each other. */
  | { kind: 'coin-flip'; probability: number };

export interface GenderOutlook {
  factor: number;
  requirement: GenderRequirement | null;
}

/**
 * Gender cost of a pairing.
 *
 * When one parent is a Pal you own its gender is fixed, so a bred partner has to come out
 * the opposite sex -- that is a real multiplier on how many eggs the partner takes. Two
 * bred parents can be steered to opposite sexes, which costs roughly one coin flip.
 */
export function genderOutlook(a: PlanNode, b: PlanNode): GenderOutlook {
  const aFixed = a.source?.gender;
  const bFixed = b.source?.gender;
  // Both are Pals you own, and were already validated as opposite sexes.
  if (aFixed && bFixed) return { factor: 1, requirement: null };

  const bred = (fixed: 'Male' | 'Female', other: PlanNode): GenderOutlook => {
    const gender = fixed === 'Male' ? 'Female' : 'Male';
    const probability = genderProbability(other.speciesIndex, gender);
    return {
      factor: probability,
      requirement: { kind: 'species-ratio', speciesIndex: other.speciesIndex, gender, probability },
    };
  };

  if (aFixed && aFixed !== 'Unknown') return bred(aFixed, b);
  if (bFixed && bFixed !== 'Unknown') return bred(bFixed, a);
  return { factor: 0.5, requirement: { kind: 'coin-flip', probability: 0.5 } };
}

export interface BreedingStep {
  /** Distinct passives in the combined parent pool. */
  pool: number;
  /** How many of the target's required passives the child has to come out with. */
  desiredCount: number;
  /**
   * Chance a hatch carries every wanted passive.
   *
   * This is the only thing that is actually uncertain about a hatch: the child's species is
   * fixed by the parents, so a step with nothing asked of its passives is a certainty.
   */
  passiveSuccess: number;
  /** Cost of getting the parents to opposite sexes. A property of the parents, not the egg. */
  genderFactor: number;
  genderRequirement: GenderRequirement | null;
  /** `passiveSuccess * genderFactor` -- what the search ranks on. Zero means impossible. */
  successPerEgg: number;
  /** Expected hatches attributable to this step. Infinite when the step is impossible. */
  stepEggs: number;
}

/**
 * Scores one pairing, given the passive mask the child is required to carry.
 *
 * Deliberately does not include expected junk passives: the search only needs those for
 * pairs it has already decided to keep, and this runs on the order of a million times per
 * solve. Callers that want it use `expectedUnwantedPassives(pool, desiredCount)`.
 */
export function breedingStep(a: PlanNode, b: PlanNode, childMask: number): BreedingStep {
  const overlap = popcount(a.mask & b.mask);
  const pool = Math.max(1, a.poolSize + b.poolSize - overlap);
  const desiredCount = popcount(childMask);

  const passiveSuccess = passiveInheritanceProbability(pool, desiredCount);
  // Only worth asking about genders if the passives are achievable at all.
  const gender: GenderOutlook =
    passiveSuccess > 0 ? genderOutlook(a, b) : { factor: 1, requirement: null };
  const successPerEgg = passiveSuccess * gender.factor;

  return {
    pool,
    desiredCount,
    passiveSuccess,
    genderFactor: gender.factor,
    genderRequirement: gender.requirement,
    successPerEgg,
    stepEggs: successPerEgg > 0 ? 1 / successPerEgg : Infinity,
  };
}

export { expectedUnwantedPassives };
