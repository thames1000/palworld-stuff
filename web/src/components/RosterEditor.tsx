/** The Pals you tell PalForge you own, when there is no save to read them from. */
import { useMemo, useState } from 'react';
import { passiveDisplayName, speciesName } from '@core/data/index';
import { emptyManualPal, type ManualPalSpec } from '@core/save/manual';
import { defaultTargetSpecies, newId, type ManualPlanState } from '../lib/manualPlan';
import { PalDialog } from './PalDialog';
import { ExportButtons, ImportDialog } from './RosterTransfer';
import { Button, Modal, PassiveChip, Panel, Select, TextInput } from './ui';

const GENDER_MARK: Record<string, string> = { Male: '♂', Female: '♀', Unknown: '?' };
const PAGE = 100;

type RosterSort = 'recent' | 'species' | 'passives' | 'hp' | 'attack' | 'defense';

function ivTone(value: number): string {
  if (value >= 90) return 'text-good';
  if (value >= 70) return 'text-ink-0';
  if (value >= 50) return 'text-ink-1';
  return 'text-ink-2';
}

function compareRoster(a: ManualPalSpec, b: ManualPalSpec, sort: RosterSort): number {
  switch (sort) {
    case 'recent':
      return 0;
    case 'species':
      return speciesName(a.speciesIndex).localeCompare(speciesName(b.speciesIndex));
    case 'passives':
      return b.passives.length - a.passives.length || compareRoster(a, b, 'species');
    case 'hp':
      return b.ivs.hp - a.ivs.hp || compareRoster(a, b, 'species');
    case 'attack':
      return b.ivs.attack - a.ivs.attack || compareRoster(a, b, 'species');
    case 'defense':
      return b.ivs.defense - a.ivs.defense || compareRoster(a, b, 'species');
  }
}

/** One finished entry: everything at a glance, editing behind a button. */
function PalRow({
  pal,
  index,
  onEdit,
  onRemove,
  onDuplicate,
  onUseAsTarget,
}: {
  pal: ManualPalSpec;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onUseAsTarget?: () => void;
}) {
  const name = speciesName(pal.speciesIndex);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-edge/60 bg-surface-1 px-3 py-2">
      <span className="nums w-6 shrink-0 text-[11px] text-ink-2">#{index + 1}</span>

      {onUseAsTarget ? (
        <button
          type="button"
          onClick={onUseAsTarget}
          className="text-left text-sm font-medium text-ink-0 transition hover:text-accent"
          title="Use as the plan target"
        >
          {name}
        </button>
      ) : (
        <span className="text-sm font-medium text-ink-0">{name}</span>
      )}
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
        <span className={ivTone(pal.ivs.hp)}>{pal.ivs.hp}</span>/
        <span className={ivTone(pal.ivs.attack)}>{pal.ivs.attack}</span>/
        <span className={ivTone(pal.ivs.defense)}>{pal.ivs.defense}</span>
      </span>

      <span className="flex shrink-0 gap-1">
        <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${name}`}>
          Edit
        </Button>
        <Button variant="ghost" onClick={onDuplicate} aria-label="Duplicate this Pal">
          Duplicate
        </Button>
        <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${name}`}>
          Remove
        </Button>
      </span>
    </li>
  );
}

