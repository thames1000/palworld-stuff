/** Human-readable rendering of a breeding plan. */
import { passiveDisplayName, speciesName, SPECIES } from '../core/data/index.js';
import type { Pal } from '../core/save/types.js';
import { popcount } from '../core/solver/probability.js';
import type { PlanNode, SolveResult, TargetSpec } from '../core/solver/types.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

let useColor = true;
export function setColor(enabled: boolean): void {
  useColor = enabled;
}
function c(code: string, text: string): string {
  return useColor ? `${code}${text}${RESET}` : text;
}

function maskPassives(mask: number, required: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < required.length; i++) {
    if (mask & (1 << i)) out.push(passiveDisplayName(required[i]!));
  }
  return out;
}

function describePal(pal: Pal): string {
  const bits = [speciesName(pal.speciesIndex)];
  if (pal.nickname) bits.push(`"${pal.nickname}"`);
  const passives = pal.passives.map(passiveDisplayName);
  return (
    `${bits.join(' ')} (${pal.gender}, Lv${pal.level})` +
    `  IVs ${pal.ivs.hp}/${pal.ivs.attack}/${pal.ivs.defense}` +
    (passives.length ? `  [${passives.join(', ')}]` : '  [no passives]')
  );
}

/** Post-order flatten so every step's parents are produced before the step itself. */
function collectSteps(node: PlanNode, steps: PlanNode[] = []): PlanNode[] {
  if (!node.parents) return steps;
  collectSteps(node.parents[0], steps);
  collectSteps(node.parents[1], steps);
  steps.push(node);
  return steps;
}

function nodeLabel(node: PlanNode, stepNumbers: Map<PlanNode, number>): string {
  if (node.source) return `${describePal(node.source)}\n      ${c(DIM, `at ${node.source.location.label}`)}`;
  const n = stepNumbers.get(node);
  return `${speciesName(node.speciesIndex)} from step ${n}`;
}

