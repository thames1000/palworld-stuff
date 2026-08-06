/**
 * Scoring for breeding trees the player builds by hand.
 *
 * The automatic search answers "what should I breed?". This answers the other question:
 * "I have decided what to breed -- is it right, and what will it cost me?". You pick the
 * pairings; this checks each one against the real breeding table and runs the same egg and
 * passive math the solver uses, so a hand-built route and a solved one are directly
 * comparable.
 *
 * A tree is built top-down: the root is the Pal you want, and each slot is either a Pal you
 * already have, a pairing of two more slots, or still open. Because you choose the parents
 * and the game chooses the child, a slot records the species it is *meant* to be and the
 * evaluation reports when the parents you picked no longer produce it -- which is exactly
 * what happens when you change your mind about one branch and forget the knock-on.
 */
import { breedingResult, genderedCombosFor } from '../data/breeding.js';
import { speciesName } from '../data/index.js';
import { manualPal, type ManualPalSpec } from '../save/manual.js';
import {
  breedingStep,
  expectedUnwantedPassives,
  leavesCanBreed,
  type GenderRequirement,
} from './pairing.js';
import { popcount } from './probability.js';
import { flattenPlan, type PlanStep } from './steps.js';
import type { ManualNode } from './manualTree.js';
import type { PlanNode } from './types.js';

export type { ManualNode } from './manualTree.js';
export { newManualNode, updateManualNode } from './manualTree.js';

/** Guards against a malformed persisted tree recursing forever. */
const MAX_DEPTH = 128;

export type ManualNodeStatus = 'have' | 'bred' | 'open';

export interface ManualProblem {
  /** Id of the node the problem belongs to, so the UI can point at it. */
  nodeId: string;
  message: string;
}

export interface ManualNodeEval {
  id: string;
  /** The species this slot is meant to hold. */
  speciesIndex: number;
  status: ManualNodeStatus;
  /** What the chosen parents actually produce. Null unless this slot is bred. */
  producedSpecies: number | null;
  /** Bitmask over the required passives this slot ends up carrying. */
  mask: number;
  poolSize: number;
  generation: number;
  stepEggs: number;
  totalEggs: number;
  expectedUnwanted: number;
  /** Chance a hatch here carries every wanted passive. The species itself is a certainty. */
  passiveSuccess: number;
  /** Cost of getting this step's parents to opposite sexes -- not a per-egg chance. */
  genderFactor: number;
  genderRequirement: GenderRequirement | null;
  /** True when an open slot sits somewhere below, so the numbers are provisional. */
  speculative: boolean;
  /** Set when this pairing's result depends on which parent is male. */
  genderDependent: boolean;
  problems: string[];
  have: ManualPalSpec | null;
  parents: [ManualNodeEval, ManualNodeEval] | null;
}

export interface ManualPlan {
  root: ManualNodeEval;
  /** Every leaf is a Pal you have, so the route can actually be started. */
  complete: boolean;
  /** Complete, and no pairing disagrees with the breeding table. */
  valid: boolean;
  problems: ManualProblem[];
  /** Slots still waiting on a decision. */
  openSlots: number;
  generations: number;
  totalEggs: number;
  /** Required passives that no Pal in the tree carries. */
  missingPassives: string[];
  /** The roster Pals this tree draws on. */
  usedPals: ManualPalSpec[];
  /** Renderable steps, in the order they should be bred. Empty unless `valid`. */
  steps: PlanStep[];
}

export interface ManualPlanOptions {
  /** The target's required passives, so masks mean the same thing as in the solver. */
  requiredPassives: string[];
  /** Species the root is supposed to be, when it should be checked. */
  targetSpecies?: number;
}

interface Evaluated {
  node: ManualNodeEval;
  plan: PlanNode;
}

