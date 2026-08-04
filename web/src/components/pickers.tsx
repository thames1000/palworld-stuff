/** Searchable pickers for the 288 species and 115 passive skills. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PASSIVES, SPECIES, passiveDisplayName } from '@core/data/index';
import { PassiveChip, TextInput } from './ui';

interface Option {
  id: string;
  label: string;
  meta?: string;
  rank?: number;
}

/** Shared combobox shell: filtered list, keyboard navigation, click-away to close. */
function Combobox({
  options,
  onChoose,
  placeholder,
  value,
  onValueChange,
  emptyMessage = 'No matches',
  autoFocus = false,
}: {
  options: Option[];
  onChoose: (option: Option) => void;
  placeholder: string;
  value: string;
  onValueChange: (v: string) => void;
  emptyMessage?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, 60);
    const starts: Option[] = [];
    const contains: Option[] = [];
    for (const o of options) {
      const l = o.label.toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, 60);
  }, [options, value]);

  useEffect(() => setActive(0), [value]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Keep the highlighted row in view when navigating with the keyboard.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (option: Option) => {
    onChoose(option);
    setOpen(false);
  };

  return (
    <div ref={wrapper} className="relative">
      <TextInput
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const option = filtered[active];
            if (option) choose(option);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-edge bg-surface-2 py-1 shadow-xl shadow-black/40"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-ink-2">{emptyMessage}</li>}
          {filtered.map((option, i) => (
            <li
              key={option.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm ${
                i === active ? 'bg-accent/18 text-ink-0' : 'text-ink-1'
              }`}
            >
              <span>{option.label}</span>
              {option.meta && <span className="nums text-[11px] text-ink-2">{option.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SPECIES_OPTIONS: Option[] = SPECIES.map((s, i) => ({
  id: String(i),
  label: s.name,
  meta: `#${s.paldexNo}`,
}));

export function SpeciesPicker({
  value,
  onChange,
  autoFocus = false,
}: {
  value: number;
  onChange: (speciesIndex: number) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState(SPECIES[value]?.name ?? '');

  // Reflect changes that come from elsewhere (e.g. clicking a Pal in the table).
  useEffect(() => {
    setQuery(SPECIES[value]?.name ?? '');
  }, [value]);

  return (
    <Combobox
      options={SPECIES_OPTIONS}
      value={query}
      onValueChange={setQuery}
      onChoose={(option) => {
        const index = Number(option.id);
        onChange(index);
        setQuery(SPECIES[index]?.name ?? '');
      }}
      placeholder="Search species…"
      emptyMessage="No species with that name"
      autoFocus={autoFocus}
    />
  );
}

/** Positives first, then neutral, then the traits you would rather breed out. */
const PASSIVE_OPTIONS: Option[] = [...PASSIVES]
  .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
  .map((p) => ({
    id: p.internalName,
    label: p.name,
    meta: p.rank > 0 ? `+${p.rank}` : String(p.rank),
    rank: p.rank,
  }));

export function PassivePicker({
  selected,
  onChange,
  max,
  placeholder,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const available = useMemo(
    () => PASSIVE_OPTIONS.filter((o) => !selected.includes(o.id)),
    [selected],
  );
  const full = selected.length >= max;

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((internalName) => (
            <li key={internalName}>
              <button
                type="button"
                onClick={() => onChange(selected.filter((s) => s !== internalName))}
                className="group inline-flex items-center gap-1 rounded border border-edge bg-surface-2 py-0.5 pl-1.5 pr-1 text-[11px] text-ink-0 transition hover:border-bad/50"
                aria-label={`Remove ${passiveDisplayName(internalName)}`}
              >
                {passiveDisplayName(internalName)}
                <span className="text-ink-2 transition group-hover:text-bad">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-[11px] text-ink-2">
          {max} of {max} slots used — remove one to swap it out.
        </p>
      ) : (
        <Combobox
          options={available}
          value={query}
          onValueChange={setQuery}
          onChoose={(option) => {
            onChange([...selected, option.id]);
            setQuery('');
          }}
          placeholder={placeholder}
          emptyMessage="No passive with that name"
        />
      )}
    </div>
  );
}

export { PassiveChip };
