/** Browsable, filterable view of every Pal the current scope includes. */
import { useMemo, useState } from 'react';
import { passiveDisplayName, speciesName } from '@core/data/index';
import type { Pal } from '@core/save/types';
import { Button, PassiveChip, Select, TextInput } from './ui';

type SortKey = 'species' | 'level' | 'hp' | 'attack' | 'defense' | 'passives' | 'location';

const PAGE = 150;

function ivTone(value: number): string {
  if (value >= 90) return 'text-good';
  if (value >= 70) return 'text-ink-0';
  if (value >= 50) return 'text-ink-1';
  return 'text-ink-2';
}

function compare(a: Pal, b: Pal, key: SortKey): number {
  switch (key) {
    case 'species':
      return speciesName(a.speciesIndex).localeCompare(speciesName(b.speciesIndex));
    case 'level':
      return b.level - a.level;
    case 'hp':
      return b.ivs.hp - a.ivs.hp;
    case 'attack':
      return b.ivs.attack - a.ivs.attack;
    case 'defense':
      return b.ivs.defense - a.ivs.defense;
    case 'passives':
      return b.passives.length - a.passives.length;
    case 'location':
      return (
        a.location.kind.localeCompare(b.location.kind) || a.location.slotIndex - b.location.slotIndex
      );
  }
}

export function PalTable({ pals, onPickSpecies }: { pals: Pal[]; onPickSpecies: (i: number) => void }) {
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('any');
  const [place, setPlace] = useState('any');
  const [minIv, setMinIv] = useState(0);
  const [sort, setSort] = useState<SortKey>('passives');
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = pals.filter((pal) => {
      if (gender !== 'any' && pal.gender !== gender) return false;
      if (place !== 'any' && pal.location.kind !== place) return false;
      if (minIv > 0) {
        const best = Math.max(pal.ivs.hp, pal.ivs.attack, pal.ivs.defense);
        if (best < minIv) return false;
      }
      if (!q) return true;
      // One box searches species, nickname and passives, which is how people actually
      // look for "the Anubis with Artisan".
      if (speciesName(pal.speciesIndex).toLowerCase().includes(q)) return true;
      if (pal.nickname.toLowerCase().includes(q)) return true;
      return pal.passives.some((p) => passiveDisplayName(p).toLowerCase().includes(q));
    });
    return out.sort((a, b) => compare(a, b, sort));
  }, [pals, query, gender, place, minIv, sort]);

  const shown = filtered.slice(0, limit);

  const header = (key: SortKey, label: string, className = '') => (
    <th className={`px-2 py-2 text-left font-medium ${className}`}>
      <button
        type="button"
        onClick={() => setSort(key)}
        className={`transition hover:text-ink-0 ${sort === key ? 'text-accent' : 'text-ink-2'}`}
      >
        {label}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <TextInput
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search species, nickname or passive…"
          />
        </div>
        <Select value={gender} onChange={(e) => setGender(e.target.value)} className="w-32">
          <option value="any">Any gender</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </Select>
        <Select value={place} onChange={(e) => setPlace(e.target.value)} className="w-40">
          <option value="any">Anywhere</option>
          <option value="palbox">Palbox</option>
          <option value="party">Party</option>
          <option value="unknown">Base / other</option>
        </Select>
        <Select
          value={String(minIv)}
          onChange={(e) => setMinIv(Number(e.target.value))}
          className="w-36"
        >
          <option value="0">Any IV</option>
          <option value="70">Best IV ≥ 70</option>
          <option value="80">Best IV ≥ 80</option>
          <option value="90">Best IV ≥ 90</option>
        </Select>
      </div>

      <p className="text-xs text-ink-2">
        {filtered.length.toLocaleString()} of {pals.length.toLocaleString()} Pals
        {filtered.length > shown.length && ` · showing first ${shown.length.toLocaleString()}`}
      </p>

      <div className="overflow-x-auto rounded-lg border border-edge/60">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide">
            <tr>
              {header('species', 'Species')}
              <th className="px-2 py-2 text-left font-medium text-ink-2">Gender</th>
              {header('level', 'Lv', 'w-14')}
              {header('hp', 'HP', 'w-14')}
              {header('attack', 'Atk', 'w-14')}
              {header('defense', 'Def', 'w-14')}
              {header('passives', 'Passives')}
              {header('location', 'Location')}
            </tr>
          </thead>
          <tbody>
            {shown.map((pal) => (
              <tr
                key={pal.instanceId}
                className="border-t border-edge/40 transition hover:bg-surface-2/60"
              >
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => onPickSpecies(pal.speciesIndex)}
                    className="text-left font-medium text-ink-0 transition hover:text-accent"
                    title="Use as the plan target"
                  >
                    {speciesName(pal.speciesIndex)}
                  </button>
                  {pal.nickname && <span className="ml-1.5 text-xs text-ink-2">"{pal.nickname}"</span>}
                  {pal.isBoss && (
                    <span className="ml-1.5 rounded bg-warn/15 px-1 text-[10px] text-warn">ALPHA</span>
                  )}
                  {pal.rank > 1 && (
                    <span className="ml-1.5 text-[10px] text-ink-2">★{pal.rank}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-ink-1">{pal.gender}</td>
                <td className="nums px-2 py-1.5 text-ink-1">{pal.level}</td>
                <td className={`nums px-2 py-1.5 ${ivTone(pal.ivs.hp)}`}>{pal.ivs.hp}</td>
                <td className={`nums px-2 py-1.5 ${ivTone(pal.ivs.attack)}`}>{pal.ivs.attack}</td>
                <td className={`nums px-2 py-1.5 ${ivTone(pal.ivs.defense)}`}>{pal.ivs.defense}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {pal.passives.length === 0 ? (
                      <span className="text-xs text-ink-2">—</span>
                    ) : (
                      pal.passives.map((p) => <PassiveChip key={p} internalName={p} />)
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-xs text-ink-1">{pal.location.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > shown.length && (
        <div className="text-center">
          <Button onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, filtered.length - shown.length)} more
          </Button>
        </div>
      )}
    </div>
  );
}