export function renderPlan(result: SolveResult, spec: TargetSpec): string {
  const lines: string[] = [];
  const target = speciesName(spec.speciesIndex);
  const wanted = spec.requiredPassives.map(passiveDisplayName);

  lines.push('');
  lines.push(c(BOLD, `Target: ${target}${wanted.length ? ` with ${wanted.join(' + ')}` : ''}`));
  const constraints: string[] = [];
  if (spec.gender) constraints.push(`gender ${spec.gender}`);
  if (spec.minIvs.hp) constraints.push(`HP IV >= ${spec.minIvs.hp}`);
  if (spec.minIvs.attack) constraints.push(`Attack IV >= ${spec.minIvs.attack}`);
  if (spec.minIvs.defense) constraints.push(`Defense IV >= ${spec.minIvs.defense}`);
  if (spec.excludedPassives.length) {
    constraints.push(`without ${spec.excludedPassives.map(passiveDisplayName).join(', ')}`);
  }
  if (constraints.length) lines.push(c(DIM, `        ${constraints.join(', ')}`));
  lines.push('');

  switch (result.feasibility) {
    case 'no-pals':
      lines.push(c(RED, 'No usable Pals found in this save.'));
      break;
    case 'already-owned':
      lines.push(c(GREEN, `Already possible - you own ${result.existingMatches.length} matching Pal(s):`));
      for (const pal of result.existingMatches) {
        lines.push(`  - ${describePal(pal)}`);
        lines.push(`    ${c(DIM, pal.location.label)}`);
      }
      break;
    case 'species-unreachable':
      lines.push(c(RED, `Impossible: no breeding route from any Pal you own reaches ${target}.`));
      lines.push(`You will need to catch a ${target}, or a species that leads to one.`);
      break;
    case 'missing-passives':
      lines.push(c(YELLOW, `Species reachable, but the full build is not currently possible.`));
      if (result.missingPassives.length) {
        lines.push(
          `Missing passive(s) that no owned Pal carries: ` +
            c(BOLD, result.missingPassives.map(passiveDisplayName).join(', ')),
        );
        lines.push(`Catch a Pal with those, or rely on a random-inheritance roll.`);
      }
      break;
    case 'breedable':
      lines.push(c(GREEN, 'Possible through breeding with Pals you already own.'));
      break;
  }

  if (result.plan) {
    const steps = collectSteps(result.plan);
    const stepNumbers = new Map<PlanNode, number>();
    steps.forEach((s, i) => stepNumbers.set(s, i + 1));

    lines.push('');
    lines.push(
      c(BOLD, `Plan: ${steps.length} breeding step(s), ~${Math.ceil(result.plan.totalEggs)} eggs total`),
    );
    lines.push('');

    for (const step of steps) {
      const n = stepNumbers.get(step)!;
      const [a, b] = step.parents!;
      const childPassives = maskPassives(step.mask, spec.requiredPassives);
      const isFinal = step === result.plan;

      lines.push(c(CYAN, `  Step ${n}${isFinal ? c(BOLD, '  (final)') : ''}`));
      lines.push(`    Parent A: ${nodeLabel(a, stepNumbers)}`);
      lines.push(`    Parent B: ${nodeLabel(b, stepNumbers)}`);
      lines.push(`    ${c(BOLD, '->')} ${c(BOLD, speciesName(step.speciesIndex))}`);
      if (childPassives.length) {
        lines.push(`       keep only if it has: ${childPassives.join(', ')}`);
      }
      lines.push(
        `       ${c(DIM, `~${step.stepEggs.toFixed(1)} eggs (${(100 / step.stepEggs).toFixed(1)}% per egg)` +
          `, ~${step.expectedUnwanted.toFixed(1)} junk passive(s) expected`)}`,
      );
      lines.push('');
    }

    if (spec.gender) {
      lines.push(
        c(DIM, `  Final gender ${spec.gender}: ${(result.finalGenderProbability * 100).toFixed(0)}% per hatch ` +
          `(already included in the egg estimate for intermediate steps only).`),
      );
    }
    if (result.finalIvProbability != null) {
      lines.push(
        c(DIM, `  IV thresholds on the final step: ${(result.finalIvProbability * 100).toFixed(1)}% per hatch.`),
      );
    }
  } else if (result.alternatives.length > 0) {
    lines.push('');
    lines.push(c(BOLD, 'Closest achievable builds:'));
    for (const alt of result.alternatives.slice(0, 3)) {
      const have = maskPassives(alt.mask, spec.requiredPassives);
      lines.push(
        `  - ${speciesName(alt.speciesIndex)} with ${have.length ? have.join(' + ') : 'no target passives'}` +
          c(DIM, `  (${alt.generation} generation(s), ~${Math.ceil(alt.totalEggs)} eggs)`),
      );
    }
  }

  if (result.diagnostics.length) {
    lines.push('');
    for (const d of result.diagnostics) lines.push(c(YELLOW, `  note: ${d}`));
  }

  lines.push('');
  lines.push(
    c(DIM, `  searched ${result.searchedNodes} states in ${result.elapsedMs}ms`),
  );
  lines.push('');
  return lines.join('\n');
}

/** Mermaid flowchart of the plan, for pasting into notes or a web view. */
export function renderMermaid(plan: PlanNode, spec: TargetSpec): string {
  const lines = ['flowchart TD'];
  let counter = 0;
  const ids = new Map<PlanNode, string>();

  const idFor = (node: PlanNode): string => {
    let id = ids.get(node);
    if (id) return id;
    id = `n${counter++}`;
    ids.set(node, id);
    const passives = maskPassives(node.mask, spec.requiredPassives);
    const name = speciesName(node.speciesIndex);
    const label = node.source
      ? `${name}${node.source.nickname ? ` (${node.source.nickname})` : ''}<br/>${passives.join(' + ') || 'no target passives'}<br/>${node.source.location.label}`
      : `${name}<br/>${passives.join(' + ')}`;
    lines.push(`    ${id}["${label}"]`);
    return id;
  };

  const walk = (node: PlanNode): void => {
    const id = idFor(node);
    if (!node.parents) return;
    for (const parent of node.parents) {
      walk(parent);
      lines.push(`    ${idFor(parent)} --> ${id}`);
    }
  };
  walk(plan);
  return lines.join('\n');
}

