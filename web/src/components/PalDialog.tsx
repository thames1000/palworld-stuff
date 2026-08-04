/**
 * Enter one Pal, all of it, in one place.
 *
 * Adding used to drop an empty card into the list for you to fill in, which meant scrolling
 * to it and back for every Pal. Here the details are gathered before the Pal exists, so the
 * list only ever holds finished entries and stays scannable however long it gets.
 */
import { useState } from 'react';
import { speciesName } from '@core/data/index';
import type { Gender } from '@core/save/types';
import type { ManualPalSpec } from '@core/save/manual';
import { PassivePicker, SpeciesPicker } from './pickers';
import { Button, Field, Modal, Select, TextInput } from './ui';

export function PalDialog({
  initial,
  mode,
  onSubmit,
  onCancel,
}: {
  initial: ManualPalSpec;
  mode: 'add' | 'edit';
  /** `again` asks for a fresh dialog rather than closing, for entering several in a row. */
  onSubmit: (pal: ManualPalSpec, again: boolean) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ManualPalSpec>(initial);
  const set = <K extends keyof ManualPalSpec>(key: K, value: ManualPalSpec[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const iv = (key: 'hp' | 'attack' | 'defense', label: string) => (
    <Field label={label}>
      <TextInput
        type="number"
        min={0}
        max={100}
        value={draft.ivs[key]}
        aria-label={`${label} IV`}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
          setDraft((d) => ({ ...d, ivs: { ...d.ivs, [key]: clamped } }));
        }}
      />
    </Field>
  );

  return (
    <Modal
      title={mode === 'add' ? 'Add a Pal' : `Edit ${speciesName(initial.speciesIndex)}`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {mode === 'add' && (
            <Button onClick={() => onSubmit(draft, true)}>Add and enter another</Button>
          )}
          <Button variant="primary" onClick={() => onSubmit(draft, false)}>
            {mode === 'add' ? 'Add Pal' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Species">
          <SpeciesPicker
            value={draft.speciesIndex}
            onChange={(speciesIndex) => set('speciesIndex', speciesIndex)}
            autoFocus
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gender" hint="Leave unset only if you genuinely do not know.">
            <Select
              value={draft.gender}
              onChange={(e) => set('gender', e.target.value as Gender)}
              aria-label="Gender"
            >
              <option value="Unknown">Not sure</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </Select>
          </Field>
          <Field label="Nickname">
            <TextInput
              value={draft.nickname}
              placeholder="Optional"
              aria-label="Nickname"
              onChange={(e) => set('nickname', e.target.value)}
            />
          </Field>
        </div>

        <Field
          label={`Passives (${draft.passives.length}/4)`}
          hint="The ones it actually has, junk included — a dirty parent really is a worse parent."
        >
          <PassivePicker
            selected={draft.passives}
            onChange={(passives) => set('passives', passives)}
            max={4}
            placeholder="Add a passive…"
          />
        </Field>

        <div>
          <div className="grid grid-cols-3 gap-2">
            {iv('hp', 'HP')}
            {iv('attack', 'Attack')}
            {iv('defense', 'Defense')}
          </div>
          <p className="mt-1 text-[11px] text-ink-2">
            IVs only matter if you set IV thresholds on the target. Leave them at 50 if you have
            not checked.
          </p>
        </div>
      </div>
    </Modal>
  );
}
