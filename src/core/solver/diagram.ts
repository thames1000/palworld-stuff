/** Mermaid rendering for flattened breeding plans. */
import {
  passiveColorTier,
  passiveDisplayName,
  speciesIconUrl,
  speciesName,
  type PassiveColorTier,
} from '../data/index.js';
import type { Pal } from '../save/types.js';
import { maskedPassives, type PlanStep, type PlanStepRef } from './steps.js';
import type { TargetSpec } from './types.js';

export interface MermaidPlanOptions {
  /** Mermaid flowchart direction. Top-down is easiest to read in a scrolling panel. */
  direction?: 'TD' | 'LR';
}

export interface MermaidPlanPassive {
  internalName: string;
  label: string;
  tier: PassiveColorTier;
}

export interface MermaidPlanIcon {
  nodeId: string;
  speciesIndex: number;
  url: string;
  passives: MermaidPlanPassive[];
}

export interface MermaidPlanRender {
  source: string;
  icons: MermaidPlanIcon[];
}

function escapeLabel(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;');
}

function label(lines: Array<string | null | undefined>): string {
  return escapeLabel(lines.filter((line): line is string => Boolean(line)).join(' - '));
}

function passiveBadges(passives: readonly string[]): MermaidPlanPassive[] {
  return passives.map((internalName) => ({
    internalName,
    label: passiveDisplayName(internalName),
    tier: passiveColorTier(internalName),
  }));
}

function ownedLabel(pal: Pal): string {
  const nick = pal.nickname ? ` "${pal.nickname}"` : '';
  return label([
    `${speciesName(pal.speciesIndex)}${nick}`,
    pal.gender,
    pal.location.label === 'Entered by hand' ? pal.location.label : null,
  ]);
}

function stepLabel(step: PlanStep): string {
  return label([
    `Step ${step.index}${step.isFinal ? ' final' : ''}: ${speciesName(step.speciesIndex)}`,
    `~${step.expectedEggs.toFixed(1)} eggs`,
  ]);
}

function appendPalNode(
  lines: string[],
  icons: MermaidPlanIcon[],
  id: string,
  speciesIndex: number,
  nodeLabel: string,
  passives: readonly string[],
  tone: 'owned' | 'bred' | 'final',
): void {
  const icon = speciesIconUrl(speciesIndex);
  if (icon) icons.push({ nodeId: id, speciesIndex, url: icon, passives: passiveBadges(passives) });
  lines.push(`  ${id}["${nodeLabel}"]`);
  lines.push(`  class ${id} ${tone};`);
}

/**
 * Converts the same ordered steps rendered by the UI into Mermaid source.
 *
 * The diagram deliberately keeps labels compact: passives are carried as render metadata
 * so the UI can draw color-coded badges without duplicating long text inside each node.
 */
export function renderPlanMermaidModel(
  steps: readonly PlanStep[],
  spec: TargetSpec,
  options: MermaidPlanOptions = {},
): MermaidPlanRender {
  const direction = options.direction ?? 'TD';
  const lines = [
    `flowchart ${direction}`,
    '  classDef owned fill:#1f2937,stroke:#64748b,color:#f8fafc;',
    '  classDef bred fill:#293241,stroke:#d97706,color:#fff7ed;',
    '  classDef final fill:#3f2e14,stroke:#f59e0b,color:#fff7ed,stroke-width:2px;',
  ];
  const icons: MermaidPlanIcon[] = [];

  if (steps.length === 0) {
    lines.push(`  empty["${label(['No breeding steps'])}"]`);
    lines.push('  class empty owned;');
    return { source: lines.join('\n'), icons };
  }

  let ownedCount = 0;

  const idFor = (ref: PlanStepRef): string => {
    if (ref.kind === 'step') return `step_${ref.step}`;

    const id = `pal_${ownedCount++}`;
    appendPalNode(
      lines,
      icons,
      id,
      ref.pal.speciesIndex,
      ownedLabel(ref.pal),
      ref.pal.passives,
      'owned',
    );
    return id;
  };

  for (const step of steps) {
    const parentA = idFor(step.parents[0]);
    const parentB = idFor(step.parents[1]);
    const child = `step_${step.index}`;
    const tone = step.isFinal ? 'final' : 'bred';

    appendPalNode(
      lines,
      icons,
      child,
      step.speciesIndex,
      stepLabel(step),
      maskedPassives(step.mask, spec.requiredPassives),
      tone,
    );
    lines.push(`  ${parentA} --> ${child}`);
    lines.push(`  ${parentB} --> ${child}`);
  }

  return { source: lines.join('\n'), icons };
}

export function renderPlanMermaid(
  steps: readonly PlanStep[],
  spec: TargetSpec,
  options: MermaidPlanOptions = {},
): string {
  return renderPlanMermaidModel(steps, spec, options).source;
}
