/**
 * The hand-built breeding tree.
 *
 * The Plan tab answers "what should I breed?". This answers "I want to breed it *this*
 * way — does that work, and what will it cost?". You start from the Pal you want and
 * either declare you already have it, or pick a pair that makes it and repeat on each
 * parent. Every pairing is checked against the real breeding table, and the egg estimates
 * come from the same math the solver uses, so the two are directly comparable.
 *
 * It works with or without a save: the slots are filled from whatever Pals are in scope,
 * which is either a parsed save or a roster you typed in.
 */
import { useMemo, useState } from 'react';
import { SPECIES, passiveDisplayName, speciesName } from '@core/data/index';
import { breedingResult, genderedCombosFor, type ParentPair } from '@core/data/breeding';
import type { Pal } from '@core/save/types';
import { emptyManualPal, manualFromPal, type ManualPalSpec } from '@core/save/manual';
import { evaluateManualTree, type ManualNodeEval } from '@core/solver/manual';
import { newManualNode, updateManualNode, type ManualNode } from '@core/solver/manualTree';
import { maskedPassives } from '@core/solver/steps';
import { newId } from '../lib/manualPlan';
import { PairPicker } from './PairPicker';
import { PalDialog } from './PalDialog';
import { SpeciesPicker } from './pickers';
import { StepCard } from './PlanView';
import { Button, PassiveChip, Panel, Stat, stepOdds } from './ui';

interface PickerState {
  nodeId: string;
  kind: 'pair' | 'have';
}

function sameSpec(a: ManualPalSpec, b: ManualPalSpec): boolean {
  return (
    a.speciesIndex === b.speciesIndex &&
    a.gender === b.gender &&
    a.nickname === b.nickname &&
    a.ivs.hp === b.ivs.hp &&
    a.ivs.attack === b.ivs.attack &&
    a.ivs.defense === b.ivs.defense &&
    a.passives.length === b.passives.length &&
    a.passives.every((p, i) => p === b.passives[i])
  );
}

/**
 * Refreshes the Pals a tree refers to from the current pool.
 *
 * A slot stores a copy of the Pal filling it, so the tree still means something after that
 * Pal is edited away or a different save is opened. But a stale copy would quietly plan
 * around passives you no longer have, so anything still in the pool is re-read from it.
 * Copies whose Pal has gone are left alone and flagged in the UI instead.
 */
function syncHaves(node: ManualNode, poolById: Map<string, Pal>): ManualNode {
  if (node.parents) {
    const a = syncHaves(node.parents[0], poolById);
    const b = syncHaves(node.parents[1], poolById);
    if (a === node.parents[0] && b === node.parents[1]) return node;
    return { ...node, parents: [a, b] };
  }
  if (!node.have) return node;
  const current = poolById.get(node.have.id);
  if (!current) return node;
  const fresh = manualFromPal(current);
  return sameSpec(fresh, node.have) ? node : { ...node, have: fresh };
}

/** Forward lookup: two species in, the child the game gives you out. */
function QuickLookup({ onBuild }: { onBuild: (child: number, pair: ParentPair) => void }) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(() => (SPECIES.length > 1 ? 1 : 0));
  const child = breedingResult(a, b);
  const gendered = genderedCombosFor(a, b);

  return (
    <Panel title="What do these two make?">
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <SpeciesPicker value={a} onChange={setA} />
        <span className="pb-2 text-center text-ink-2">×</span>
        <SpeciesPicker value={b} onChange={setB} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge/50 pt-3">
        <span className="text-ink-2">→</span>
        <span className="text-sm font-semibold text-ink-0">
          {child >= 0 ? speciesName(child) : 'These two cannot breed'}
        </span>
        {child >= 0 && (
          <Button variant="ghost" className="ml-auto" onClick={() => onBuild(child, [a, b])}>
            Build a tree for this
          </Button>
        )}
      </div>
      {gendered.length > 0 && (
        <p className="mt-2 text-[11px] text-warn">
          This pair is one of the few whose child depends on which parent is male: you get{' '}
          {gendered.map((c) => speciesName(c.child)).join(' or ')} depending on the genders.
        </p>
      )}
    </Panel>
  );
}

function StatusChip({ node }: { node: ManualNodeEval }) {
  if (node.status === 'have') {
    return (
      <span className="rounded border border-good/40 bg-good/12 px-1.5 py-px text-[10px] text-good">
        have
      </span>
    );
  }
  if (node.status === 'open') {
    return (
      <span className="rounded border border-warn/40 bg-warn/12 px-1.5 py-px text-[10px] text-warn">
        undecided
      </span>
    );
  }
  return (
    <span className="rounded border border-edge bg-surface-2 px-1.5 py-px text-[10px] text-ink-1">
      breed
    </span>
  );
}

