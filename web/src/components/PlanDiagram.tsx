/** Render and export a Mermaid diagram for a solved breeding plan. */
import { useEffect, useId, useMemo, useState } from 'react';
import { speciesName } from '@core/data/index';
import {
  renderPlanMermaidModel,
  type MermaidPlanIcon,
  type MermaidPlanPassive,
} from '@core/solver/diagram';
import type { PlanStep } from '@core/solver/steps';
import type { TargetSpec } from '@core/solver/types';
import { Button, Panel, Spinner } from './ui';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const ICON_SIZE = 44;
const ICON_SPACE = 66;
const ICON_LABEL_SHIFT = 20;
const ICON_PADDING = 8;
const VIEWBOX_PAD = 64;
const PASSIVE_FONT_SIZE = 12;
const PASSIVE_CHIP_HEIGHT = 22;
const PASSIVE_CHIP_GAP = 5;
const PASSIVE_CHIP_X_PAD = 10;
const PASSIVE_TOP_GAP = 5;
const PASSIVE_BOTTOM_PAD = 10;
const PASSIVE_GRID_COLUMNS = 2;
const PASSIVE_GRID_ROWS = 2;
const PASSIVE_CHIP_WIDTH = 122;
const PASSIVE_GRID_WIDTH =
  PASSIVE_GRID_COLUMNS * PASSIVE_CHIP_WIDTH + (PASSIVE_GRID_COLUMNS - 1) * PASSIVE_CHIP_GAP;
const PASSIVE_GRID_HEIGHT =
  PASSIVE_GRID_ROWS * PASSIVE_CHIP_HEIGHT + (PASSIVE_GRID_ROWS - 1) * PASSIVE_CHIP_GAP;
const PASSIVE_EXTRA_HEIGHT = PASSIVE_TOP_GAP + PASSIVE_GRID_HEIGHT + PASSIVE_BOTTOM_PAD;

const PASSIVE_COLORS: Record<
  MermaidPlanPassive['tier'],
  { fill: string; stroke: string; text: string }
> = {
  diamond: { fill: '#22d3ee', stroke: '#cffafe', text: '#083344' },
  yellow: { fill: '#facc15', stroke: '#fef08a', text: '#3b2f00' },
  white: { fill: '#f8fafc', stroke: '#ffffff', text: '#111827' },
  red: { fill: '#dc2626', stroke: '#fecaca', text: '#fff1f2' },
};

