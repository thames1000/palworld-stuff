/**
 * The shape of a hand-built breeding tree, and the pure operations on it.
 *
 * Deliberately kept apart from `manual.ts`, which scores a tree: scoring needs the 288x288
 * breeding matrices, and those are ~440 kB that the UI should not download until someone
 * actually opens the explorer. Holding, editing and persisting a tree needs none of it, so
 * everything that does only those things imports from here.
 */
import type { ManualPalSpec } from '../save/manual.js';

/**
 * One slot in a hand-built tree.
 *
 * A slot records the species it is *meant* to hold, because you choose the parents and the
 * game chooses the child; the two can disagree, and saying so is the point.
 *
 * `parents` wins over `have` when both are somehow set, so "I decided to breed this after
 * all" is never silently ignored.
 */
export interface ManualNode {
  id: string;
  /** The species this slot is meant to hold. */
  speciesIndex: number;
  /** A Pal you already have, filling this slot. */
  have: ManualPalSpec | null;
  /** The pairing chosen to produce this slot. */
  parents: [ManualNode, ManualNode] | null;
}

export function newManualNode(id: string, speciesIndex: number): ManualNode {
  return { id, speciesIndex, have: null, parents: null };
}

/**
 * Returns a copy of the tree with the node of `id` replaced by `next(node)`.
 *
 * Branches that did not change are shared rather than rebuilt, so React can skip them.
 */
export function updateManualNode(
  root: ManualNode,
  id: string,
  next: (node: ManualNode) => ManualNode,
): ManualNode {
  if (root.id === id) return next(root);
  if (!root.parents) return root;
  const a = updateManualNode(root.parents[0], id, next);
  const b = updateManualNode(root.parents[1], id, next);
  if (a === root.parents[0] && b === root.parents[1]) return root;
  return { ...root, parents: [a, b] };
}
