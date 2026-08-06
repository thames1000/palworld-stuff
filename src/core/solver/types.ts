import type { Pal } from '../save/types.js';
import type { GenderRequirement } from './pairing.js';
import type { IvDistribution } from './probability.js';

export type { GenderRequirement } from './pairing.js';

export type OptimizationMode = 'generations' | 'eggs' | 'clean' | 'balanced';

export type CakeVariant =
  | 'standard'
  | 'mushroom'
  | 'vegetable'
  | 'extravagant-vegetable'
  | 'special';

export interface IvThresholds {
  hp: number | null;
  attack: number | null;
  defense: number | null;
}

export interface TargetSpec {
  speciesIndex: number;
  /** Internal names of passives the finished Pal must have (max 4). */
  requiredPassives: string[];
  /** Internal names the finished Pal must not have. */
  excludedPassives: string[];
  minIvs: IvThresholds;
  gender: 'Male' | 'Female' | null;
  maxGenerations: number;
  mode: OptimizationMode;
  /** How many nodes to carry forward each generation. Higher = slower, more thorough. */
  beamSize: number;
  /** Allow Pals carrying an excluded passive to be used as parents. */
  allowExcludedParents: boolean;
  /** Breeding-farm cake variant used for this plan. Omitted means the original Cake. */
  cake?: CakeVariant;
}

export interface PlanNode {
  speciesIndex: number;
  /** Bitmask over the target's required passives that this node carries. */
  mask: number;
  /** Depth of this subtree; 0 for an owned Pal. */
  generation: number;
  /** Distinct passives assumed present when this node acts as a parent. */
  poolSize: number;
  /** Expected hatches for this step's passive and IV keep rules. 0 for an owned Pal. */
  stepEggs: number;
  /**
   * Chance a hatch at this step carries every wanted passive.
   *
   * The child's species is determined by the parents. IV success is tracked separately;
   * this is 1 for an owned Pal and for a step with no passives riding on it.
   */
  passiveSuccess: number;
  /**
   * Cost of getting this step's parents to opposite sexes.
   *
   * Kept apart from `passiveSuccess` because it is a property of the parents rather than of
   * this step's egg, and reporting the product as a per-hatch rate misleads.
   */
  genderFactor: number;
  genderRequirement: GenderRequirement | null;
  /** Expected hatches for this whole subtree, including this step. */
  totalEggs: number;
  /** Expected junk passives on this node's Pal. */
  expectedUnwanted: number;
  /** Joint probability that this Pal meets each requested IV threshold combination. */
  ivDistribution?: IvDistribution;
  /** Chance this step's hatch meets every requested IV threshold. */
  ivStepSuccess?: number;
  /** Set when this node is a Pal you already own. */
  source: Pal | null;
  parents: [PlanNode, PlanNode] | null;
  /** Gender this node must be bred as, when a sibling forced it. */
  requiredGender: 'Male' | 'Female' | null;
  /** Set when this node is obtained by accepting a mutated egg instead of the normal child. */
  mutation?: MutationStepInfo | null;
}

export type Feasibility =
  | 'already-owned'
  | 'breedable'
  | 'mutation-assisted'
  | 'mutation-only'
  | 'missing-passives'
  | 'species-unreachable'
  | 'no-pals';

export interface MutationStepInfo {
  /**
   * `regular-child` means the pair's normal child was accepted as a mutated hatch.
   * `species-result` means the mutation also changed the child species.
   */
  kind: 'regular-child' | 'species-result';
  targetShare: number;
  mutationChancePerHatch: number;
  speciesChancePerHatch: number;
  /** Mutation-exclusive passives this step assumes the mutated hatch can supply. */
  assumedPassives: string[];
  /** Target passives still inherited from the parent pool on this step. */
  inheritedPassives: string[];
  mutationIvFloor: 90;
}

export interface MutationAttempt {
  parentA: Pal;
  parentB: Pal;
  /** Share of mutated eggs from this pair that land on the target species, as 0-100. */
  targetShare: number;
  /** Chance any produced egg mutates with the selected cake. */
  mutationChancePerHatch: number;
  /** Chance a produced egg becomes the requested target species, and target gender if set. */
  speciesChancePerHatch: number;
  /** Chance the mutated target also satisfies passives and IV floors that mutation can model. */
  targetChancePerHatch: number;
  /** Expected hatches for the requested species/gender mutation. */
  expectedSpeciesHatches: number;
  /** Expected hatches for the full requested target, or null when passives/IVs block it. */
  expectedTargetHatches: number | null;
  /** Gender odds included in `targetChancePerHatch`; 1 when no gender was requested. */
  targetGenderProbability: number;
  /** Chance the mutated target carries every requested passive from these parents. */
  passiveSuccess: number;
  /** Mutation-exclusive passives this target attempt assumes the mutated hatch can supply. */
  assumedPassives: string[];
  /** Target passives still inherited from the parent pool. */
  inheritedPassives: string[];
  /** Requested passives not present on this parent pair. */
  missingPassives: string[];
  /** Chance mutation satisfies the requested IV floors. Floors up to 90 are guaranteed. */
  ivSuccess: number;
  mutationIvFloor: 90;
  reasons: Array<'no-regular-route' | 'faster-iv-target'>;
}

export interface SolveResult {
  feasibility: Feasibility;
  /** Best plan found, or null when none exists. */
  plan: PlanNode | null;
  /** Chance-based mutation options, populated only when no route exists or IV mutation is faster. */
  mutationAttempts: MutationAttempt[];
  /** Runner-up plans under the same mode, best first. */
  alternatives: PlanNode[];
  /** Required passives that no candidate Pal carries. */
  missingPassives: string[];
  /** Owned Pals that already satisfy the whole target. */
  existingMatches: Pal[];
  /** Probability the final child meets the gender requirement. */
  finalGenderProbability: number;
  /** Probability the final child meets the IV thresholds, when parents are known. */
  finalIvProbability: number | null;
  diagnostics: string[];
  searchedNodes: number;
  elapsedMs: number;
}