export function evaluateManualTree(root: ManualNode, options: ManualPlanOptions): ManualPlan {
  const required = options.requiredPassives;
  const requiredIndex = new Map(required.map((p, i) => [p.toLowerCase(), i]));

  const problems: ManualProblem[] = [];
  const usedPals: ManualPalSpec[] = [];
  const carried = new Set<string>();
  let openSlots = 0;

  const evaluate = (node: ManualNode, depth: number): Evaluated => {
    const problemsHere: string[] = [];
    const record = (message: string): void => {
      problemsHere.push(message);
      problems.push({ nodeId: node.id, message });
    };

    if (depth > MAX_DEPTH) {
      record(`Tree is nested more than ${MAX_DEPTH} deep; this branch was not evaluated.`);
      return openLeaf(node, problemsHere);
    }

    // --- a pairing ----------------------------------------------------------
    if (node.parents) {
      const a = evaluate(node.parents[0], depth + 1);
      const b = evaluate(node.parents[1], depth + 1);

      const produced = breedingResult(a.node.speciesIndex, b.node.speciesIndex);
      if (produced < 0) {
        record(
          `${speciesName(a.node.speciesIndex)} and ${speciesName(b.node.speciesIndex)} cannot breed.`,
        );
      } else if (produced !== node.speciesIndex) {
        record(
          `${speciesName(a.node.speciesIndex)} × ${speciesName(b.node.speciesIndex)} produces ` +
            `${speciesName(produced)}, not ${speciesName(node.speciesIndex)}.`,
        );
      }

      if (!leavesCanBreed(a.plan, b.plan)) {
        const samePal =
          a.node.have && b.node.have && a.node.have.id === b.node.have.id
            ? 'the same Pal cannot be both parents'
            : 'both parents are the same gender';
        record(`These two cannot be paired: ${samePal}.`);
      }

      const gendered = genderedCombosFor(a.node.speciesIndex, b.node.speciesIndex);

      const childMask = a.node.mask | b.node.mask;
      const step = breedingStep(a.plan, b.plan, childMask);
      const desiredCount = popcount(childMask);
      const speculative = a.node.speculative || b.node.speculative;

      if (step.successPerEgg <= 0 && !speculative) {
        record('This pairing can never produce the passives asked of it.');
      }

      const stepEggs = Number.isFinite(step.stepEggs) ? step.stepEggs : 0;
      const evalNode: ManualNodeEval = {
        id: node.id,
        speciesIndex: node.speciesIndex,
        status: 'bred',
        producedSpecies: produced,
        mask: childMask,
        poolSize: Math.max(1, desiredCount),
        generation: Math.max(a.node.generation, b.node.generation) + 1,
        stepEggs,
        totalEggs: a.node.totalEggs + b.node.totalEggs + stepEggs,
        expectedUnwanted: expectedUnwantedPassives(step.pool, desiredCount),
        passiveSuccess: step.passiveSuccess,
        genderFactor: step.genderFactor,
        genderRequirement: step.genderRequirement,
        speculative,
        genderDependent: gendered.length > 0,
        problems: problemsHere,
        have: null,
        parents: [a.node, b.node],
      };

      const planNode: PlanNode = {
        speciesIndex: node.speciesIndex,
        mask: childMask,
        generation: evalNode.generation,
        poolSize: evalNode.poolSize,
        stepEggs,
        passiveSuccess: step.passiveSuccess,
        genderFactor: step.genderFactor,
        genderRequirement: step.genderRequirement,
        totalEggs: evalNode.totalEggs,
        expectedUnwanted: evalNode.expectedUnwanted,
        source: null,
        parents: [a.plan, b.plan],
        requiredGender: null,
      };
      return { node: evalNode, plan: planNode };
    }

    // --- a Pal you have -----------------------------------------------------
    if (node.have) {
      const pal = node.have;
      usedPals.push(pal);
      if (pal.speciesIndex !== node.speciesIndex) {
        record(
          `This slot needs a ${speciesName(node.speciesIndex)}, but the Pal chosen is a ` +
            `${speciesName(pal.speciesIndex)}.`,
        );
      }

      let mask = 0;
      for (const passive of pal.passives) {
        carried.add(passive.toLowerCase());
        const index = requiredIndex.get(passive.toLowerCase());
        if (index !== undefined) mask |= 1 << index;
      }

      const evalNode: ManualNodeEval = {
        id: node.id,
        speciesIndex: node.speciesIndex,
        status: 'have',
        producedSpecies: null,
        mask,
        poolSize: pal.passives.length,
        generation: 0,
        stepEggs: 0,
        totalEggs: 0,
        expectedUnwanted: pal.passives.length - popcount(mask),
        passiveSuccess: 1,
        genderFactor: 1,
        genderRequirement: null,
        speculative: false,
        genderDependent: false,
        problems: problemsHere,
        have: pal,
        parents: null,
      };

      const planNode: PlanNode = {
        speciesIndex: pal.speciesIndex,
        mask,
        generation: 0,
        poolSize: pal.passives.length,
        stepEggs: 0,
        passiveSuccess: 1,
        genderFactor: 1,
        genderRequirement: null,
        totalEggs: 0,
        expectedUnwanted: evalNode.expectedUnwanted,
        source: manualPal(pal),
        parents: null,
        requiredGender: null,
      };
      return { node: evalNode, plan: planNode };
    }

    // --- still open ---------------------------------------------------------
    openSlots++;
    return openLeaf(node, problemsHere);
  };

  const result = evaluate(root, 0);

  if (options.targetSpecies !== undefined && root.speciesIndex !== options.targetSpecies) {
    problems.push({
      nodeId: root.id,
      message:
        `This tree builds a ${speciesName(root.speciesIndex)}, but the target is ` +
        `${speciesName(options.targetSpecies)}.`,
    });
  }

  // Masks union all the way up, so a passive carried by any leaf reaches the root; the
  // root's mask and the set of passives seen agree by construction. A shortfall here is
  // not a structural problem -- the tree breeds fine, it just will not carry everything
  // asked for -- so it is reported rather than making the tree invalid.
  const missingPassives = required.filter(
    (p, i) => !carried.has(p.toLowerCase()) || (result.node.mask & (1 << i)) === 0,
  );
  const complete = openSlots === 0;
  const valid = complete && problems.length === 0;

  return {
    root: result.node,
    complete,
    valid,
    problems,
    openSlots,
    generations: result.node.generation,
    totalEggs: result.node.totalEggs,
    missingPassives,
    usedPals,
    steps: valid && result.plan.parents ? flattenPlan(result.plan) : [],
  };
}

function openLeaf(node: ManualNode, problems: string[]): Evaluated {
  const evalNode: ManualNodeEval = {
    id: node.id,
    speciesIndex: node.speciesIndex,
    status: 'open',
    producedSpecies: null,
    mask: 0,
    poolSize: 0,
    generation: 0,
    stepEggs: 0,
    totalEggs: 0,
    expectedUnwanted: 0,
    passiveSuccess: 1,
    genderFactor: 1,
    genderRequirement: null,
    speculative: true,
    genderDependent: false,
    problems,
    have: null,
    parents: null,
  };
  const planNode: PlanNode = {
    speciesIndex: node.speciesIndex,
    mask: 0,
    generation: 0,
    poolSize: 0,
    stepEggs: 0,
    passiveSuccess: 1,
    genderFactor: 1,
    genderRequirement: null,
    totalEggs: 0,
    expectedUnwanted: 0,
    source: null,
    parents: null,
    requiredGender: null,
  };
  return { node: evalNode, plan: planNode };
}
