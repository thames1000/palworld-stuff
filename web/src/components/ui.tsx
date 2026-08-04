/** Small shared primitives so the panels stay visually consistent. */
import { useEffect, type ReactNode } from 'react';
import { passiveByInternalName, passiveDisplayName, speciesName } from '@core/data/index';
import type { GenderRequirement } from '@core/solver/types';

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-edge/60 bg-surface-1 ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-edge/50 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-0">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-1">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-ink-2">{hint}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 text-sm text-ink-0 ' +
  'placeholder:text-ink-2 outline-none transition focus:border-accent-dim focus:ring-2 focus:ring-accent/25';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function Button({
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
}) {
  const styles = {
    primary:
      'bg-accent text-surface-0 font-semibold hover:brightness-110 disabled:bg-surface-3 disabled:text-ink-2',
    default: 'bg-surface-2 text-ink-0 border border-edge hover:bg-surface-3',
    ghost: 'text-ink-1 hover:text-ink-0 hover:bg-surface-2',
    // For the button that actually destroys something. Never the quiet default in a dialog:
    // it should read as the deliberate choice, not the one you hit to dismiss the box.
    danger: 'border border-bad/40 bg-bad/12 text-bad font-medium hover:bg-bad/20',
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    />
  );
}

/**
 * A passive skill chip, tinted by the skill's rank so the negatives you are trying to
 * breed out are visible at a glance rather than needing to be read.
 */
export function PassiveChip({ internalName }: { internalName: string }) {
  const passive = passiveByInternalName(internalName);
  const rank = passive?.rank ?? 0;
  const tone =
    rank >= 3
      ? 'border-good/40 bg-good/12 text-good'
      : rank > 0
        ? 'border-edge bg-surface-3 text-ink-0'
        : rank < 0
          ? 'border-bad/40 bg-bad/12 text-bad'
          : 'border-edge bg-surface-2 text-ink-1';
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] leading-tight ${tone}`}>
      {passiveDisplayName(internalName)}
    </span>
  );
}

/**
 * Plain-English odds for one breeding step.
 *
 * Kept in one place because the temptation is to collapse it into a single "% per hatch",
 * which is wrong: a given pair of species always produces the same child, so the only
 * per-egg uncertainty is which passives come along. The gender factor is the separate cost
 * of getting the two parents to be opposite sexes, and belongs in its own sentence.
 */
export function stepOdds({
  passiveSuccess,
  genderFactor,
  genderRequirement,
  wanted,
}: {
  passiveSuccess: number;
  genderFactor: number;
  genderRequirement: GenderRequirement | null;
  /** Passives riding on this step, already in display form. */
  wanted: string[];
}): { hatch: string; gender: string | null } {
  const hatch =
    wanted.length === 0
      ? 'every hatch is the right species'
      : `${(passiveSuccess * 100).toFixed(1)}% of hatches carry ${wanted.join(' + ')}`;

  let gender: string | null = null;
  if (genderRequirement?.kind === 'species-ratio') {
    gender =
      `the ${speciesName(genderRequirement.speciesIndex)} you breed must come out ` +
      `${genderRequirement.gender} (${Math.round(genderRequirement.probability * 100)}% of its hatches)`;
  } else if (genderRequirement?.kind === 'coin-flip') {
    gender = 'both parents are bred, so they have to come out opposite sexes (about half the time)';
  } else if (genderFactor < 1) {
    gender = `parent genders cost a further ${Math.round(genderFactor * 100)}%`;
  }

  return { hatch, gender };
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-md border border-edge/60 bg-surface-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink-2">{label}</div>
      <div className={`nums mt-0.5 text-lg font-semibold ${tone ?? 'text-ink-0'}`}>{value}</div>
    </div>
  );
}

/**
 * A centred modal panel.
 *
 * Deliberately not portalled: there is no document during the server render the smoke tests
 * use, and the app has no stacking context that a fixed overlay needs escaping from.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      // mousedown rather than click, so a drag that ends on the backdrop does not close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-auto h-fit w-full max-w-2xl rounded-lg border border-edge bg-surface-1 shadow-2xl shadow-black/50"
      >
        <header className="flex items-center justify-between gap-3 border-b border-edge/50 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-0">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-0.5 text-ink-2 transition hover:bg-surface-2 hover:text-ink-0"
          >
            ×
          </button>
        </header>
        <div className="p-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-edge/50 px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-1">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-edge border-t-accent" />
      {label}
    </span>
  );
}
