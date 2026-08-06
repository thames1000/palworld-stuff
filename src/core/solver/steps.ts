/**
 * Turns the solver's plan tree into an ordered, presentable step list.
 *
 * The tree's leaves hold whole Pal records and are shared between branches, which is right
 * for searching but wrong for display. Flattening produces a numbered sequence where each
 * parent is either a Pal you own, a direct reference back to an earlier step, or a compact
 * "bred earlier" reference when a later branch would otherwise repeat the same subtree.
 */
import type { Pal } from '../save/types.js';
import type { GenderRequirement, PlanNode } from './types.js';

export type PlanStepRef =
  | { kind: 'owned'; pal: Pal }
  | { kind: 'step'; step: number; speciesIndex: number; mask: number }
  | { kind: 'bred'; step: number; speciesIndex: number; mask: number };

export interface PlanStep {
  /** 1-based position in the order the steps should be performed. */
  index: number;
  speciesIndex: number;
  /** Bitmask of the target's required passives this child must end up with. */
  mask: number;
  parents: [PlanStepRef, PlanStepRef];
  /** Expected hatches for this step alone. */
  expectedEggs: number;
  /**
   * Chance a hatch carries every passive this step wants.
   *
   * The child's species is fixed by the pairing. IV success is tracked separately; this is
   * 1 when nothing is riding on the passives.
   */
  passiveSuccess: number;
  /** Chance a hatch meets every IV floor requested for the route. */
  ivSuccess?: number;
  /**
   * What it costs to get this step's parents to opposite sexes, and why.
   *
   * Separate from `passiveSuccess` on purpose: it is a property of the parents, not of this
   * step's hatch, and multiplying the two into a single "per hatch" figure reads as though
   * the egg might come out the wrong species. It never does.
   */
  genderFactor: number;
  genderRequirement: GenderRequirement | null;
  expectedUnwanted: number;
  isFinal: boolean;
}

interface StepDraft {
  node: PlanNode;
  parents: [PlanStepRef, PlanStepRef];
}

function reuseKey(node: PlanNode): string {
  return [node.speciesIndex, node.mask, node.poolSize, node.requiredGender ?? 'any'].join(':');
}

/** Post-order walk, so every step occurrence's parents are produced before the step itself. */
function collect(node: PlanNode, out: StepDraft[], firstStepByState: Map<string, number>): PlanStepRef {
  if (node.source) return { kind: 'owned', pal: node.source };
  const key = reuseKey(node);
  const existingStep = firstStepByState.get(key);
  if (existingStep !== undefined) {
    return { kind: 'bred', step: existingStep, speciesIndex: node.speciesIndex, mask: node.mask };
  }

  const parents: [PlanStepRef, PlanStepRef] = [
    collect(node.parents![0], out, firstStepByState),
    collect(node.parents![1], out, firstStepByState),
  ];
  const step = out.length + 1;
  out.push({ node, parents });
  firstStepByState.set(key, step);
  return { kind: 'step', step, speciesIndex: node.speciesIndex, mask: node.mask };
}

export function flattenPlan(plan: PlanNode): PlanStep[] {
  const ordered: StepDraft[] = [];
  collect(plan, ordered, new Map());

  return ordered.map(({ node, parents }, i) => ({
    index: i + 1,
    speciesIndex: node.speciesIndex,
    mask: node.mask,
    parents,
    expectedEggs: node.stepEggs,
    passiveSuccess: node.passiveSuccess,
    ivSuccess: node.ivStepSuccess,
    genderFactor: node.genderFactor,
    genderRequirement: node.genderRequirement,
    expectedUnwanted: node.expectedUnwanted,
    isFinal: node === plan,
  }));
}

/** The required-passive internal names a mask selects, in the order the user gave them. */
export function maskedPassives(mask: number, required: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < required.length; i++) {
    if (mask & (1 << i)) out.push(required[i]!);
  }
  return out;
}
