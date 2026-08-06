/** The target specification form: what you want bred, and how you want it optimised. */
import type { OptimizationMode, TargetSpec } from '@core/solver/types';
import { Button, Field, Panel, Select, Spinner, TextInput } from './ui';
import { PassivePicker, SpeciesPicker } from './pickers';

const MODES: Array<{ value: OptimizationMode; label: string; hint: string }> = [
  { value: 'balanced', label: 'Balanced', hint: 'Weighs generations, eggs and junk passives together.' },
  { value: 'generations', label: 'Fewest generations', hint: 'Shortest chain, even if each step is unlikely.' },
  { value: 'eggs', label: 'Fewest eggs', hint: 'Lowest expected total hatches.' },
  { value: 'clean', label: 'Cleanest passives', hint: 'Minimises unwanted passives you will have to breed out.' },
];

export function PlanBuilder({
  spec,
  onChange,
  onSolve,
  solving,
  candidateCount,
  emptyHint,
}: {
  spec: TargetSpec;
  onChange: (next: TargetSpec) => void;
  onSolve: () => void;
  solving: boolean;
  candidateCount: number;
  /** Shown instead of the count when there is nothing to breed from. */
  emptyHint?: string;
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

        <div className="rounded-md border border-edge/60 bg-surface-2/40 p-3">
          <div className="text-xs font-medium text-ink-1">Final IV odds estimate</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
            Used to identify a matching Pal you already own. For a breeding plan, odds can
            currently be calculated only when both final parents are Pals you own; these values
            do not affect route selection yet.
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
            <Select
              value={String(spec.maxGenerations)}
              onChange={(e) => set('maxGenerations', Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
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
