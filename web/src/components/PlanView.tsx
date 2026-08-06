/** Results panel: the verdict, then the step-by-step plan. */
import { passiveDisplayName, speciesName } from '@core/data/index';
import type { Pal } from '@core/save/types';
import { maskedPassives, type PlanStep, type PlanStepRef } from '@core/solver/steps';
import type { Feasibility, TargetSpec } from '@core/solver/types';
import type { SolveSummary } from '../worker/protocol';
import { PlanDiagram } from './PlanDiagram';
import { PassiveChip, Panel, Stat, stepOdds } from './ui';

const VERDICTS: Record<Feasibility, { title: string; tone: string; body: string }> = {
  'already-owned': {
    title: 'You already own this',
    tone: 'border-good/40 bg-good/10 text-good',
    body: 'One or more Pals in your save already meet the whole spec. No breeding needed.',
  },
  breedable: {
    title: 'Possible with Pals you own',
    tone: 'border-good/40 bg-good/10 text-good',
    body: 'A complete route exists using only Pals already in your save.',
  },
  'missing-passives': {
    title: 'Not currently possible',
    tone: 'border-warn/40 bg-warn/10 text-warn',
    body: 'The species is reachable, but the passive set is not — see below.',
  },
  'species-unreachable': {
    title: 'Impossible from what you own',
    tone: 'border-bad/40 bg-bad/10 text-bad',
    body: 'No chain of pairings from any Pal in your save produces this species. You will need to catch one.',
  },
  'no-pals': {
    title: 'No usable Pals',
    tone: 'border-bad/40 bg-bad/10 text-bad',
    body: 'Nothing in the current scope can be used for breeding. Try widening the player or guild filter.',
  },
};

function PalCard({ pal }: { pal: Pal }) {
  return (
    <div className="rounded-md border border-edge/60 bg-surface-2 px-3 py-2">
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-medium text-ink-0">{speciesName(pal.speciesIndex)}</span>
        {pal.nickname && <span className="text-xs text-ink-2">"{pal.nickname}"</span>}
        <span className="ml-auto text-[11px] text-ink-2">
          {pal.gender} · Lv{pal.level}
        </span>
      </div>
      <div className="nums mt-1 text-[11px] text-ink-2">
        IVs {pal.ivs.hp}/{pal.ivs.attack}/{pal.ivs.defense}
      </div>
      {pal.passives.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {pal.passives.map((p) => (
            <PassiveChip key={p} internalName={p} />
          ))}
        </div>
      )}
      <div className="mt-1.5 text-[11px] font-medium text-accent">{pal.location.label}</div>
    </div>
  );
}

function ParentSlot({ label, parent }: { label: string; parent: PlanStepRef }) {
  const bredLabel = parent.kind === 'bred' ? 'created in' : 'the result of';
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-2">{label}</div>
      {parent.kind === 'owned' ? (
        <PalCard pal={parent.pal} />
      ) : (
        <div className="rounded-md border border-dashed border-accent-dim/60 bg-surface-2/50 px-3 py-2">
          <div className="text-sm font-medium text-ink-0">{speciesName(parent.speciesIndex)}</div>
          <div className="mt-1 text-[11px] text-ink-1">
            {bredLabel} step {parent.step}
          </div>
        </div>
      )}
    </div>
  );
}

export function StepCard({
  step,
  required,
  minIvs,
}: {
  step: PlanStep;
  required: string[];
  minIvs?: TargetSpec['minIvs'];
}) {
  const keep = maskedPassives(step.mask, required);
  const floors = minIvs ?? { hp: null, attack: null, defense: null };
  const ivKeep = [
    floors.hp != null && floors.hp > 0 ? `HP ≥ ${floors.hp}` : null,
    floors.attack != null && floors.attack > 0 ? `Attack ≥ ${floors.attack}` : null,
    floors.defense != null && floors.defense > 0 ? `Defense ≥ ${floors.defense}` : null,
  ].filter((value): value is string => value != null);
  const odds = stepOdds({
    passiveSuccess: step.passiveSuccess,
    genderFactor: step.genderFactor,
    genderRequirement: step.genderRequirement,
    wanted: keep.map(passiveDisplayName),
  });
  return (
    <li className="rounded-lg border border-edge/60 bg-surface-1">
      <div className="flex items-center justify-between border-b border-edge/50 px-3 py-2">
        <span className="text-xs font-semibold text-ink-1">
          Step {step.index}
          {step.isFinal && <span className="ml-2 text-accent">final</span>}
        </span>
        <span className="nums text-[11px] text-ink-2">
          ~{step.expectedEggs.toFixed(1)} eggs · {odds.hatch}
          {ivKeep.length > 0 && step.ivSuccess != null
            ? ` · ${(step.ivSuccess * 100).toFixed(1)}% IVs`
            : ''}
        </span>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto_1fr]">
        <ParentSlot label="Parent A" parent={step.parents[0]} />
        <div className="hidden select-none items-center text-xl text-ink-2 md:flex">+</div>
        <ParentSlot label="Parent B" parent={step.parents[1]} />
      </div>
      <div className="border-t border-edge/50 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-ink-2">→</span>
          <span className="text-sm font-semibold text-ink-0">{speciesName(step.speciesIndex)}</span>
          {keep.length > 0 && (
            <>
              <span className="text-[11px] text-ink-2">keep only if it has</span>
              <span className="flex flex-wrap gap-1">
                {keep.map((p) => (
                  <PassiveChip key={p} internalName={p} />
                ))}
              </span>
            </>
          )}
        </div>
        {odds.gender && <p className="mt-1 text-[11px] text-ink-2">Note: {odds.gender}.</p>}
        {ivKeep.length > 0 && (
          <p className="mt-1 text-[11px] text-ink-1">
            Keep only if its IVs are <span className="nums text-ink-0">{ivKeep.join(', ')}</span>.
          </p>
        )}
        {step.expectedUnwanted >= 0.5 && (
          <p className="mt-1 text-[11px] text-ink-2">
            Expect ~{step.expectedUnwanted.toFixed(1)} unwanted passive(s) to tag along.
          </p>
        )}
      </div>
    </li>
  );
}

