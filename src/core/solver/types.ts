import type { Pal } from '../save/types.js';

export type OptimizationMode = 'generations' | 'eggs' | 'clean' | 'balanced';

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
}

export interface PlanNode {
  speciesIndex: number;
  /** Bitmask over the target's required passives that this node carries. */
  mask: number;
  /** Depth of this subtree; 0 for an owned Pal. */
  generation: number;
  /** Distinct passives assumed present when this node acts as a parent. */
  poolSize: number;
  /** Expected eggs for this single breeding step. 0 for an owned Pal. */
  stepEggs: number;
  /** Expected eggs for this whole subtree, including this step. */
  totalEggs: number;
  /** Expected junk passives on this node's Pal. */
  expectedUnwanted: number;
  /** Set when this node is a Pal you already own. */
  source: Pal | null;
  parents: [PlanNode, PlanNode] | null;
  /** Gender this node must be bred as, when a sibling forced it. */
  requiredGender: 'Male' | 'Female' | null;
}

export type Feasibility =
  | 'already-owned'
  | 'breedable'
  | 'missing-passives'
  | 'species-unreachable'
  | 'no-pals';

export interface SolveResult {
  feasibility: Feasibility;
  /** Best plan found, or null when none exists. */
  plan: PlanNode | null;
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
