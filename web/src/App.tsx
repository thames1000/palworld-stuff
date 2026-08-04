import { Suspense, lazy, useMemo, useState } from 'react';
import { DATASET_VERSION, findSpecies } from '@core/data/index';
import { manualPal } from '@core/save/manual';
import type { Pal } from '@core/save/types';
import type { TargetSpec } from '@core/solver/types';
import type { Scope, SolveSource } from './worker/protocol';
import { useManualPlan } from './lib/manualPlan';
import { usePalforge } from './lib/usePalforge';
import { DropZone } from './components/DropZone';
import { PalTable } from './components/PalTable';
import { PlanBuilder } from './components/PlanBuilder';
import { PlanView } from './components/PlanView';
import { RosterEditor } from './components/RosterEditor';
import { Button, Select, Spinner } from './components/ui';

/**
 * Loaded on demand: the explorer is the only surface that needs the 288x288 breeding
 * matrices, and they are ~440 kB. Everything else stays in the initial bundle.
 */
const Explorer = lazy(() =>
  import('./components/Explorer').then((m) => ({ default: m.Explorer })),
);

type Tab = 'plan' | 'pals' | 'explore';

function defaultSpec(): TargetSpec {
  const anubis = findSpecies('Anubis');
  return {
    speciesIndex: anubis >= 0 ? anubis : 0,
    requiredPassives: [],
    excludedPassives: [],
    minIvs: { hp: null, attack: null, defense: null },
    gender: null,
    maxGenerations: 5,
    mode: 'balanced',
    beamSize: 1200,
    allowExcludedParents: false,
  };
}

