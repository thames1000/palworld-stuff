/**
 * State for planning without a save: the roster you type in, and the tree you build.
 *
 * Both are persisted to localStorage. Hand-entering a dozen Pals is real work, and losing
 * it to a refresh would make the feature not worth using. Nothing here leaves the device,
 * which is the same promise the save-file path makes.
 *
 * Persisted data is treated as untrusted -- it is user-editable, and an older version of
 * this app may have written a different shape -- so it is validated on the way in and
 * discarded rather than crashing the page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SPECIES, findSpecies } from '@core/data/index';
import { emptyManualPal, type ManualPalSpec } from '@core/save/manual';
// From manualTree, not manual: scoring a tree needs the breeding matrices, and this module
// is loaded on every visit whereas the explorer that scores trees is not.
import { newManualNode, type ManualNode } from '@core/solver/manualTree';

const ROSTER_KEY = 'palforge.roster.v1';
const TREE_KEY = 'palforge.tree.v1';

let idCounter = 0;

/** Unique enough for React keys and for telling two roster entries apart. */
export function newId(prefix: string): string {
  idCounter++;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : String(idCounter);
  return `${prefix}-${random}-${idCounter}`;
}

function read<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage quota is not worth interrupting the user over.
  }
}

function isSpecies(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < SPECIES.length;
}

function parsePal(raw: unknown): ManualPalSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!isSpecies(p.speciesIndex)) return null;
  const ivs = (p.ivs ?? {}) as Record<string, unknown>;
  const iv = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50;
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId('pal'),
    speciesIndex: p.speciesIndex,
    gender: p.gender === 'Male' || p.gender === 'Female' ? p.gender : 'Unknown',
    passives: Array.isArray(p.passives)
      ? p.passives.filter((s): s is string => typeof s === 'string').slice(0, 4)
      : [],
    ivs: { hp: iv(ivs.hp), attack: iv(ivs.attack), defense: iv(ivs.defense) },
    nickname: typeof p.nickname === 'string' ? p.nickname.slice(0, 40) : '',
  };
}

function parseRoster(raw: unknown): ManualPalSpec[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map(parsePal).filter((p): p is ManualPalSpec => p !== null);
}

function parseTree(raw: unknown, depth = 0): ManualNode | null {
  if (!raw || typeof raw !== 'object' || depth > 16) return null;
  const n = raw as Record<string, unknown>;
  if (!isSpecies(n.speciesIndex)) return null;
  let parents: [ManualNode, ManualNode] | null = null;
  if (Array.isArray(n.parents) && n.parents.length === 2) {
    const a = parseTree(n.parents[0], depth + 1);
    const b = parseTree(n.parents[1], depth + 1);
    // A half-readable pairing would silently change the plan's meaning, so drop both.
    if (a && b) parents = [a, b];
  }
  return {
    id: typeof n.id === 'string' && n.id ? n.id : newId('node'),
    speciesIndex: n.speciesIndex,
    have: parents ? null : parsePal(n.have),
    parents,
  };
}

export function defaultTargetSpecies(): number {
  const anubis = findSpecies('Anubis');
  return anubis >= 0 ? anubis : 0;
}

export interface ManualPlanState {
  roster: ManualPalSpec[];
  /** Creates a blank Pal of a species and adds it. Used where there is nothing to fill in. */
  addPal: (speciesIndex?: number) => ManualPalSpec;
  /** Adds a Pal that has already been filled in, e.g. by the add dialog. */
  insertPal: (pal: ManualPalSpec) => void;
  /** Adds a batch, keeping their order, as an import does. */
  insertPals: (pals: ManualPalSpec[]) => void;
  /** Discards the current roster and installs this one. */
  replaceRoster: (pals: ManualPalSpec[]) => void;
  updatePal: (id: string, next: Partial<ManualPalSpec>) => void;
  removePal: (id: string) => void;
  duplicatePal: (id: string) => void;
  clearRoster: () => void;
  tree: ManualNode;
  setTree: (next: ManualNode) => void;
  /** Restart the tree at a species, discarding what was there. */
  resetTree: (speciesIndex: number) => void;
}

export function useManualPlan(): ManualPlanState {
  const [roster, setRoster] = useState<ManualPalSpec[]>(() => read(ROSTER_KEY, parseRoster) ?? []);
  const [tree, setTree] = useState<ManualNode>(
    () => read(TREE_KEY, parseTree) ?? newManualNode(newId('node'), defaultTargetSpecies()),
  );

  useEffect(() => write(ROSTER_KEY, roster), [roster]);
  useEffect(() => write(TREE_KEY, tree), [tree]);

  /**
   * New Pals go to the top, not the bottom.
   *
   * The add control sits above the list, so appending would mean scrolling down to fill the
   * card in and back up to add the next one -- twice per Pal, on a screen where entering a
   * dozen Pals is the normal case.
   */
  const insertPal = useCallback((pal: ManualPalSpec) => {
    setRoster((prev) => [pal, ...prev]);
  }, []);

  const addPal = useCallback(
    (speciesIndex = defaultTargetSpecies()) => {
      const pal = emptyManualPal(newId('pal'), speciesIndex);
      insertPal(pal);
      return pal;
    },
    [insertPal],
  );

  const insertPals = useCallback((pals: ManualPalSpec[]) => {
    setRoster((prev) => [...pals, ...prev]);
  }, []);

  const replaceRoster = useCallback((pals: ManualPalSpec[]) => setRoster(pals), []);

  const updatePal = useCallback((id: string, next: Partial<ManualPalSpec>) => {
    setRoster((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }, []);

  const removePal = useCallback((id: string) => {
    setRoster((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const duplicatePal = useCallback((id: string) => {
    setRoster((prev) => {
      const source = prev.find((p) => p.id === id);
      if (!source) return prev;
      const copy: ManualPalSpec = { ...source, id: newId('pal'), ivs: { ...source.ivs }, passives: [...source.passives] };
      const at = prev.findIndex((p) => p.id === id);
      return [...prev.slice(0, at + 1), copy, ...prev.slice(at + 1)];
    });
  }, []);

  const clearRoster = useCallback(() => setRoster([]), []);

  const resetTree = useCallback((speciesIndex: number) => {
    setTree(newManualNode(newId('node'), speciesIndex));
  }, []);

  return useMemo(
    () => ({
      roster,
      addPal,
      insertPal,
      insertPals,
      replaceRoster,
      updatePal,
      removePal,
      duplicatePal,
      clearRoster,
      tree,
      setTree,
      resetTree,
    }),
    [
      roster,
      addPal,
      insertPal,
      insertPals,
      replaceRoster,
      updatePal,
      removePal,
      duplicatePal,
      clearRoster,
      tree,
      resetTree,
    ],
  );
}
