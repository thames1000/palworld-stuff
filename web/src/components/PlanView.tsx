/** Results panel: the verdict, then the step-by-step plan. */
import { passiveDisplayName, speciesName } from '@core/data/index';
import type { Pal } from '@core/save/types';
import { cakeInfo, cakeIvBonusLabel, cakeNotes, expectedProductionCycles } from '@core/solver/cakes';
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
  'mutation-assisted': {
    title: 'Possible with mutation help',
    tone: 'border-warn/40 bg-warn/10 text-warn',
    body: 'A route exists, but it starts from at least one chance-based mutation hatch.',
  },
  'mutation-only': {
    title: 'Mutation attempt available',
    tone: 'border-warn/40 bg-warn/10 text-warn',
    body: 'No guaranteed route is available, but one or more owned pairs can try for this target through mutation.',
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

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameSpec(a: TargetSpec, b: TargetSpec): boolean {
  return (
    a.speciesIndex === b.speciesIndex &&
    sameList(a.requiredPassives, b.requiredPassives) &&
    sameList(a.excludedPassives, b.excludedPassives) &&
    a.minIvs.hp === b.minIvs.hp &&
    a.minIvs.attack === b.minIvs.attack &&
    a.minIvs.defense === b.minIvs.defense &&
    a.gender === b.gender &&
    a.maxGenerations === b.maxGenerations &&
    a.mode === b.mode &&
    a.beamSize === b.beamSize &&
    a.allowExcludedParents === b.allowExcludedParents &&
    cakeInfo(a.cake).id === cakeInfo(b.cake).id
  );
}

function ivSummary(minIvs: TargetSpec['minIvs']): string | null {
  const parts = [
    minIvs.hp != null && minIvs.hp > 0 ? `HP ≥ ${minIvs.hp}` : null,
    minIvs.attack != null && minIvs.attack > 0 ? `Attack ≥ ${minIvs.attack}` : null,
    minIvs.defense != null && minIvs.defense > 0 ? `Defense ≥ ${minIvs.defense}` : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(', ') : null;
}

function percent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const scaled = value * 100;
  if (scaled > 0 && scaled < 0.01) return '<0.01%';
  return `${scaled.toFixed(digits)}%`;
}

function sharePercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1) return '<1%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function TargetSummary({ spec }: { spec: TargetSpec }) {
  const ivs = ivSummary(spec.minIvs);
  return (
    <div className="mx-auto max-w-xl text-left">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-ink-2">Current target</span>
        <span className="text-sm font-semibold text-ink-0">{speciesName(spec.speciesIndex)}</span>
        {spec.gender && <span className="text-xs text-ink-1">{spec.gender}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {spec.requiredPassives.length > 0 ? (
          spec.requiredPassives.map((p) => <PassiveChip key={p} internalName={p} />)
        ) : (
          <span className="text-xs text-ink-2">No passive requirements</span>
        )}
      </div>
      {ivs && <div className="nums mt-2 text-xs text-ink-1">IV floors: {ivs}</div>}
      <div className="mt-2 text-xs text-ink-1">Cake: {cakeInfo(spec.cake).label}</div>
    </div>
  );
}