export function PlanView({ summary, spec }: { summary: SolveSummary | null; spec: TargetSpec }) {
  if (!summary) {
    return (
      <Panel title="Plan">
        <p className="py-8 text-center text-sm text-ink-2">
          Pick a target and press <span className="text-ink-1">Find breeding plan</span>.
        </p>
      </Panel>
    );
  }

  const verdict = VERDICTS[summary.feasibility];
  const solvedSpec = summary.spec ?? spec;

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border px-4 py-3 ${verdict.tone}`}>
        <p className="text-sm font-semibold">{verdict.title}</p>
        <p className="mt-0.5 text-xs opacity-90">{verdict.body}</p>
      </div>

      {summary.steps.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Steps" value={summary.steps.length} />
          <Stat label="Generations" value={summary.generations ?? '—'} />
          <Stat
            label="Expected eggs"
            value={summary.totalEggs != null ? Math.ceil(summary.totalEggs) : '—'}
          />
          <Stat label="Pals in scope" value={summary.candidateCount.toLocaleString()} />
        </div>
      )}

      {summary.steps.length > 0 && <PlanDiagram steps={summary.steps} spec={solvedSpec} />}

      {summary.existingMatches.length > 0 && (
        <Panel title={`Matching Pals you own (${summary.existingMatches.length})`}>
          <div className="grid gap-2 sm:grid-cols-2">
            {summary.existingMatches.map((pal) => (
              <PalCard key={pal.instanceId} pal={pal} />
            ))}
          </div>
        </Panel>
      )}

      {summary.missingPassives.length > 0 && (
        <Panel title="Missing passives">
          <p className="text-sm text-ink-1">
            No Pal in scope carries{' '}
            <span className="font-medium text-ink-0">
              {summary.missingPassives.map(passiveDisplayName).join(', ')}
            </span>
            . A guaranteed route is impossible until you catch a Pal with{' '}
            {summary.missingPassives.length > 1 ? 'those traits' : 'that trait'} — or get lucky with a
            random inheritance roll.
          </p>
        </Panel>
      )}

      {summary.steps.length > 0 && (
        <ol className="space-y-3">
          {summary.steps.map((step) => (
            <StepCard
              key={step.index}
              step={step}
              required={solvedSpec.requiredPassives}
              minIvs={solvedSpec.minIvs}
            />
          ))}
        </ol>
      )}

      {summary.steps.length === 0 && summary.alternatives.length > 0 && (
        <Panel title="Closest achievable builds">
          <ul className="space-y-2">
            {summary.alternatives.slice(0, 4).map((alt, i) => {
              const have = maskedPassives(alt.mask, solvedSpec.requiredPassives);
              return (
                <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium text-ink-0">{speciesName(alt.speciesIndex)}</span>
                  {have.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {have.map((p) => (
                        <PassiveChip key={p} internalName={p} />
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-2">none of the target passives</span>
                  )}
                  <span className="nums ml-auto text-[11px] text-ink-2">
                    {alt.generations} gen · ~{Math.ceil(alt.totalEggs)} eggs
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {(summary.diagnostics.length > 0 || summary.finalIvProbability != null) && (
        <Panel title="Notes">
          <ul className="space-y-1.5 text-xs text-ink-1">
            {summary.finalIvProbability != null && (
              <li>
                Chance the final hatch meets the requested IVs:{' '}
                <span className="nums text-ink-0">
                  {(summary.finalIvProbability * 100).toFixed(1)}%
                </span>{' '}
                per hatch. This chance is included in the final step's expected eggs.
              </li>
            )}
            {solvedSpec.gender && (
              <li>
                Chance the final hatch is {solvedSpec.gender}:{' '}
                <span className="nums text-ink-0">
                  {(summary.finalGenderProbability * 100).toFixed(0)}%
                </span>
                .
              </li>
            )}
            {summary.diagnostics.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="text-center text-[11px] text-ink-2">
        searched {summary.searchedNodes.toLocaleString()} states in {summary.elapsedMs} ms
      </p>
    </div>
  );
}