function RosterControls({
  query,
  onQuery,
  gender,
  onGender,
  minIv,
  onMinIv,
  sort,
  onSort,
  onReset,
  shown,
  total,
}: {
  query: string;
  onQuery: (value: string) => void;
  gender: string;
  onGender: (value: string) => void;
  minIv: number;
  onMinIv: (value: number) => void;
  sort: RosterSort;
  onSort: (value: RosterSort) => void;
  onReset: () => void;
  shown: number;
  total: number;
}) {
  const hasFilters = query.trim() !== '' || gender !== 'any' || minIv > 0;

  return (
    <div className="mb-3 space-y-2 border-b border-edge/50 pb-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <TextInput
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search species, nickname or passive..."
            aria-label="Search My Pals"
          />
        </div>
        <Select
          value={gender}
          onChange={(e) => onGender(e.target.value)}
          className="w-32"
          aria-label="Filter My Pals by gender"
        >
          <option value="any">Any gender</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Unknown">Not sure</option>
        </Select>
        <Select
          value={String(minIv)}
          onChange={(e) => onMinIv(Number(e.target.value))}
          className="w-36"
          aria-label="Filter My Pals by best IV"
        >
          <option value="0">Any IV</option>
          <option value="70">Best IV ≥ 70</option>
          <option value="80">Best IV ≥ 80</option>
          <option value="90">Best IV ≥ 90</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => onSort(e.target.value as RosterSort)}
          className="w-40"
          aria-label="Sort My Pals"
        >
          <option value="recent">Newest first</option>
          <option value="species">Species A-Z</option>
          <option value="passives">Most passives</option>
          <option value="hp">Highest HP IV</option>
          <option value="attack">Highest attack IV</option>
          <option value="defense">Highest defense IV</option>
        </Select>
        {hasFilters && (
          <Button variant="ghost" onClick={onReset}>
            Clear filters
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-2">
        {shown.toLocaleString()} of {total.toLocaleString()} Pal{total === 1 ? '' : 's'}
      </p>
    </div>
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

export function RosterEditor({
  plan,
  onUseAsTarget,
}: {
  plan: ManualPlanState;
  onUseAsTarget?: (speciesIndex: number) => void;
}) {
  const { roster } = plan;
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; pal: ManualPalSpec } | null>(null);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('any');
  const [minIv, setMinIv] = useState(0);
  const [sort, setSort] = useState<RosterSort>('recent');
  const [limit, setLimit] = useState(PAGE);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster
      .filter((pal) => {
        if (gender !== 'any' && pal.gender !== gender) return false;
        if (minIv > 0 && Math.max(pal.ivs.hp, pal.ivs.attack, pal.ivs.defense) < minIv) {
          return false;
        }
        if (!q) return true;
        if (speciesName(pal.speciesIndex).toLowerCase().includes(q)) return true;
        if (pal.nickname.toLowerCase().includes(q)) return true;
        return pal.passives.some((p) => passiveDisplayName(p).toLowerCase().includes(q));
      })
      .sort((a, b) => compareRoster(a, b, sort));
  }, [roster, query, gender, minIv, sort]);

  const shown = filtered.slice(0, limit);

  const resetFilters = () => {
    setQuery('');
    setGender('any');
    setMinIv(0);
    setSort('recent');
    setLimit(PAGE);
  };

  const resetLimit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setLimit(PAGE);
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
          <RosterControls
            query={query}
            onQuery={resetLimit(setQuery)}
            gender={gender}
            onGender={resetLimit(setGender)}
            minIv={minIv}
            onMinIv={resetLimit(setMinIv)}
            sort={sort}
            onSort={resetLimit(setSort)}
            onReset={resetFilters}
            shown={filtered.length}
            total={roster.length}
          />

          {shown.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink-1">No Pals match those filters.</p>
              <Button className="mt-3" onClick={resetFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {shown.map((pal, i) => (
                  <PalRow
                    key={pal.id}
                    pal={pal}
                    index={i}
                    onEdit={() => setEditing({ mode: 'edit', pal })}
                    onRemove={() => plan.removePal(pal.id)}
                    onDuplicate={() => plan.duplicatePal(pal.id)}
                    onUseAsTarget={
                      onUseAsTarget ? () => onUseAsTarget(pal.speciesIndex) : undefined
                    }
                  />
                ))}
              </ul>

              {filtered.length > shown.length && (
                <div className="mt-3 text-center">
                  <Button onClick={() => setLimit((l) => l + PAGE)}>
                    Show {Math.min(PAGE, filtered.length - shown.length)} more
                  </Button>
                </div>
              )}
            </>
          )}

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
