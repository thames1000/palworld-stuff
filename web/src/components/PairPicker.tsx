/**
 * "What breeds into this?" — the reverse of the breeding table, made choosable.
 *
 * Some Pals have over a thousand parent pairs, so an unsorted list is useless. Pairs you
 * can actually field come first, then ones you are half way to, and pairs that need the
 * very Pal you are trying to make are pushed to the bottom where they belong.
 */
import { useMemo, useState } from 'react';
import { SPECIES, speciesName } from '@core/data/index';
import { genderedCombosFor, parentPairsFor, type ParentPair } from '@core/data/breeding';
import { Button, TextInput } from './ui';

const SHOWN = 40;

interface Ranked {
  pair: ParentPair;
  /** How many of the two parents you already have. */
  owned: number;
  /** True when a parent is the same species as the child, so you need one to make one. */
  circular: boolean;
  wild: number;
  rarity: number;
}

function rank(pairs: readonly ParentPair[], child: number, owned: ReadonlySet<number>): Ranked[] {
  return pairs
    .map(([a, b]) => ({
      pair: [a, b] as ParentPair,
      owned: (owned.has(a) ? 1 : 0) + (owned.has(b) ? 1 : 0),
      circular: a === child || b === child,
      // Parents you can go out and catch beat ones that must themselves be bred.
      wild: (SPECIES[a]?.minWildLevel != null ? 1 : 0) + (SPECIES[b]?.minWildLevel != null ? 1 : 0),
      rarity: (SPECIES[a]?.rarity ?? 0) + (SPECIES[b]?.rarity ?? 0),
    }))
    .sort(
      (x, y) =>
        y.owned - x.owned ||
        Number(x.circular) - Number(y.circular) ||
        y.wild - x.wild ||
        x.rarity - y.rarity ||
        speciesName(x.pair[0]).localeCompare(speciesName(y.pair[0])),
    );
}

function Badge({ tone, children }: { tone: 'good' | 'warn' | 'mute'; children: React.ReactNode }) {
  const styles = {
    good: 'border-good/40 bg-good/12 text-good',
    warn: 'border-warn/40 bg-warn/12 text-warn',
    mute: 'border-edge bg-surface-2 text-ink-2',
  }[tone];
  return (
    <span className={`rounded border px-1 py-px text-[10px] leading-tight ${styles}`}>{children}</span>
  );
}

export function PairPicker({
  child,
  owned,
  onChoose,
  onCancel,
}: {
  child: number;
  /** Species you have at least one of. */
  owned: ReadonlySet<number>;
  onChoose: (pair: ParentPair) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [onlyFieldable, setOnlyFieldable] = useState(false);

  const all = useMemo(() => rank(parentPairsFor(child), child, owned), [child, owned]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((entry) => {
      if (onlyFieldable && entry.owned < 2) return false;
      if (!q) return true;
      const [a, b] = entry.pair;
      return speciesName(a).toLowerCase().includes(q) || speciesName(b).toLowerCase().includes(q);
    });
  }, [all, query, onlyFieldable]);

  const fieldable = useMemo(() => all.filter((e) => e.owned === 2).length, [all]);
  const shown = filtered.slice(0, SHOWN);

  return (
    <div className="mt-2 rounded-lg border border-accent-dim/50 bg-surface-2/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-0">
          Pairs that make {speciesName(child)}
        </span>
        <span className="nums text-[11px] text-ink-2">
          {all.length.toLocaleString()} total · {fieldable.toLocaleString()} you can field now
        </span>
        <Button variant="ghost" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TextInput
          value={query}
          placeholder="Filter by parent species…"
          aria-label="Filter parent pairs"
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-ink-1">
          <input
            type="checkbox"
            checked={onlyFieldable}
            onChange={(e) => setOnlyFieldable(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Only pairs I have both parents for
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="py-3 text-center text-xs text-ink-2">
          {onlyFieldable && fieldable === 0
            ? `Nothing you have breeds directly into ${speciesName(child)}. Untick the filter to see what would.`
            : 'No pair matches that filter.'}
        </p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-auto">
          {shown.map(({ pair, owned: have, circular }) => {
            const [a, b] = pair;
            const gendered = genderedCombosFor(a, b).length > 0;
            return (
              <li key={`${a}-${b}`}>
                <button
                  type="button"
                  onClick={() => onChoose(pair)}
                  className="flex w-full flex-wrap items-center gap-2 rounded border border-edge/60 bg-surface-1 px-2.5 py-1.5 text-left text-sm text-ink-0 transition hover:border-accent-dim hover:bg-surface-2"
                >
                  <span className={owned.has(a) ? 'text-good' : ''}>{speciesName(a)}</span>
                  <span className="text-ink-2">×</span>
                  <span className={owned.has(b) ? 'text-good' : ''}>{speciesName(b)}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-1">
                    {have === 2 && <Badge tone="good">have both</Badge>}
                    {have === 1 && <Badge tone="mute">have one</Badge>}
                    {circular && <Badge tone="warn">needs a {speciesName(child)}</Badge>}
                    {gendered && <Badge tone="warn">result depends on gender</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > shown.length && (
        <p className="mt-2 text-center text-[11px] text-ink-2">
          Showing {shown.length} of {filtered.length.toLocaleString()} — narrow it with the filter.
        </p>
      )}
    </div>
  );
}
