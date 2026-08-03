/**
 * Turns the solver's plan tree into an ordered, presentable step list.
 *
 * The tree's leaves hold whole Pal records and are shared between branches, which is right
 * for searching but wrong for display. Flattening produces a numbered sequence where each
 * parent is either a Pal you own or a reference back to an earlier step -- the form both
 * the CLI and the web UI actually render.
 */
import type { Pal } from '../save/types.js';
import type { PlanNode } from './types.js';

export type PlanStepRef =
  | { kind: 'owned'; pal: Pal }
  | { kind: 'step'; step: number; speciesIndex: number };

export interface PlanStep {
  /** 1-based position in the order the steps should be performed. */
  index: number;
  speciesIndex: number;
  /** Bitmask of the target's required passives this child must end up with. */
  mask: number;
  parents: [PlanStepRef, PlanStepRef];
  /** Expected eggs for this step alone. */
  expectedEggs: number;
  /** Chance any single hatch is a keeper. */
  successPerEgg: number;
  expectedUnwanted: number;
  isFinal: boolean;
}

/** Post-order walk, so every step's parents are produced before the step itself. */
function collect(node: PlanNode, out: PlanNode[]): void {
  if (!node.parents) return;
  collect(node.parents[0], out);
  collect(node.parents[1], out);
  out.push(node);
}

export function flattenPlan(plan: PlanNode): PlanStep[] {
  const ordered: PlanNode[] = [];
  collect(plan, ordered);

  const stepNumbers = new Map<PlanNode, number>();
  ordered.forEach((node, i) => stepNumbers.set(node, i + 1));

  const refFor = (node: PlanNode): PlanStepRef =>
    node.source
      ? { kind: 'owned', pal: node.source }
      : { kind: 'step', step: stepNumbers.get(node)!, speciesIndex: node.speciesIndex };

  return ordered.map((node, i) => ({
    index: i + 1,
    speciesIndex: node.speciesIndex,
    mask: node.mask,
    parents: [refFor(node.parents![0]), refFor(node.parents![1])],
    expectedEggs: node.stepEggs,
    successPerEgg: node.stepEggs > 0 ? 1 / node.stepEggs : 1,
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