export default function App() {
  const forge = usePalforge();
  const manual = useManualPlan();
  const [tab, setTab] = useState<Tab>('plan');
  const [spec, setSpec] = useState<TargetSpec>(defaultSpec);
  const [scope, setScope] = useState<Scope>({ playerUid: null, guildId: null, includeParty: true });

  const manualMode = forge.mode === 'manual';

  const scopedPals = useMemo(() => {
    const save = forge.save;
    if (!save) return [];
    let pals = save.pals;
    if (scope.playerUid) pals = pals.filter((p) => p.ownerPlayerUid === scope.playerUid);
    if (scope.guildId) pals = pals.filter((p) => p.groupId === scope.guildId);
    if (!scope.includeParty) pals = pals.filter((p) => p.location.kind !== 'party');
    return pals;
  }, [forge.save, scope]);

  const rosterPals = useMemo<Pal[]>(() => manual.roster.map(manualPal), [manual.roster]);

  // Everything downstream works off one pool, whichever surface filled it.
  const pool = manualMode ? rosterPals : scopedPals;

  const solveSource: SolveSource = manualMode
    ? { kind: 'roster', pals: rosterPals }
    : { kind: 'save', scope };

  if (!manualMode && (forge.phase === 'empty' || forge.phase === 'loading' || (forge.phase === 'error' && !forge.save))) {
    return (
      <DropZone
        onPick={forge.load}
        onSkip={forge.startManual}
        busy={forge.phase === 'loading'}
        progress={forge.progress}
        error={forge.error}
      />
    );
  }

  const save = forge.save;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-edge/60 bg-surface-0/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
          <span className="text-base font-bold tracking-tight">
            Pal<span className="text-accent">Forge</span>
          </span>

          <nav className="flex rounded-md border border-edge bg-surface-1 p-0.5" role="tablist">
            {(['plan', 'pals', 'explore'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1 text-sm transition ${
                  tab === t ? 'bg-surface-3 text-ink-0' : 'text-ink-2 hover:text-ink-1'
                }`}
              >
                {t === 'plan' && 'Plan'}
                {t === 'pals' &&
                  (manualMode
                    ? `My Pals (${pool.length.toLocaleString()})`
                    : `Pals (${pool.length.toLocaleString()})`)}
                {t === 'explore' && 'Explore'}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {manualMode ? (
              <>
                <span className="rounded border border-accent-dim/60 bg-accent/10 px-2 py-1 text-[11px] text-accent">
                  Planning without a save
                </span>
                <Button variant="ghost" onClick={() => forge.reset()}>
                  Load a save instead
                </Button>
              </>
            ) : (
              save && (
                <>
                  <Select
                    value={scope.playerUid ?? 'all'}
                    onChange={(e) =>
                      setScope((s) => ({
                        ...s,
                        playerUid: e.target.value === 'all' ? null : e.target.value,
                      }))
                    }
                    className="w-44"
                    aria-label="Filter by player"
                  >
                    <option value="all">All players</option>
                    {save.players.map((p) => (
                      <option key={p.playerUid} value={p.playerUid}>
                        {p.name}
                      </option>
                    ))}
                  </Select>

                  {save.guilds.length > 1 && (
                    <Select
                      value={scope.guildId ?? 'all'}
                      onChange={(e) =>
                        setScope((s) => ({
                          ...s,
                          guildId: e.target.value === 'all' ? null : e.target.value,
                        }))
                      }
                      className="w-44"
                      aria-label="Filter by guild"
                    >
                      <option value="all">All guilds</option>
                      {save.guilds.map((g) => (
                        <option key={g.groupId} value={g.groupId}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                  )}

                  <label className="flex items-center gap-1.5 text-xs text-ink-1">
                    <input
                      type="checkbox"
                      checked={scope.includeParty}
                      onChange={(e) => setScope((s) => ({ ...s, includeParty: e.target.checked }))}
                      className="accent-[var(--color-accent)]"
                    />
                    Party
                  </label>

                  <Button variant="ghost" onClick={() => forge.reset()}>
                    Load another save
                  </Button>
                </>
              )
            )}
          </div>
        </div>

        {save && save.warnings.length > 0 && (
          <div className="border-t border-warn/25 bg-warn/8 px-4 py-1.5">
            <div className="mx-auto max-w-7xl text-[11px] text-warn">
              {save.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          </div>
        )}

        {forge.error && (
          <div className="border-t border-bad/30 bg-bad/10 px-4 py-1.5">
            <div className="mx-auto flex max-w-7xl items-center gap-3 text-[11px] text-bad">
              <span className="flex-1">{forge.error}</span>
              <button onClick={forge.dismissError} className="underline">
                dismiss
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {tab === 'plan' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
            <div className="lg:sticky lg:top-20 lg:self-start">
              <PlanBuilder
                spec={spec}
                onChange={setSpec}
                onSolve={() => forge.solve(spec, solveSource)}
                solving={forge.solving}
                candidateCount={pool.length}
                emptyHint={
                  manualMode
                    ? 'Add the Pals you own under My Pals, or build a route by hand under Explore.'
                    : undefined
                }
              />
            </div>
            <PlanView summary={forge.summary} spec={spec} />
          </div>
        )}

        {tab === 'pals' &&
          (manualMode ? (
            <RosterEditor plan={manual} />
          ) : (
            <PalTable
              pals={pool}
              onPickSpecies={(speciesIndex) => {
                setSpec((s) => ({ ...s, speciesIndex }));
                setTab('plan');
              }}
            />
          ))}

        {tab === 'explore' && (
          <Suspense
            fallback={
              <div className="py-12 text-center">
                <Spinner label="Loading the breeding table…" />
              </div>
            }
          >
            <Explorer
              tree={manual.tree}
              onTreeChange={manual.setTree}
              onResetTree={manual.resetTree}
              pool={pool}
              requiredPassives={spec.requiredPassives}
              targetSpecies={spec.speciesIndex}
              onUseAsTarget={(speciesIndex) => {
                setSpec((s) => ({ ...s, speciesIndex }));
                setTab('plan');
              }}
              onInsertToRoster={manualMode ? manual.insertPal : null}
            />
          </Suspense>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-center text-[11px] text-ink-2">
        {manualMode ? (
          <>
            {manual.roster.length} hand-entered Pal{manual.roster.length === 1 ? '' : 's'} · kept in
            this browser · PalCalc dataset {DATASET_VERSION}
          </>
        ) : (
          save && (
            <>
              {save.pals.length.toLocaleString()} Pals parsed in {save.meta.parseMs} ms ·{' '}
              {save.meta.container} container · PalCalc dataset {DATASET_VERSION} · save never leaves
              your device
            </>
          )
        )}
      </footer>
    </div>
  );
}