function hashSource(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = Math.imul(hash, 31) + source.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function saveSvg(svg: string, speciesIndex: number): void {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  const species = speciesName(speciesIndex).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  link.href = url;
  link.download = `palforge-${species}-plan.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseSvgNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace('px', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function appendTranslate(transform: string | null, x: number, y: number): string {
  const added = `translate(${x}, ${y})`;
  return transform ? `${transform} ${added}` : added;
}

function findNodeGroup(doc: XMLDocument, nodeId: string): SVGGElement | null {
  const expectedPrefix = `flowchart-${nodeId}-`;
  const groups = Array.from(doc.querySelectorAll<SVGGElement>('g[id]'));
  return groups.find((group) => group.id === nodeId || group.id.includes(expectedPrefix)) ?? null;
}

function expandViewBox(doc: XMLDocument): void {
  const svg = doc.documentElement;
  const viewBox = svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    const [x, y, width, height] = viewBox as [number, number, number, number];
    svg.setAttribute(
      'viewBox',
      `${x - VIEWBOX_PAD} ${y - VIEWBOX_PAD / 2} ${width + VIEWBOX_PAD * 2} ${height + VIEWBOX_PAD}`,
    );
  }

  const width = parseSvgNumber(svg.getAttribute('width'));
  if (width !== null) svg.setAttribute('width', String(width + VIEWBOX_PAD * 2));

  const height = parseSvgNumber(svg.getAttribute('height'));
  if (height !== null) svg.setAttribute('height', String(height + VIEWBOX_PAD));
}

function appendPassiveChips(
  doc: XMLDocument,
  group: SVGGElement,
  passives: readonly MermaidPlanPassive[],
  rectX: number,
  rectY: number,
  rectWidth: number,
  originalRectHeight: number,
): number {
  if (passives.length === 0) return 0;

  const gridX = rectX + (rectWidth - PASSIVE_GRID_WIDTH) / 2;
  const gridY = rectY + originalRectHeight + PASSIVE_TOP_GAP;

  const chipGroup = doc.createElementNS(SVG_NS, 'g');
  chipGroup.setAttribute('class', 'palforge-diagram-passives');

  passives.slice(0, PASSIVE_GRID_COLUMNS * PASSIVE_GRID_ROWS).forEach((passive, index) => {
    const colors = PASSIVE_COLORS[passive.tier];
    const column = index % PASSIVE_GRID_COLUMNS;
    const row = Math.floor(index / PASSIVE_GRID_COLUMNS);
    const x = gridX + column * (PASSIVE_CHIP_WIDTH + PASSIVE_CHIP_GAP);
    const y = gridY + row * (PASSIVE_CHIP_HEIGHT + PASSIVE_CHIP_GAP);

    const chip = doc.createElementNS(SVG_NS, 'g');
    chip.setAttribute('class', `palforge-diagram-passive palforge-passive-${passive.tier}`);

    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(PASSIVE_CHIP_WIDTH));
    rect.setAttribute('height', String(PASSIVE_CHIP_HEIGHT));
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
    rect.setAttribute('fill', colors.fill);
    rect.setAttribute('stroke', colors.stroke);
    rect.setAttribute('stroke-width', '2.5');
    rect.setAttribute(
      'style',
      `fill: ${colors.fill}; stroke: ${colors.stroke}; stroke-width: 2.5px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.55));`,
    );

    const text = doc.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(x + PASSIVE_CHIP_WIDTH / 2));
    text.setAttribute('y', String(y + PASSIVE_CHIP_HEIGHT / 2 + 0.5));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-family', 'ui-sans-serif, system-ui, sans-serif');
    text.setAttribute('font-size', String(PASSIVE_FONT_SIZE));
    text.setAttribute('font-weight', '800');
    text.setAttribute('fill', colors.text);
    text.setAttribute(
      'style',
      `fill: ${colors.text}; font-family: ui-sans-serif, system-ui, sans-serif; font-size: ${PASSIVE_FONT_SIZE}px; font-weight: 800;`,
    );
    const naturalWidth = passive.label.length * 7.1 + PASSIVE_CHIP_X_PAD * 2;
    if (naturalWidth > PASSIVE_CHIP_WIDTH) {
      text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      text.setAttribute('textLength', String(PASSIVE_CHIP_WIDTH - PASSIVE_CHIP_X_PAD * 2));
    }
    text.textContent = passive.label;

    const title = doc.createElementNS(SVG_NS, 'title');
    title.textContent = `${passive.label} (${passive.tier} passive)`;
    chip.appendChild(title);
    chip.appendChild(rect);
    chip.appendChild(text);
    chipGroup.appendChild(chip);
  });

  group.appendChild(chipGroup);
  return PASSIVE_EXTRA_HEIGHT;
}

export function addPalIconsToSvg(svg: string, icons: readonly MermaidPlanIcon[]): string {
  if (icons.length === 0) return svg;

  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svg;

  let changed = false;
  for (const icon of icons) {
    const group = findNodeGroup(doc, icon.nodeId);
    const rect = group?.querySelector<SVGRectElement>('rect.basic.label-container, rect.label-container, rect');
    if (!group || !rect) continue;

    const x = parseSvgNumber(rect.getAttribute('x'));
    const y = parseSvgNumber(rect.getAttribute('y'));
    const width = parseSvgNumber(rect.getAttribute('width'));
    const height = parseSvgNumber(rect.getAttribute('height'));
    if (x === null || y === null || width === null || height === null) continue;

    let nextX = x - ICON_SPACE / 2;
    let nextWidth = width + ICON_SPACE;
    let passiveExtraHeight = 0;

    if (icon.passives.length > 0) {
      const wantedWidth = PASSIVE_GRID_WIDTH + 16;
      if (wantedWidth > nextWidth) {
        const widthDelta = wantedWidth - nextWidth;
        nextX -= widthDelta / 2;
        nextWidth = wantedWidth;
      }
      passiveExtraHeight = PASSIVE_EXTRA_HEIGHT;
    }

    rect.setAttribute('x', String(nextX));
    rect.setAttribute('width', String(nextWidth));
    if (passiveExtraHeight > 0) rect.setAttribute('height', String(height + passiveExtraHeight));

    const image = doc.createElementNS(SVG_NS, 'image');
    const iconX = nextX + ICON_PADDING;
    const iconY = y + (height - ICON_SIZE) / 2;
    image.setAttribute('class', 'palforge-diagram-icon');
    image.setAttribute('href', icon.url);
    image.setAttributeNS(XLINK_NS, 'xlink:href', icon.url);
    image.setAttribute('x', String(iconX));
    image.setAttribute('y', String(iconY));
    image.setAttribute('width', String(ICON_SIZE));
    image.setAttribute('height', String(ICON_SIZE));
    image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    image.setAttribute('crossorigin', 'anonymous');
    image.setAttribute('style', 'pointer-events: none;');

    const title = doc.createElementNS(SVG_NS, 'title');
    title.textContent = speciesName(icon.speciesIndex);
    image.appendChild(title);

    const label = group.querySelector<SVGGElement>('g.label');
    if (label) {
      label.setAttribute('transform', appendTranslate(label.getAttribute('transform'), ICON_LABEL_SHIFT, 0));
    }

    if (rect.parentNode) {
      rect.parentNode.insertBefore(image, rect.nextSibling);
    } else {
      group.appendChild(image);
    }

    appendPassiveChips(doc, group, icon.passives, nextX, y, nextWidth, height);
    changed = true;
  }

  if (changed) expandViewBox(doc);
  return changed ? new XMLSerializer().serializeToString(doc.documentElement) : svg;
}

export function PlanDiagram({ steps, spec }: { steps: readonly PlanStep[]; spec: TargetSpec }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const diagram = useMemo(() => renderPlanMermaidModel(steps, spec), [steps, spec]);
  const source = diagram.source;
  const diagramId = `palforge-diagram-${reactId}-${hashSource(source)}`;
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'source' | 'svg' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg('');
    setError(null);

    void import('mermaid')
      .then(async (module) => {
        const mermaid = module.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            background: '#111827',
            primaryColor: '#1f2937',
            primaryTextColor: '#f8fafc',
            primaryBorderColor: '#64748b',
            lineColor: '#94a3b8',
            secondaryColor: '#293241',
            secondaryTextColor: '#fff7ed',
            secondaryBorderColor: '#d97706',
            tertiaryColor: '#3f2e14',
            tertiaryTextColor: '#fff7ed',
            tertiaryBorderColor: '#f59e0b',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          },
          flowchart: {
            nodeSpacing: 110,
            rankSpacing: 135,
            padding: 24,
          },
        });

        const rendered = await mermaid.render(diagramId, source);
        if (!cancelled) setSvg(addPalIconsToSvg(rendered.svg, diagram.icons));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [diagram.icons, diagramId, source]);

  const copy = async (text: string, kind: 'source' | 'svg') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Panel
      title="Diagram"
      actions={
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" onClick={() => void copy(source, 'source')}>
            {copied === 'source' ? 'Copied Mermaid' : 'Copy Mermaid'}
          </Button>
          <Button variant="ghost" onClick={() => void copy(svg, 'svg')} disabled={!svg}>
            {copied === 'svg' ? 'Copied SVG' : 'Copy SVG'}
          </Button>
          <Button onClick={() => saveSvg(svg, spec.speciesIndex)} disabled={!svg}>
            Download SVG
          </Button>
        </div>
      }
    >
      <div className="overflow-auto rounded-md border border-edge/60 bg-surface-0 p-3">
        {error ? (
          <p className="py-8 text-center text-sm text-bad">{error}</p>
        ) : svg ? (
          <div
            className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-none"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="py-12 text-center">
            <Spinner label="Drawing diagram..." />
          </div>
        )}
      </div>

      <details className="mt-3 rounded-md border border-edge/60 bg-surface-2/50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-ink-1">Mermaid source</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-1">
          <code>{source}</code>
        </pre>
      </details>
    </Panel>
  );
}
