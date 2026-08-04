/**
 * Pals described by hand instead of read from a save.
 *
 * Everything downstream -- the solver, the step flattener, both result views -- works off
 * the `Pal` domain model. So rather than teaching any of it about a second kind of input,
 * a hand-entered Pal is converted into exactly the same shape, with the fields a player
 * cannot reasonably be asked to type filled in with neutral values.
 *
 * The one field that genuinely cannot be faked is location: there is no Palbox page to
 * point at, so it reports as hand-entered and the UI says so.
 */
import type { Gender, IVs, Pal, PalLocation } from './types.js';

/** The subset of a Pal that a player can plausibly enter from memory. */
export interface ManualPalSpec {
  /** Stable id for React keys and for de-duplicating a Pal used twice in one pairing. */
  id: string;
  speciesIndex: number;
  gender: Gender;
  /** Passive internal names, at most four. */
  passives: string[];
  ivs: IVs;
  nickname: string;
}

export const MANUAL_CONTAINER_ID = 'manual';

const MANUAL_LOCATION: PalLocation = {
  kind: 'unknown',
  containerId: MANUAL_CONTAINER_ID,
  slotIndex: -1,
  label: 'Entered by hand',
};

/**
 * Unknown IVs.
 *
 * Zero would be a lie that the IV filter then acts on, but there is no "unset" in the IV
 * model, so the midpoint is used: it keeps a hand-entered Pal from being silently ranked
 * above or below a real one when IV thresholds are in play. The UI lets you type real
 * values when you know them.
 */
export const DEFAULT_MANUAL_IVS: IVs = { hp: 50, attack: 50, defense: 50 };

export function emptyManualPal(id: string, speciesIndex: number): ManualPalSpec {
  return {
    id,
    speciesIndex,
    gender: 'Unknown',
    passives: [],
    ivs: { ...DEFAULT_MANUAL_IVS },
    nickname: '',
  };
}

/** Widens a hand-entered Pal into the full domain model the solver consumes. */
export function manualPal(spec: ManualPalSpec): Pal {
  return {
    instanceId: spec.id,
    speciesIndex: spec.speciesIndex,
    characterId: '',
    isBoss: false,
    nickname: spec.nickname,
    gender: spec.gender,
    level: 1,
    rank: 1,
    souls: { hp: 0, attack: 0, defense: 0, craftSpeed: 0 },
    ivs: { ...spec.ivs },
    passives: [...spec.passives],
    masteredSkills: [],
    equippedSkills: [],
    ownerPlayerUid: '',
    groupId: '',
    location: MANUAL_LOCATION,
  };
}

/** True when a Pal came from a hand-entered roster rather than a save. */
export function isManualPal(pal: Pal): boolean {
  return pal.location.containerId === MANUAL_CONTAINER_ID;
}

/**
 * Narrows a real Pal down to the hand-entered shape.
 *
 * This is what lets a hand-built tree be filled with Pals out of a save as readily as with
 * typed-in ones: the tree only ever holds one kind of thing. The instance id is kept, so
 * whoever is rendering can find the original and show where it is sitting.
 */
export function manualFromPal(pal: Pal): ManualPalSpec {
  return {
    id: pal.instanceId,
    speciesIndex: pal.speciesIndex,
    gender: pal.gender,
    passives: [...pal.passives],
    ivs: { ...pal.ivs },
    nickname: pal.nickname,
  };
}