/**
 * Flattens a result into a plain JSON structure.
 *
 * The in-memory plan is a tree whose leaves hold whole Pal records, which serializes into
 * something enormous and repetitive. This emits an ordered step list instead, with each
 * parent referenced either as an owned Pal or as an earlier step number.
 */
export function planToJson(result: SolveResult, spec: TargetSpec): unknown {
  const palRef = (pal: Pal) => ({
    instanceId: pal.instanceId,
    species: speciesName(pal.speciesIndex),
    nickname: pal.nickname || null,
    gender: pal.gender,
    level: pal.level,
    ivs: pal.ivs,
    passives: pal.passives.map(passiveDisplayName),
    location: pal.location,
  });

  let steps: unknown[] = [];
  if (result.plan) {
    const ordered = collectSteps(result.plan);
    const stepNumbers = new Map<PlanNode, number>();
    ordered.forEach((s, i) => stepNumbers.set(s, i + 1));
    const parentRef = (node: PlanNode) =>
      node.source ? { kind: 'owned' as const, pal: palRef(node.source) } : { kind: 'step' as const, step: stepNumbers.get(node)! };

    steps = ordered.map((step, i) => ({
      step: i + 1,
      isFinal: step === result.plan,
      parentA: parentRef(step.parents![0]),
      parentB: parentRef(step.parents![1]),
      child: {
        species: speciesName(step.speciesIndex),
        keepIfItHas: maskPassives(step.mask, spec.requiredPassives),
      },
      expectedEggs: Number(step.stepEggs.toFixed(2)),
      successPerEgg: Number((1 / step.stepEggs).toFixed(4)),
      expectedUnwantedPassives: Number(step.expectedUnwanted.toFixed(2)),
    }));
  }

  return {
    target: {
      species: speciesName(spec.speciesIndex),
      requiredPassives: spec.requiredPassives.map(passiveDisplayName),
      excludedPassives: spec.excludedPassives.map(passiveDisplayName),
      gender: spec.gender,
      minIvs: spec.minIvs,
    },
    feasibility: result.feasibility,
    generations: result.plan?.generation ?? null,
    totalExpectedEggs: result.plan ? Number(result.plan.totalEggs.toFixed(2)) : null,
    steps,
    existingMatches: result.existingMatches.map(palRef),
    alternatives: result.alternatives.map((alt) => ({
      species: speciesName(alt.speciesIndex),
      passives: maskPassives(alt.mask, spec.requiredPassives),
      generations: alt.generation,
      expectedEggs: Number(alt.totalEggs.toFixed(2)),
    })),
    missingPassives: result.missingPassives.map(passiveDisplayName),
    finalGenderProbability: result.finalGenderProbability,
    finalIvProbability: result.finalIvProbability,
    diagnostics: result.diagnostics,
    searchedNodes: result.searchedNodes,
    elapsedMs: result.elapsedMs,
  };
}

/** Compact listing of the Pals the solver was allowed to use. */
export function renderPalList(pals: Pal[], limit: number): string {
  const lines: string[] = [];
  const bySpecies = new Map<number, number>();
  for (const p of pals) bySpecies.set(p.speciesIndex, (bySpecies.get(p.speciesIndex) ?? 0) + 1);

  lines.push(c(BOLD, `${pals.length} Pal(s) across ${bySpecies.size} species`));
  lines.push('');
  const sorted = [...pals].sort(
    (a, b) =>
      b.passives.length - a.passives.length ||
      speciesName(a.speciesIndex).localeCompare(speciesName(b.speciesIndex)),
  );
  for (const pal of sorted.slice(0, limit)) {
    lines.push(`  ${describePal(pal)}`);
    lines.push(`    ${c(DIM, pal.location.label)}`);
  }
  if (sorted.length > limit) {
    lines.push(c(DIM, `  ... and ${sorted.length - limit} more (use --limit to show more)`));
  }
  return lines.join('\n');
}

export function renderSpeciesSuggestions(indices: number[], limit: number): string {
  const named = indices
    .map((i) => SPECIES[i]!)
    .sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name))
    .slice(0, limit);
  return named.map((s) => `  - ${s.name}${s.minWildLevel ? ` (wild Lv${s.minWildLevel}-${s.maxWildLevel})` : ''}`).join('\n');
}

export { popcount };
