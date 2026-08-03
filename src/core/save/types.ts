/** Domain model produced by reading a save; everything downstream works off these. */

export type Gender = 'Male' | 'Female' | 'Unknown';

/** Where a Pal physically sits, for "go get this one" instructions. */
export interface PalLocation {
  kind: 'palbox' | 'party' | 'base' | 'viewing-cage' | 'dimensional-storage' | 'unknown';
  containerId: string;
  slotIndex: number;
  /** Palbox page, 1-based. Only set for palbox locations. */
  page?: number;
  /** 1-based row/column within the page. Only set for palbox locations. */
  row?: number;
  column?: number;
  /** Human-readable one-liner, e.g. "Palbox page 3, row 2, col 5". */
  label: string;
}

export interface IVs {
  hp: number;
  attack: number;
  defense: number;
}

/** Condensation souls applied to a Pal (0-3 each in game terms). */
export interface Souls {
  hp: number;
  attack: number;
  defense: number;
  craftSpeed: number;
}

export interface Pal {
  /** Unique instance id from the save; stable across sessions. */
  instanceId: string;
  /** Index into SPECIES, or -1 for an unrecognised character. */
  speciesIndex: number;
  /** Raw CharacterID as stored, e.g. "BOSS_Anubis". */
  characterId: string;
  /** True when the save marks this as an alpha/boss variant. */
  isBoss: boolean;
  nickname: string;
  gender: Gender;
  level: number;
  /** Condensation rank, 1-5. */
  rank: number;
  souls: Souls;
  ivs: IVs;
  /** Passive skill internal names. */
  passives: string[];
  /** Learned active skills (internal names, `EPalWazaID::` stripped). */
  masteredSkills: string[];
  /** Currently equipped active skills. */
  equippedSkills: string[];
  ownerPlayerUid: string;
  /** Guild/group this Pal is filed under. */
  groupId: string;
  location: PalLocation;
}

export interface Player {
  playerUid: string;
  instanceId: string;
  name: string;
  level: number;
  /** Container holding this player's Palbox, when a player .sav was available. */
  palboxContainerId: string | null;
  /** Container holding the party (Otomo) Pals. */
  partyContainerId: string | null;
}

export interface Guild {
  groupId: string;
  name: string;
  type: string;
  adminPlayerUid: string | null;
  members: Array<{ playerUid: string; name: string; lastOnline: number }>;
}

export interface SaveData {
  pals: Pal[];
  players: Player[];
  guilds: Guild[];
  /** Diagnostics worth showing the user rather than hiding. */
  warnings: string[];
  meta: {
    container: string;
    saveType: number;
    /** Characters skipped because they were humans or unknown species. */
    skippedCharacters: number;
    parseMs: number;
  };
}
