/** The target specification form: what you want bred, and how you want it optimised. */
import { speciesName } from '@core/data/index';
import { CAKES, cakeInfo, cakeIvBonusLabel } from '@core/solver/cakes';
import type { OptimizationMode, TargetSpec } from '@core/solver/types';
import { Button, Field, Panel, PassiveChip, Select, Spinner, TextInput } from './ui';
import { PassivePicker, SpeciesPicker } from './pickers';

const MODES: Array<{ value: OptimizationMode; label: string; hint: string }> = [
  { value: 'balanced', label: 'Balanced', hint: 'Weighs generations, hatches and junk passives together.' },
  { value: 'generations', label: 'Fewest generations', hint: 'Shortest chain, even if each step is unlikely.' },
  { value: 'eggs', label: 'Fewest hatches', hint: 'Lowest expected total hatches.' },
  { value: 'clean', label: 'Cleanest passives', hint: 'Minimises unwanted passives you will have to breed out.' },
];

export interface PlanReadiness {
  targetOwnedCount: number;
  coveredRequiredPassives: string[];
  missingRequiredPassives: string[];
  excludedCarrierCount: number;
  unknownGenderCount: number;
}

function formatIvFloors(minIvs: TargetSpec['minIvs']): string {
  const parts = [
    minIvs.hp != null && minIvs.hp > 0 ? `HP ≥ ${minIvs.hp}` : null,
    minIvs.attack != null && minIvs.attack > 0 ? `Atk ≥ ${minIvs.attack}` : null,
    minIvs.defense != null && minIvs.defense > 0 ? `Def ≥ ${minIvs.defense}` : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(', ') : 'Any';
}

function ReadinessPanel({
  readiness,
  candidateCount,
  spec,
}: {
  readiness: PlanReadiness;
  candidateCount: number;
  spec: TargetSpec;
}) {
  const passiveTotal = spec.requiredPassives.length;
  const passiveCoverage =
    passiveTotal === 0
      ? 'None required'
      : `${readiness.coveredRequiredPassives.length}/${passiveTotal} in scope`;
  const cake = cakeInfo(spec.cake);
  const ivBonus = cakeIvBonusLabel(spec.cake);
  const status =
    candidateCount === 0
      ? { label: 'No candidates', tone: 'border-bad/40 bg-bad/10 text-bad' }
      : readiness.missingRequiredPassives.length > 0
        ? { label: 'Passive missing', tone: 'border-warn/40 bg-warn/10 text-warn' }
        : { label: 'Ready to search', tone: 'border-good/40 bg-good/10 text-good' };

  return (
    <div className="border-y border-edge/50 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-ink-1">Readiness</div>
          <div className="mt-0.5 text-[11px] text-ink-2">
            Target: <span className="text-ink-1">{speciesName(spec.speciesIndex)}</span>
          </div>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${status.tone}`}>
          {status.label}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-2">Pals in scope</dt>
          <dd className="nums text-ink-0">{candidateCount.toLocaleString()}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-2">Target owned</dt>
          <dd className="nums text-ink-0">{readiness.targetOwnedCount.toLocaleString()}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-2">Required passives</dt>
          <dd className="text-ink-0">{passiveCoverage}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-2">IV floors</dt>
          <dd className="nums text-ink-0">{formatIvFloors(spec.minIvs)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-ink-2">Cake focus</dt>
          <dd className="text-ink-0">{cake.focus}</dd>
        </div>
        {cake.eggsPerCycle > 1 && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-2">Egg output</dt>
            <dd className="nums text-good">{cake.eggsPerCycle} eggs/cycle</dd>
          </div>
        )}
        {ivBonus && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-2">IV uplift</dt>
            <dd className="nums text-good">{ivBonus} fresh</dd>
          </div>
        )}
        {spec.excludedPassives.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-2">Excluded carriers</dt>
            <dd className="nums text-ink-0">{readiness.excludedCarrierCount.toLocaleString()}</dd>
          </div>
        )}
        {readiness.unknownGenderCount > 0 && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-2">Unknown gender</dt>
            <dd className="nums text-warn">{readiness.unknownGenderCount.toLocaleString()}</dd>
          </div>
        )}
      </dl>

      {readiness.missingRequiredPassives.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-warn">Missing required passives</div>
          <div className="flex flex-wrap gap-1">
            {readiness.missingRequiredPassives.map((p) => (
              <PassiveChip key={p} internalName={p} />
            ))}
          </div>
        </div>
      )}
      {readiness.unknownGenderCount > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-ink-2">
          Unknown-gender Pals can make manual routes optimistic.
        </p>
      )}
    </div>
  );
}

export function PlanBuilder({
  spec,
  onChange,
  onSolve,
  solving,
  candidateCount,
  emptyHint,
  readiness,
}: {
  spec: TargetSpec;
  onChange: (next: TargetSpec) => void;
  onSolve: () => void;
  solving: boolean;
  candidateCount: number;
  /** Shown instead of the count when there is nothing to breed from. */
  emptyHint?: string;
  readiness?: PlanReadiness;
}) {
  const set = <K extends keyof TargetSpec>(key: K, value: TargetSpec[K]) =>
    onChange({ ...spec, [key]: value });

  const ivField = (key: 'hp' | 'attack' | 'defense', label: string) => (
    <Field label={label}>
      <TextInput
        type="number"
        min={0}
        max={100}
        value={spec.minIvs[key] ?? ''}
        placeholder="any"
        onChange={(e) => {
          const raw = e.target.value.trim();
          const number = Number(raw);
          const parsed = raw === '' || !Number.isFinite(number) ? null : Math.max(0, Math.min(100, number));
          onChange({ ...spec, minIvs: { ...spec.minIvs, [key]: parsed } });
        }}
      />
    </Field>
  );

  const mode = MODES.find((m) => m.value === spec.mode);
  const cake = cakeInfo(spec.cake);

  return (
    <Panel title="Target">
      <div className="space-y-4">
        <Field label="Species">
          <SpeciesPicker value={spec.speciesIndex} onChange={(i) => set('speciesIndex', i)} />
        </Field>

        <Field
          label={`Required passives (${spec.requiredPassives.length}/4)`}
          hint="Every one of these must end up on the finished Pal."
        >
          <PassivePicker
            selected={spec.requiredPassives}
            onChange={(next) => set('requiredPassives', next)}
            max={4}
            placeholder="Add a passive…"
          />
        </Field>

        <Field
          label="Excluded passives"
          hint="Pals carrying these are kept out of the plan entirely."
        >
          <PassivePicker
            selected={spec.excludedPassives}
            onChange={(next) => set('excludedPassives', next)}
            max={8}
            placeholder="Add a passive to avoid…"
          />
        </Field>

        {readiness && (
          <ReadinessPanel readiness={readiness} candidateCount={candidateCount} spec={spec} />
        )}

        <Field label="Cake" hint={cake.effect}>
          <Select
            value={cake.id}
            onChange={(e) => set('cake', e.target.value as TargetSpec['cake'])}
            aria-label="Cake variant"
          >
            {CAKES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} - {option.focus}
              </option>
            ))}
          </Select>
        </Field>

        <div className="rounded-md border border-edge/60 bg-surface-2/40 p-3">
          <div className="text-xs font-medium text-ink-1">Final IV odds estimate</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
            Used to identify matching Pals and prefer routes likely to reach your thresholds.
            Every bred intermediate must meet these floors; IV rerolls are included in expected
            hatch totals, including selected cake modifiers.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {ivField('hp', 'HP IV')}
            {ivField('attack', 'Atk IV')}
            {ivField('defense', 'Def IV')}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Gender">
            <Select
              value={spec.gender ?? 'any'}
              onChange={(e) =>
                set('gender', e.target.value === 'any' ? null : (e.target.value as 'Male' | 'Female'))
              }
            >
              <option value="any">Either</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </Select>
          </Field>
          <Field label="Max generations">
            <TextInput
              type="number"
              min={1}
              step={1}
              value={String(spec.maxGenerations)}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                set('maxGenerations', Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1);
              }}
            />
          </Field>
        </div>

        <Field label="Optimise for" hint={mode?.hint}>
          <Select value={spec.mode} onChange={(e) => set('mode', e.target.value as OptimizationMode)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        <details className="rounded-md border border-edge/60 bg-surface-2/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-ink-1">Advanced</summary>
          <div className="mt-3 space-y-3">
            <Field
              label="Search breadth"
              hint="How many partial results are carried forward each generation. Higher finds more routes but takes longer."
            >
              <Select
                value={String(spec.beamSize)}
                onChange={(e) => set('beamSize', Number(e.target.value))}
              >
                <option value="400">Fast (400)</option>
                <option value="1200">Default (1200)</option>
                <option value="3000">Thorough (3000)</option>
              </Select>
            </Field>
            <label className="flex items-start gap-2 text-xs text-ink-1">
              <input
                type="checkbox"
                checked={spec.allowExcludedParents}
                onChange={(e) => set('allowExcludedParents', e.target.checked)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                Allow parents that carry an excluded passive
                <span className="mt-0.5 block text-ink-2">
                  Opens up more routes, at the risk of passing the trait on.
                </span>
              </span>
            </label>
          </div>
        </details>

        <div className="flex items-center justify-between gap-3 border-t border-edge/50 pt-3">
          <span className="text-xs text-ink-2">
            {candidateCount === 0 && emptyHint
              ? emptyHint
              : `${candidateCount.toLocaleString()} Pals in scope`}
          </span>
          <Button variant="primary" onClick={onSolve} disabled={solving || candidateCount === 0}>
            {solving ? <Spinner label="Solving…" /> : 'Find breeding plan'}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
