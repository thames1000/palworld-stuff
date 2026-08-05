/** Mermaid rendering for flattened breeding plans. */
import { passiveDisplayName, speciesName } from '../data/index.js';
import type { Pal } from '../save/types.js';
import { maskedPassives, type PlanStep, type PlanStepRef } from './steps.js';
import type { TargetSpec } from './types.js';

export interface MermaidPlanOptions {
  /** Mermaid flowchart direction. Top-down is easiest to read in a scrolling panel. */
  direction?: 'TD' | 'LR';
}

function escapeLabel(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function label(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).map(escapeLabel).join('<br/>');
}

function usefulPassives(pal: Pal, required: readonly string[]): string {
  const requiredSet = new Set(required.map((p) => p.toLowerCase()));
  return pal.passives
    .filter((p) => requiredSet.has(p.toLowerCase()))
    .map(passiveDisplayName)
    .join(' + ');
}

function ownedLabel(pal: Pal, required: readonly string[]): string {
  const nick = pal.nickname ? ` "${pal.nickname}"` : '';
  const carried = usefulPassives(pal, required);
  return label([
    `${speciesName(pal.speciesIndex)}${nick}`,
    carried ? `${pal.gender} - ${carried}` : pal.gender,
    pal.location.label,
  ]);
}

function stepLabel(step: PlanStep, spec: TargetSpec): string {
  const keep = maskedPassives(step.mask, spec.requiredPassives).map(passiveDisplayName);
  return label([
    `Step ${step.index}${step.isFinal ? ' - final' : ''}`,
    speciesName(step.speciesIndex),
    keep.length ? `keep ${keep.join(' + ')}` : 'no passive target',
    `~${step.expectedEggs.toFixed(1)} eggs`,
  ]);
}

/**
 * Converts the same ordered steps rendered by the UI into Mermaid source.
 *
 * The diagram deliberately stays compact: it names exact owned Pals by species/nickname
 * and location, then keeps bred nodes focused on the child, wanted passives and egg cost.
 */
export function renderPlanMermaid(
  steps: readonly PlanStep[],
  spec: TargetSpec,
  options: MermaidPlanOptions = {},
): string {
  const direction = options.direction ?? 'TD';
  const lines = [
    `flowchart ${direction}`,
    '  classDef owned fill:#1f2937,stroke:#64748b,color:#f8fafc;',
    '  classDef bred fill:#293241,stroke:#d97706,color:#fff7ed;',
    '  classDef final fill:#3f2e14,stroke:#f59e0b,color:#fff7ed,stroke-width:2px;',
  ];

  if (steps.length === 0) {
    lines.push(`  empty["${label(['No breeding steps'])}"]:::owned`);
    return lines.join('\n');
  }

  const ownedIds = new Map<string, string>();
  let ownedCount = 0;

  const idFor = (ref: PlanStepRef): string => {
    if (ref.kind === 'step') return `step_${ref.step}`;

    const key = ref.pal.instanceId || `${ref.pal.speciesIndex}-${ownedCount}`;
    const existing = ownedIds.get(key);
    if (existing) return existing;

    const id = `pal_${ownedCount++}`;
    ownedIds.set(key, id);
    lines.push(`  ${id}["${ownedLabel(ref.pal, spec.requiredPassives)}"]:::owned`);
    return id;
  };

  for (const step of steps) {
    const parentA = idFor(step.parents[0]);
    const parentB = idFor(step.parents[1]);
    const child = `step_${step.index}`;
    const tone = step.isFinal ? 'final' : 'bred';

    lines.push(`  ${child}["${stepLabel(step, spec)}"]:::${tone}`);
    lines.push(`  ${parentA} --> ${child}`);
    lines.push(`  ${parentB} --> ${child}`);
  }

  return lines.join('\n');
}
