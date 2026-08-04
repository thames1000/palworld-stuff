/** The Pals you tell PalForge you own, when there is no save to read them from. */
import { useState } from 'react';
import { speciesName } from '@core/data/index';
import { emptyManualPal, type ManualPalSpec } from '@core/save/manual';
import { defaultTargetSpecies, newId, type ManualPlanState } from '../lib/manualPlan';
import { PalDialog } from './PalDialog';
import { ExportButtons, ImportDialog } from './RosterTransfer';
import { Button, Modal, PassiveChip, Panel } from './ui';

const GENDER_MARK: Record<string, string> = { Male: '♂', Female: '♀', Unknown: '?' };

/** One finished entry: everything at a glance, editing behind a button. */
function PalRow({
  pal,
  index,
  onEdit,
  onRemove,
  onDuplicate,
}: {
  pal: ManualPalSpec;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-edge/60 bg-surface-1 px-3 py-2">
      <span className="nums w-6 shrink-0 text-[11px] text-ink-2">#{index + 1}</span>

      <span className="text-sm font-medium text-ink-0">{speciesName(pal.speciesIndex)}</span>
      <span
        className={`text-sm ${pal.gender === 'Unknown' ? 'text-warn' : 'text-ink-1'}`}
        title={`Gender: ${pal.gender}`}
      >
        {GENDER_MARK[pal.gender]}
      </span>
      {pal.nickname && <span className="text-xs text-ink-2">"{pal.nickname}"</span>}

      {pal.passives.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {pal.passives.map((p) => (
            <PassiveChip key={p} internalName={p} />
          ))}
        </span>
      ) : (
        <span className="text-[11px] text-ink-2">no passives</span>
      )}

      <span className="nums ml-auto text-[11px] text-ink-2">
        {pal.ivs.hp}/{pal.ivs.attack}/{pal.ivs.defense}
      </span>

      <span className="flex shrink-0 gap-1">
        <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${speciesName(pal.speciesIndex)}`}>
          Edit
        </Button>
        <Button variant="ghost" onClick={onDuplicate} aria-label="Duplicate this Pal">
          Duplicate
        </Button>
        <Button
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove ${speciesName(pal.speciesIndex)}`}
        >
          Remove
        </Button>
      </span>
    </li>
  );
}

/**
 * Confirmation for emptying the whole roster.
 *
 * Exported so it can be rendered on its own in the smoke tests, the same way the import
 * dialog is -- the alternative is driving a click, and these tests server-render.
 */
export function ClearAllDialog({
  pals,
  onConfirm,
  onCancel,
}: {
  pals: readonly ManualPalSpec[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={`Clear all ${pals.length} Pal${pals.length === 1 ? '' : 's'}?`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Keep my list
          </Button>
          {/* Offered here rather than only in the panel header: wanting a copy is most
              likely at the moment you are about to destroy the original. */}
          <ExportButtons pals={pals} />
          <Button variant="danger" onClick={onConfirm}>
            Clear all {pals.length}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-1">
        This empties your list and cannot be undone. The list is kept in this browser only, so
        unless you have exported it there is no other copy.
      </p>
    </Modal>
  );
}

export function RosterEditor({ plan }: { plan: ManualPlanState }) {
  const { roster } = plan;
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; pal: ManualPalSpec } | null>(null);
  const [importing, setImporting] = useState(false);
  // Removing one row is a single click to undo; clearing throws away everything that was
  // typed by hand, and there is no undo and no copy anywhere else. So this one asks first.
  const [confirmingClear, setConfirmingClear] = useState(false);

  const startAdd = (speciesIndex = defaultTargetSpecies()) =>
    setEditing({ mode: 'add', pal: emptyManualPal(newId('pal'), speciesIndex) });

  const submit = (pal: ManualPalSpec, again: boolean) => {
    if (editing?.mode === 'edit') plan.updatePal(pal.id, pal);
    else plan.insertPal(pal);
    // Entering a run of Pals is the normal case, so keep the species and clear the rest.
    if (again) startAdd(pal.speciesIndex);
    else setEditing(null);
  };

  const addButton = (key: string) => (
    <Button key={key} variant="primary" onClick={() => startAdd()}>
      Add a Pal
    </Button>
  );

  return (
    <Panel
      title={`My Pals (${roster.length})`}
      actions={
        <div className="flex flex-wrap gap-1">
          {roster.length > 0 && <ExportButtons pals={roster} />}
          <Button variant="ghost" onClick={() => setImporting(true)}>
            Import
          </Button>
          {roster.length > 0 && (
            <Button variant="ghost" onClick={() => setConfirmingClear(true)}>
              Clear all
            </Button>
          )}
          {addButton('top')}
        </div>
      }
    >
      {roster.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-ink-1">No Pals entered yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-ink-2">
            Add the Pals you actually have and the planner will work out routes from them, exactly
            as it would from a save. Gender and passives are what matter most — IVs only come into
            it if you set IV thresholds on the target.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={() => startAdd()}>
              Add your first Pal
            </Button>
            <Button onClick={() => setImporting(true)}>Import a list</Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {roster.map((pal, i) => (
              <PalRow
                key={pal.id}
                pal={pal}
                index={i}
                onEdit={() => setEditing({ mode: 'edit', pal })}
                onRemove={() => plan.removePal(pal.id)}
                onDuplicate={() => plan.duplicatePal(pal.id)}
              />
            ))}
          </ul>

          {/* Repeated at the foot so a long list never has to be scrolled back up. */}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-edge/50 pt-3">
            <p className="text-[11px] text-ink-2">
              Kept in this browser only — use <span className="text-ink-1">Export</span> to carry
              this list to another browser or machine. A Pal with no gender set is treated as able
              to pair with anything, which is optimistic — set it when you know it.
            </p>
            {addButton('bottom')}
          </div>
        </>
      )}

      {confirmingClear && (
        <ClearAllDialog
          pals={roster}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => {
            plan.clearRoster();
            setConfirmingClear(false);
          }}
        />
      )}

      {importing && (
        <ImportDialog
          currentCount={roster.length}
          onCancel={() => setImporting(false)}
          onImport={(pals, replace) => {
            if (replace) plan.replaceRoster(pals);
            else plan.insertPals(pals);
            setImporting(false);
          }}
        />
      )}

      {editing && (
        // Keyed so "add and enter another" resets the form rather than carrying the last Pal over.
        <PalDialog
          key={editing.pal.id}
          initial={editing.pal}
          mode={editing.mode}
          onSubmit={submit}
          onCancel={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}