function HavePicker({
  speciesIndex,
  candidates,
  onChoose,
  onRequestAdd,
  onCancel,
}: {
  speciesIndex: number;
  candidates: Pal[];
  onChoose: (pal: ManualPalSpec) => void;
  onRequestAdd: (() => void) | null;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-accent-dim/50 bg-surface-2/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-0">
          Which {speciesName(speciesIndex)}?
        </span>
        <Button variant="ghost" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {candidates.length === 0 ? (
        <div className="text-center">
          <p className="py-2 text-xs text-ink-2">
            No {speciesName(speciesIndex)} among the Pals in scope.
          </p>
          {onRequestAdd && (
            <Button onClick={onRequestAdd}>Add one to My Pals and use it</Button>
          )}
        </div>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-auto">
          {candidates.map((pal) => (
            <li key={pal.instanceId}>
              <button
                type="button"
                onClick={() => onChoose(manualFromPal(pal))}
                className="w-full rounded border border-edge/60 bg-surface-1 px-2.5 py-1.5 text-left transition hover:border-accent-dim hover:bg-surface-2"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm text-ink-0">
                    {pal.nickname || speciesName(pal.speciesIndex)}
                  </span>
                  <span className="text-[11px] text-ink-2">{pal.gender}</span>
                  <span className="nums ml-auto text-[11px] text-ink-2">
                    {pal.ivs.hp}/{pal.ivs.attack}/{pal.ivs.defense}
                  </span>
                </div>
                {pal.passives.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {pal.passives.map((p) => (
                      <PassiveChip key={p} internalName={p} />
                    ))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NodeView({
  node,
  depth,
  requiredPassives,
  picker,
  setPicker,
  owned,
  poolBySpecies,
  poolById,
  onChoosePair,
  onChooseHave,
  onClear,
  onRequestAdd,
}: {
  node: ManualNodeEval;
  depth: number;
  requiredPassives: string[];
  picker: PickerState | null;
  setPicker: (next: PickerState | null) => void;
  owned: ReadonlySet<number>;
  poolBySpecies: Map<number, Pal[]>;
  poolById: Map<string, Pal>;
  onChoosePair: (nodeId: string, pair: ParentPair) => void;
  onChooseHave: (nodeId: string, pal: ManualPalSpec) => void;
  onClear: (nodeId: string) => void;
  onRequestAdd: ((nodeId: string, speciesIndex: number) => void) | null;
}) {
  const open = picker?.nodeId === node.id ? picker.kind : null;
  const source = node.have ? poolById.get(node.have.id) : undefined;
  const location = source?.location.label;
  // A slot can outlive the Pal filling it -- deleted from the roster, or a different save
  // opened since. The plan would otherwise assume you still have it.
  const orphaned = node.have != null && source === undefined;
  const odds = stepOdds({
    passiveSuccess: node.passiveSuccess,
    genderFactor: node.genderFactor,
    genderRequirement: node.genderRequirement,
    wanted: maskedPassives(node.mask, requiredPassives).map(passiveDisplayName),
  });

  return (
    <li className={depth > 0 ? 'border-l border-edge/60 pl-3' : ''}>
      <div className="rounded-lg border border-edge/60 bg-surface-1 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink-0">{speciesName(node.speciesIndex)}</span>
          <StatusChip node={node} />
          {node.status === 'bred' && !node.speculative && Number.isFinite(node.stepEggs) && (
            <span className="nums text-[11px] text-ink-2">
              ~{node.stepEggs.toFixed(1)} eggs · {odds.hatch}
            </span>
          )}
          {node.genderDependent && (
            <span className="rounded border border-warn/40 bg-warn/12 px-1.5 py-px text-[10px] text-warn">
              result depends on gender
            </span>
          )}
          {orphaned && (
            <span className="rounded border border-warn/40 bg-warn/12 px-1.5 py-px text-[10px] text-warn">
              no longer in scope
            </span>
          )}

          <span className="ml-auto flex gap-1">
            {node.status === 'open' ? (
              <>
                <Button variant="ghost" onClick={() => setPicker({ nodeId: node.id, kind: 'have' })}>
                  I have one
                </Button>
                <Button variant="ghost" onClick={() => setPicker({ nodeId: node.id, kind: 'pair' })}>
                  Breed it
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setPicker({ nodeId: node.id, kind: node.status === 'have' ? 'have' : 'pair' })
                  }
                >
                  Change
                </Button>
                <Button variant="ghost" onClick={() => onClear(node.id)}>
                  Clear
                </Button>
              </>
            )}
          </span>
        </div>

        {node.have && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-2">
            {node.have.nickname && <span className="text-ink-1">"{node.have.nickname}"</span>}
            <span>{node.have.gender}</span>
            <span className="nums">
              {node.have.ivs.hp}/{node.have.ivs.attack}/{node.have.ivs.defense}
            </span>
            {node.have.passives.map((p) => (
              <PassiveChip key={p} internalName={p} />
            ))}
            {location && <span className="text-accent">{location}</span>}
          </div>
        )}

        {node.status === 'bred' && !node.speculative && odds.gender && (
          <p className="mt-1 text-[11px] text-ink-2">Note: {odds.gender}.</p>
        )}

        {node.status === 'open' && (
          <p className="mt-1 text-[11px] text-ink-2">
            Say whether you have one of these, or pick a pair that makes it.
          </p>
        )}

        {node.problems.map((problem, i) => (
          <p key={i} className="mt-1 text-[11px] text-bad">
            {problem}
          </p>
        ))}

        {open === 'pair' && (
          <PairPicker
            child={node.speciesIndex}
            owned={owned}
            onChoose={(pair) => onChoosePair(node.id, pair)}
            onCancel={() => setPicker(null)}
          />
        )}
        {open === 'have' && (
          <HavePicker
            speciesIndex={node.speciesIndex}
            candidates={poolBySpecies.get(node.speciesIndex) ?? []}
            onChoose={(pal) => onChooseHave(node.id, pal)}
            onRequestAdd={onRequestAdd ? () => onRequestAdd(node.id, node.speciesIndex) : null}
            onCancel={() => setPicker(null)}
          />
        )}
      </div>

      {node.parents && (
        <ul className="mt-2 space-y-2 pl-3">
          {node.parents.map((parent) => (
            <NodeView
              key={parent.id}
              node={parent}
              depth={depth + 1}
              requiredPassives={requiredPassives}
              picker={picker}
              setPicker={setPicker}
              owned={owned}
              poolBySpecies={poolBySpecies}
              poolById={poolById}
              onChoosePair={onChoosePair}
              onChooseHave={onChooseHave}
              onClear={onClear}
              onRequestAdd={onRequestAdd}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Explorer({
  tree,
  onTreeChange,
  onResetTree,
  pool,
  requiredPassives,
  targetSpecies,
  onUseAsTarget,
  onInsertToRoster = null,
}: {
  tree: ManualNode;
  onTreeChange: (next: ManualNode) => void;
  onResetTree: (speciesIndex: number) => void;
  /** Pals available to fill slots — a scoped save, or a hand-entered roster. */
  pool: Pal[];
  requiredPassives: string[];
  targetSpecies: number;
  onUseAsTarget: (speciesIndex: number) => void;
  /** Manual mode only: add a Pal to the roster from here. */
  onInsertToRoster?: ((pal: ManualPalSpec) => void) | null;
}) {
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pendingRoot, setPendingRoot] = useState<number | null>(null);
  /** An open "add this Pal to my roster" dialog, and the slot that asked for it. */
  const [adding, setAdding] = useState<{ nodeId: string; pal: ManualPalSpec } | null>(null);

  const { owned, poolBySpecies, poolById } = useMemo(() => {
    const bySpecies = new Map<number, Pal[]>();
    const byId = new Map<string, Pal>();
    for (const pal of pool) {
      const list = bySpecies.get(pal.speciesIndex);
      if (list) list.push(pal);
      else bySpecies.set(pal.speciesIndex, [pal]);
      byId.set(pal.instanceId, pal);
    }
    return { owned: new Set(bySpecies.keys()), poolBySpecies: bySpecies, poolById: byId };
  }, [pool]);

  const plan = useMemo(
    () => evaluateManualTree(syncHaves(tree, poolById), { requiredPassives }),
    [tree, poolById, requiredPassives],
  );

  const empty = !tree.parents && !tree.have;

  const choosePair = (nodeId: string, [a, b]: ParentPair) => {
    onTreeChange(
      updateManualNode(tree, nodeId, (node) => ({
        ...node,
        have: null,
        parents: [newManualNode(newId('node'), a), newManualNode(newId('node'), b)],
      })),
    );
    setPicker(null);
  };

  const chooseHave = (nodeId: string, pal: ManualPalSpec) => {
    onTreeChange(
      updateManualNode(tree, nodeId, (node) => ({ ...node, have: pal, parents: null })),
    );
    setPicker(null);
  };

  const clearNode = (nodeId: string) => {
    onTreeChange(updateManualNode(tree, nodeId, (node) => ({ ...node, have: null, parents: null })));
    setPicker(null);
  };

  const requestAdd = (nodeId: string, speciesIndex: number) => {
    setAdding({ nodeId, pal: emptyManualPal(newId('pal'), speciesIndex) });
  };

  const changeRoot = (speciesIndex: number) => {
    if (speciesIndex === tree.speciesIndex) return;
    if (empty) onResetTree(speciesIndex);
    else setPendingRoot(speciesIndex);
  };

  const buildFromLookup = (child: number, [a, b]: ParentPair) => {
    onTreeChange({
      id: newId('node'),
      speciesIndex: child,
      have: null,
      parents: [newManualNode(newId('node'), a), newManualNode(newId('node'), b)],
    });
    setPicker(null);
    setPendingRoot(null);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Tree"
        actions={
          <div className="flex gap-1">
            {tree.speciesIndex !== targetSpecies && (
              <Button variant="ghost" onClick={() => onUseAsTarget(tree.speciesIndex)}>
                Use as plan target
              </Button>
            )}
            {!empty && (
              <Button variant="ghost" onClick={() => onResetTree(tree.speciesIndex)}>
                Start over
              </Button>
            )}
          </div>
        }
      >
        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium text-ink-1">What do you want to end up with?</span>
          <SpeciesPicker value={pendingRoot ?? tree.speciesIndex} onChange={changeRoot} />
          {pendingRoot != null && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              <span>Switching to {speciesName(pendingRoot)} discards the tree below.</span>
              <span className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  onClick={() => {
                    onResetTree(pendingRoot);
                    setPendingRoot(null);
                    setPicker(null);
                  }}
                >
                  Switch
                </Button>
                <Button variant="ghost" onClick={() => setPendingRoot(null)}>
                  Keep current
                </Button>
              </span>
            </div>
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Steps" value={plan.complete ? plan.steps.length : '—'} />
          <Stat label="Generations" value={plan.generations} />
          <Stat
            label="Expected eggs"
            value={plan.complete && plan.valid ? Math.ceil(plan.totalEggs) : '—'}
          />
          <Stat
            label="Undecided"
            value={plan.openSlots}
            tone={plan.openSlots > 0 ? 'text-warn' : 'text-good'}
          />
        </div>

        {plan.problems.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {plan.problems.map((problem, i) => (
              <li key={i}>{problem.message}</li>
            ))}
          </ul>
        )}

        {plan.complete && plan.valid && plan.missingPassives.length > 0 && (
          <p className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            This route breeds fine, but nothing in it carries{' '}
            {plan.missingPassives.map((p) => (
              <PassiveChip key={p} internalName={p} />
            ))}{' '}
            — the finished Pal will not have{' '}
            {plan.missingPassives.length > 1 ? 'those passives' : 'that passive'}.
          </p>
        )}

        {plan.complete && plan.valid && plan.steps.length === 0 && (
          <p className="mb-3 rounded-md border border-good/40 bg-good/10 px-3 py-2 text-xs text-good">
            You already have this one — no breeding needed.
          </p>
        )}

        <ul className="space-y-2">
          <NodeView
            node={plan.root}
            depth={0}
            requiredPassives={requiredPassives}
            picker={picker}
            setPicker={setPicker}
            owned={owned}
            poolBySpecies={poolBySpecies}
            poolById={poolById}
            onChoosePair={choosePair}
            onChooseHave={chooseHave}
            onClear={clearNode}
            onRequestAdd={onInsertToRoster ? requestAdd : null}
          />
        </ul>
      </Panel>

      {plan.steps.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-0">In breeding order</h3>
          <ol className="space-y-3">
            {plan.steps.map((step) => (
              <StepCard key={step.index} step={step} required={requiredPassives} />
            ))}
          </ol>
        </div>
      )}

      <QuickLookup onBuild={buildFromLookup} />

      {adding && onInsertToRoster && (
        // Adding from here fills the slot as well, so the Pal is not entered and then lost.
        <PalDialog
          key={adding.pal.id}
          initial={adding.pal}
          mode="add"
          onSubmit={(pal) => {
            onInsertToRoster(pal);
            chooseHave(adding.nodeId, pal);
            setAdding(null);
          }}
          onCancel={() => setAdding(null)}
        />
      )}
    </div>
  );
}
