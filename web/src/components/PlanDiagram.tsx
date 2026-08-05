/** Render and export a Mermaid diagram for a solved breeding plan. */
import { useEffect, useId, useMemo, useState } from 'react';
import { speciesName } from '@core/data/index';
import { renderPlanMermaid } from '@core/solver/diagram';
import type { PlanStep } from '@core/solver/steps';
import type { TargetSpec } from '@core/solver/types';
import { Button, Panel, Spinner } from './ui';

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

export function PlanDiagram({ steps, spec }: { steps: readonly PlanStep[]; spec: TargetSpec }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const source = useMemo(() => renderPlanMermaid(steps, spec), [steps, spec]);
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
        });

        const rendered = await mermaid.render(diagramId, source);
        if (!cancelled) setSvg(rendered.svg);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [diagramId, source]);

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
