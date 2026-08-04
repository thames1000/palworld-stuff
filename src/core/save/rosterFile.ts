/**
 * A portable file for a hand-entered roster.
 *
 * The point of this format is to outlive the session that wrote it -- another browser,
 * another machine, a later version of PalForge. So it deliberately does *not* store the
 * species indices the app uses internally: those are positions in the PalCalc dataset and
 * shift whenever a patch adds a Pal, which would silently turn your Anubis into somebody
 * else. Species and passives are written as the game's own internal names, which are
 * stable, and resolved back to indices on the way in.
 *
 * Anything unreadable is reported rather than dropped. A roster is typed by hand; quietly
 * losing three entries out of twenty is worse than saying so.
 */
import { SPECIES, findPassive, findSpecies, passiveDisplayName } from '../data/index.js';
import type { Gender, IVs } from './types.js';
import { DEFAULT_MANUAL_IVS, type ManualPalSpec } from './manual.js';

export const ROSTER_FORMAT = 'palforge-roster';
export const ROSTER_FORMAT_VERSION = 1;

/** One Pal as written to file. */
export interface RosterFileEntry {
  /** Internal name, e.g. "Anubis". Stable across dataset versions. */
  species: string;
  gender: Gender;
  /** Passive internal names. */
  passives: string[];
  ivs: IVs;
  nickname?: string;
  /**
   * What the entry says in English, for anyone who opens the file.
   *
   * Internal names are the stable identifiers but several are unrecognisable -- Artisan is
   * stored as `CraftSpeed_up2` -- so the readable form rides along. Ignored on import; the
   * internal names above are what count.
   */
  label?: string;
}

export interface RosterFile {
  format: typeof ROSTER_FORMAT;
  version: number;
  /** The dataset the exporting app was built against. Informational only. */
  dataset?: string;
  exported?: string;
  pals: RosterFileEntry[];
}

export interface RosterImport {
  pals: ManualPalSpec[];
  /** Entries that could not be read, in the words the user needs to fix them. */
  warnings: string[];
}

export interface ParseRosterOptions {
  /** Supplies ids unique against whatever roster these will join. */
  makeId: () => string;
}

function clampIv(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readGender(value: unknown): Gender {
  return value === 'Male' || value === 'Female' ? value : 'Unknown';
}

export function toRosterFile(pals: readonly ManualPalSpec[], dataset?: string): RosterFile {
  return {
    format: ROSTER_FORMAT,
    version: ROSTER_FORMAT_VERSION,
    ...(dataset ? { dataset } : {}),
    pals: pals.map((pal) => {
      const species = SPECIES[pal.speciesIndex];
      const passiveNames = pal.passives.map((p) => passiveDisplayName(p));
      return {
        species: species?.internalName ?? '',
        gender: pal.gender,
        passives: [...pal.passives],
        ivs: { ...pal.ivs },
        ...(pal.nickname ? { nickname: pal.nickname } : {}),
        label: [species?.name ?? 'Unknown', passiveNames.join(', ') || 'no passives'].join(' — '),
      };
    }),
  };
}

export function serializeRoster(pals: readonly ManualPalSpec[], dataset?: string): string {
  return JSON.stringify(toRosterFile(pals, dataset), null, 2);
}

/**
 * Reads a roster file.
 *
 * Accepts either the wrapped document or a bare array of entries, because people edit
 * these by hand and a bare list is the obvious thing to write.
 */
export function parseRosterFile(text: string, options: ParseRosterOptions): RosterImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON. Paste the whole file, including the outer braces.');
  }

  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (raw && typeof raw === 'object') {
    const doc = raw as Record<string, unknown>;
    if (doc.format !== undefined && doc.format !== ROSTER_FORMAT) {
      throw new Error(`This file is a "${String(doc.format)}", not a PalForge roster.`);
    }
    if (typeof doc.version === 'number' && doc.version > ROSTER_FORMAT_VERSION) {
      throw new Error(
        `This roster was written by a newer version of PalForge (format ${doc.version}). Update, then import it.`,
      );
    }
    if (!Array.isArray(doc.pals)) {
      throw new Error('No list of Pals in this file.');
    }
    entries = doc.pals;
  } else {
    throw new Error('No list of Pals in this file.');
  }

  const pals: ManualPalSpec[] = [];
  const warnings: string[] = [];

  entries.forEach((entry, i) => {
    const where = `Entry ${i + 1}`;
    if (!entry || typeof entry !== 'object') {
      warnings.push(`${where}: not a Pal, skipped.`);
      return;
    }
    const e = entry as Record<string, unknown>;

    const speciesName = typeof e.species === 'string' ? e.species : '';
    const speciesIndex = speciesName ? findSpecies(speciesName) : -1;
    if (speciesIndex < 0) {
      warnings.push(
        speciesName
          ? `${where}: no species called "${speciesName}" in this dataset, skipped.`
          : `${where}: no species given, skipped.`,
      );
      return;
    }

    const rawPassives = Array.isArray(e.passives) ? e.passives : [];
    const passives: string[] = [];
    for (const p of rawPassives) {
      if (typeof p !== 'string') continue;
      const found = findPassive(p);
      if (!found) {
        warnings.push(`${where} (${SPECIES[speciesIndex]!.name}): unknown passive "${p}", dropped.`);
        continue;
      }
      if (passives.length >= 4) {
        warnings.push(
          `${where} (${SPECIES[speciesIndex]!.name}): more than four passives, "${found.name}" dropped.`,
        );
        continue;
      }
      // Normalised to the internal name, so a file written with display names still works.
      if (!passives.includes(found.internalName)) passives.push(found.internalName);
    }

    const ivs = (e.ivs ?? {}) as Record<string, unknown>;
    pals.push({
      id: options.makeId(),
      speciesIndex,
      gender: readGender(e.gender),
      passives,
      ivs: e.ivs
        ? { hp: clampIv(ivs.hp), attack: clampIv(ivs.attack), defense: clampIv(ivs.defense) }
        : { ...DEFAULT_MANUAL_IVS },
      nickname: typeof e.nickname === 'string' ? e.nickname.slice(0, 40) : '',
    });
  });

  if (pals.length === 0 && warnings.length === 0) {
    warnings.push('That file has no Pals in it.');
  }

  return { pals, warnings };
}