export function StepCard({
  step,
  required,
  minIvs,
  cake,
}: {
  step: PlanStep;
  required: string[];
  minIvs?: TargetSpec['minIvs'];
  cake?: TargetSpec['cake'];
}) {
  const keep = maskedPassives(step.mask, required);
  const floors = minIvs ?? { hp: null, attack: null, defense: null };
  const cakeDetails = cakeInfo(cake);
  const cycles = expectedProductionCycles(step.expectedEggs, cake);
  const ivBonus = cakeIvBonusLabel(cakeDetails.id);
  const mutation = step.mutation ?? null;
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
          ~{step.expectedEggs.toFixed(1)} hatches
          {cakeDetails.eggsPerCycle > 1 ? ` · ~${cycles.toFixed(1)} cycles` : ''}
          {mutation ? ` · ${percent(mutation.speciesChancePerHatch, 2)} mutation species` : ` · ${odds.hatch}`}
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
          {mutation && <span className="text-[11px] font-semibold text-warn">mutation</span>}
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
        {mutation && (
          <p className="mt-1 text-[11px] text-ink-1">
            {mutation.kind === 'regular-child' ? (
              <>
                Uses the normal child when that hatch mutates; mutation chance is{' '}
                <span className="nums text-ink-0">{percent(mutation.mutationChancePerHatch)}</span>{' '}
                per hatch.
              </>
            ) : (
              <>
                Mutation share:{' '}
                <span className="nums text-ink-0">{sharePercent(mutation.targetShare)}</span>{' '}
                of mutated eggs; base mutation chance is{' '}
                <span className="nums text-ink-0">{percent(mutation.mutationChancePerHatch)}</span>{' '}
                per hatch.
              </>
            )}
          </p>
        )}
        {mutation && mutation.assumedPassives.length > 0 && (
          <p className="mt-1 text-[11px] text-warn">
            Assumes the mutated hatch rolls{' '}
            <span className="inline-flex flex-wrap gap-1 align-middle">
              {mutation.assumedPassives.map((passive) => (
                <PassiveChip key={passive} internalName={passive} />
              ))}
            </span>
            {' '}
            <span className="nums text-ink-0">({percent(mutation.mutationPassiveChance)} of mutated hatches)</span>.
          </p>
        )}
        {mutation && mutation.inheritedPassives.length > 0 && (
          <p className="mt-1 text-[11px] text-ink-1">
            Inherits{' '}
            <span className="inline-flex flex-wrap gap-1 align-middle">
              {mutation.inheritedPassives.map((passive) => (
                <PassiveChip key={passive} internalName={passive} />
              ))}
            </span>{' '}
            from the parent pool.
          </p>
        )}
        {odds.gender && <p className="mt-1 text-[11px] text-ink-2">Note: {odds.gender}.</p>}
        {ivKeep.length > 0 && (
          <p className="mt-1 text-[11px] text-ink-1">
            {mutation
              ? `Mutated hatches are counted as minimum ${mutation.mutationIvFloor}+ IVs for this step.`
              : 'Keep only if its IVs are '}
            {!mutation && <span className="nums text-ink-0">{ivKeep.join(', ')}</span>}
          </p>
        )}
        {cakeDetails.id === 'vegetable' && (
          <p className="mt-1 text-[11px] text-good">
            Vegetable Cake turns this into about{' '}
            <span className="nums">{Math.ceil(cycles).toLocaleString()} production cycle(s)</span>.
          </p>
        )}
        {cakeDetails.id === 'mushroom' && ivKeep.length > 0 && (
          <p className="mt-1 text-[11px] text-good">
            Mushroom Cake is included in these IV odds as an estimated {ivBonus} fresh-IV uplift.
          </p>
        )}
        {cakeDetails.id === 'extravagant-vegetable' && (
          <p className="mt-1 text-[11px] text-ink-2">
            {ivKeep.length > 0
              ? `Extravagant Vegetable Cake includes an estimated ${ivBonus} fresh-IV uplift; mutation odds are shown separately when they beat the regular route.`
              : 'Extravagant Vegetable Cake is the mutation-focused choice; mutation odds are shown separately when useful.'}
          </p>
        )}
        {cakeDetails.id === 'special' && keep.length > 1 && (
          <p className="mt-1 text-[11px] text-ink-2">
            Special Cake supports multi-passive inheritance; shown passive odds use base weights.
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

function MutationAttemptCard({
  attempt,
  spec,
}: {
  attempt: NonNullable<SolveSummary['mutationAttempts']>[number];
  spec: TargetSpec;
}) {
  const fullTarget = attempt.expectedTargetHatches != null;
  const shownHatches = attempt.expectedTargetHatches ?? attempt.expectedSpeciesHatches;
  const shownCycles = expectedProductionCycles(shownHatches, spec.cake);
  const ivs = ivSummary(spec.minIvs);
  const fasterIv = attempt.reasons.includes('faster-iv-target');

  return (
    <li className="rounded-lg border border-edge/60 bg-surface-1">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge/50 px-3 py-2">
        <span className="text-xs font-semibold text-ink-1">
          {fasterIv ? 'IV shortcut' : 'Mutation fallback'}
        </span>
        <span
          className={`rounded border px-1.5 py-px text-[10px] ${
            fullTarget
              ? 'border-good/40 bg-good/12 text-good'
              : 'border-warn/40 bg-warn/12 text-warn'
          }`}
        >
          {fullTarget ? 'full target odds' : 'species-only odds'}
        </span>
        <span className="ml-auto text-sm font-semibold text-ink-0">
          {speciesName(spec.speciesIndex)}
        </span>
      </div>

      <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto_1fr]">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-2">Parent A</div>
          <PalCard pal={attempt.parentA} />
        </div>
        <div className="hidden select-none items-center text-xl text-ink-2 md:flex">+</div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-2">Parent B</div>
          <PalCard pal={attempt.parentB} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-edge/50 px-3 py-3 sm:grid-cols-4">
        <Stat label="Mutation share" value={sharePercent(attempt.targetShare)} />
        <Stat label="Species / hatch" value={percent(attempt.speciesChancePerHatch, 2)} />
        <Stat
          label={fullTarget ? 'Full target / hatch' : 'Full target'}
          value={fullTarget ? percent(attempt.targetChancePerHatch, 2) : 'blocked'}
          tone={fullTarget ? 'text-good' : 'text-warn'}
        />
        <Stat
          label={fullTarget ? 'Expected target' : 'Expected species'}
          value={`~${Math.ceil(shownHatches).toLocaleString()}`}
          tone={fasterIv ? 'text-good' : undefined}
        />
      </div>

      <div className="space-y-1.5 border-t border-edge/50 px-3 py-2 text-[11px] text-ink-1">
        <p className="nums">
          Production cycles: ~{Math.ceil(shownCycles).toLocaleString()} with {cakeInfo(spec.cake).shortLabel}.
        </p>
        {attempt.assumedPassives.length > 0 && (
          <p className="text-warn">
            Assumes the mutated hatch rolls{' '}
            <span className="inline-flex flex-wrap gap-1 align-middle">
              {attempt.assumedPassives.map((passive) => (
                <PassiveChip key={passive} internalName={passive} />
              ))}
            </span>
            {' '}
            <span className="nums text-ink-0">({percent(attempt.mutationPassiveChance)} of mutated hatches)</span>.
          </p>
        )}
        {attempt.inheritedPassives.length > 0 && attempt.missingPassives.length === 0 && (
          <p>
            Passives:{' '}
            <span className="nums text-ink-0">{percent(attempt.passiveSuccess)}</span>{' '}
            to inherit{' '}
            <span className="inline-flex flex-wrap gap-1 align-middle">
              {attempt.inheritedPassives.map((passive) => (
                <PassiveChip key={passive} internalName={passive} />
              ))}
            </span>
            .
          </p>
        )}
        {attempt.missingPassives.length > 0 && (
          <p className="text-warn">
            Passives still needed: {attempt.missingPassives.map(passiveDisplayName).join(', ')}.
          </p>
        )}
        {ivs && attempt.ivSuccess > 0 && (
          <p>
            IVs: mutated eggs are counted as minimum {attempt.mutationIvFloor}+ IVs, satisfying{' '}
            <span className="nums text-ink-0">{ivs}</span>.
          </p>
        )}
        {ivs && attempt.ivSuccess <= 0 && (
          <p className="text-warn">
            IVs: this target asks above {attempt.mutationIvFloor}, so mutation is not counted as a
            full IV solution.
          </p>
        )}
      </div>
    </li>
  );
}

function MutationAttemptsPanel({
  attempts,
  spec,
  hasRegularPlan,
}: {
  attempts: NonNullable<SolveSummary['mutationAttempts']>;
  spec: TargetSpec;
  hasRegularPlan: boolean;
}) {
  return (
    <Panel title={hasRegularPlan ? 'Mutation IV shortcut' : 'Mutation attempts'}>
      <p className="mb-3 text-sm text-ink-1">
        {hasRegularPlan
          ? 'The regular plan is still valid. These direct mutation pairs are shown because their full-target IV estimate is faster.'
          : 'These are chance-based direct pairs from your owned Pals; they are not guaranteed breeding routes.'}
      </p>
      <ol className="space-y-3">
        {attempts.map((attempt) => (
          <MutationAttemptCard
            key={`${attempt.parentA.instanceId}-${attempt.parentB.instanceId}-${attempt.reasons.join('-')}`}
            attempt={attempt}
            spec={spec}
          />
        ))}
      </ol>
    </Panel>
  );
}

export function PlanView({ summary, spec }: { summary: SolveSummary | null; spec: TargetSpec }) {
  if (!summary) {
    return (
      <Panel title="Plan">
        <div className="space-y-4 py-8 text-center">
          <TargetSummary spec={spec} />
          <p className="text-sm text-ink-2">
            Pick a target and press <span className="text-ink-1">Find breeding plan</span>.
          </p>
        </div>
      </Panel>
    );
  }

  const verdict = VERDICTS[summary.feasibility];
  const solvedSpec = summary.spec;
  const stale = !sameSpec(solvedSpec, spec);
  const cake = cakeInfo(solvedSpec.cake);
  const notes = cakeNotes(solvedSpec);
  const mutationAttempts = summary.mutationAttempts ?? [];

  return (
    <div className="space-y-4">
      {stale && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-warn">
          <p className="text-sm font-semibold">Plan is from an earlier target</p>
          <p className="mt-0.5 text-xs opacity-90">
            Showing {speciesName(solvedSpec.speciesIndex)}; current target is{' '}
            {speciesName(spec.speciesIndex)}.
          </p>
        </div>
      )}

      <div className={`rounded-lg border px-4 py-3 ${verdict.tone}`}>
        <p className="text-sm font-semibold">{verdict.title}</p>
        <p className="mt-0.5 text-xs opacity-90">{verdict.body}</p>
      </div>

      {summary.steps.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Steps" value={summary.steps.length} />
          <Stat label="Generations" value={summary.generations ?? '—'} />
          <Stat
            label="Expected hatches"
            value={summary.totalEggs != null ? Math.ceil(summary.totalEggs) : '—'}
          />
          <Stat
            label="Production cycles"
            value={
              summary.totalEggs != null
                ? Math.ceil(expectedProductionCycles(summary.totalEggs, solvedSpec.cake))
                : '—'
            }
            tone={cake.eggsPerCycle > 1 ? 'text-good' : undefined}
          />
          <Stat label="Pals in scope" value={summary.candidateCount.toLocaleString()} />
        </div>
      )}

      {summary.steps.length > 0 && <PlanDiagram steps={summary.steps} spec={solvedSpec} />}

      {mutationAttempts.length > 0 && (
        <MutationAttemptsPanel
          attempts={mutationAttempts}
          spec={solvedSpec}
          hasRegularPlan={summary.steps.length > 0}
        />
      )}

      {summary.existingMatches.length > 0 && (
        <Panel title={`Matching Pals you own (${summary.existingMatches.length})`}>
          <div className="grid gap-2 sm:grid-cols-2">
            {summary.existingMatches.map((pal) => (
              <PalCard key={pal.instanceId} pal={pal} />
            ))}
          </div>
        </Panel>
      )}

      {summary.missingPassives.length > 0 && summary.feasibility === 'mutation-assisted' && (
        <Panel title="Mutation-supplied passives">
          <p className="text-sm text-ink-1">
            No Pal in scope currently carries{' '}
            <span className="font-medium text-ink-0">
              {summary.missingPassives.map(passiveDisplayName).join(', ')}
            </span>
            . The plan assumes a mutation-created Pal supplies the missing mutation passive before
            normal breeding continues.
          </p>
        </Panel>
      )}

      {summary.missingPassives.length > 0 && summary.feasibility !== 'mutation-assisted' && (
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
              cake={solvedSpec.cake}
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
                    {alt.generations} gen · ~{Math.ceil(alt.totalEggs)} hatches
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {(summary.diagnostics.length > 0 || summary.finalIvProbability != null || cake.id !== 'standard') && (
        <Panel title="Notes">
          <ul className="space-y-1.5 text-xs text-ink-1">
            {summary.finalIvProbability != null && (
              <li>
                Chance the final hatch meets the requested IVs:{' '}
                <span className="nums text-ink-0">
                  {(summary.finalIvProbability * 100).toFixed(1)}%
                </span>{' '}
                per hatch with the selected cake. This chance is included in the final step's
                expected hatch total.
              </li>
            )}
            {cake.id !== 'standard' && (
              <li>
                Cake strategy:{' '}
                <span className="text-ink-0">
                  {cake.label} ({cake.focus})
                </span>
                .
              </li>
            )}
            {notes.map((note, i) => (
              <li key={`cake-${i}`}>{note}</li>
            ))}
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
