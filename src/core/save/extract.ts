/**
 * Turns raw .sav bytes into the PalForge domain model.
 *
 * Takes bytes rather than paths so the same code serves the CLI (reading from disk) and the
 * web app (reading from a File picker) without either one owning the parsing logic.
 */
import { decompressSav } from '../sav/decompress.js';
import { readLevelSav, readPlayerSav, type GroupData } from '../sav/palworld.js';
import type { PropertyValue } from '../sav/reader.js';
import { speciesIndexFromCharacterId } from '../data/index.js';
import type { Gender, Guild, IVs, Pal, PalLocation, Player, SaveData, Souls } from './types.js';

/** Palbox grid: 6 columns x 5 rows per page, 32 pages. */
const PALBOX_COLUMNS = 6;
const PALBOX_ROWS = 5;
const PALBOX_PAGE_SIZE = PALBOX_COLUMNS * PALBOX_ROWS;

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

export interface PlayerFile {
  /** File name as stored, e.g. "11111111111111111111111111111111.sav". */
  name: string;
  data: Uint8Array;
}

export interface SaveInput {
  level: Uint8Array;
  /**
   * The contents of the `Players/` folder. Optional, but without it the Palbox and party
   * container ids are unknown and locations degrade to raw container ids.
   */
  players?: PlayerFile[];
}

/** Reports coarse progress so a UI can show something during a long parse. */
export type ProgressFn = (stage: string, detail?: string) => void;

// --- property tree helpers ----------------------------------------------------
// The parsed tree wraps every value in `{ value: ... }`, and enum/byte properties wrap it
// twice. These helpers unwrap defensively so a missing field yields a default rather than
// throwing halfway through a 10,000-Pal save.

function prop(obj: PropertyValue, key: string): PropertyValue {
  return obj?.[key];
}

function scalar(obj: PropertyValue, key: string): PropertyValue {
  const p = prop(obj, key);
  if (p == null) return undefined;
  const v = p.value;
  // ByteProperty / EnumProperty nest an extra { type, value }.
  if (v != null && typeof v === 'object' && !Array.isArray(v) && 'value' in v && 'type' in v) {
    return v.value;
  }
  return v;
}

function numberAt(obj: PropertyValue, key: string, fallback = 0): number {
  const v = scalar(obj, key);
  return typeof v === 'number' ? v : fallback;
}

function stringAt(obj: PropertyValue, key: string, fallback = ''): string {
  const v = scalar(obj, key);
  return typeof v === 'string' ? v : fallback;
}

function arrayValues(obj: PropertyValue, key: string): unknown[] {
  const p = prop(obj, key);
  const v = p?.value;
  if (!v) return [];
  if (Array.isArray(v.values)) return v.values;
  if (Array.isArray(v)) return v;
  return [];
}

/** `EPalGenderType::Female` -> `Female`. */
function parseGender(raw: string): Gender {
  if (raw.endsWith('Male')) return 'Male';
  if (raw.endsWith('Female')) return 'Female';
  return 'Unknown';
}

function stripEnumPrefix(v: unknown): string {
  return typeof v === 'string' ? v.replace(/^EPalWazaID::/i, '') : '';
}

// --- container / location -----------------------------------------------------

interface ContainerRoles {
  palbox: Set<string>;
  party: Set<string>;
}

function describeLocation(
  containerId: string,
  slotIndex: number,
  roles: ContainerRoles,
): PalLocation {
  if (roles.palbox.has(containerId)) {
    const page = Math.floor(slotIndex / PALBOX_PAGE_SIZE) + 1;
    const within = slotIndex % PALBOX_PAGE_SIZE;
    const row = Math.floor(within / PALBOX_COLUMNS) + 1;
    const column = (within % PALBOX_COLUMNS) + 1;
    return {
      kind: 'palbox',
      containerId,
      slotIndex,
      page,
      row,
      column,
      label: `Palbox page ${page}, row ${row}, col ${column}`,
    };
  }
  if (roles.party.has(containerId)) {
    return { kind: 'party', containerId, slotIndex, label: `Party slot ${slotIndex + 1}` };
  }
  return {
    kind: 'unknown',
    containerId,
    slotIndex,
    // Without a player .sav we cannot tell a base-camp container from a viewing cage, so
    // say so plainly instead of inventing a location.
    label: `Container ${containerId.slice(0, 8)} slot ${slotIndex}`,
  };
}

// --- extraction ---------------------------------------------------------------

function extractPal(
  saveParam: PropertyValue,
  instanceId: string,
  groupId: string,
  roles: ContainerRoles,
): Pal | null {
  const characterId = stringAt(saveParam, 'CharacterID');
  if (!characterId) return null;

  const speciesIndex = speciesIndexFromCharacterId(characterId);
  if (speciesIndex < 0) return null; // human, NPC, or event-only pal

  const ivs: IVs = {
    hp: numberAt(saveParam, 'Talent_HP'),
    attack: numberAt(saveParam, 'Talent_Shot'),
    defense: numberAt(saveParam, 'Talent_Defense'),
  };

  const souls: Souls = {
    hp: numberAt(saveParam, 'Rank_HP'),
    attack: numberAt(saveParam, 'Rank_Attack'),
    // Palworld spells this the British way in some versions and the American way in
    // others; accept whichever is present.
    defense: numberAt(saveParam, 'Rank_Defence') || numberAt(saveParam, 'Rank_Defense'),
    craftSpeed: numberAt(saveParam, 'Rank_CraftSpeed'),
  };

  const slotId = prop(saveParam, 'SlotId') ?? prop(saveParam, 'SlotID');
  const containerId: string = slotId?.value?.ContainerId?.value?.ID?.value ?? EMPTY_GUID;
  const slotIndex: number = slotId?.value?.SlotIndex?.value ?? -1;

  const ownerPlayerUid: string = prop(saveParam, 'OwnerPlayerUId')?.value ?? EMPTY_GUID;

  return {
    instanceId,
    speciesIndex,
    characterId,
    isBoss: /^BOSS_/i.test(characterId),
    nickname: stringAt(saveParam, 'NickName'),
    gender: parseGender(stringAt(saveParam, 'Gender')),
    level: numberAt(saveParam, 'Level', 1),
    rank: numberAt(saveParam, 'Rank', 1),
    souls,
    ivs,
    passives: arrayValues(saveParam, 'PassiveSkillList').filter(
      (v): v is string => typeof v === 'string',
    ),
    masteredSkills: arrayValues(saveParam, 'MasteredWaza').map(stripEnumPrefix).filter(Boolean),
    equippedSkills: arrayValues(saveParam, 'EquipWaza').map(stripEnumPrefix).filter(Boolean),
    ownerPlayerUid,
    groupId,
    location: describeLocation(containerId, slotIndex, roles),
  };
}

function extractGuilds(groupMap: PropertyValue): Guild[] {
  const guilds: Guild[] = [];
  const entries = groupMap?.value;
  if (!Array.isArray(entries)) return guilds;
  for (const entry of entries) {
    const data = entry?.value?.RawData?.value as GroupData | undefined;
    if (!data) continue;
    if (
      data.group_type !== 'EPalGroupType::Guild' &&
      data.group_type !== 'EPalGroupType::IndependentGuild'
    ) {
      continue;
    }
    guilds.push({
      groupId: data.group_id,
      name: data.guild_name ?? data.group_name ?? '(unnamed guild)',
      type: data.group_type,
      adminPlayerUid: data.admin_player_uid ?? data.player_uid ?? null,
      members: (data.players ?? []).map((p) => ({
        playerUid: p.player_uid,
        name: p.player_name,
        lastOnline: p.last_online_real_time,
      })),
    });
  }
  return guilds;
}

/** A player .sav file name is the player UID with dashes stripped. */
function uidFromFileName(name: string): string {
  const bare = name.replace(/\.sav$/i, '').toLowerCase();
  if (bare.length !== 32) return bare;
  return [
    bare.slice(0, 8),
    bare.slice(8, 12),
    bare.slice(12, 16),
    bare.slice(16, 20),
    bare.slice(20, 32),
  ].join('-');
}

/**
 * Reads the per-player .sav files that sit beside Level.sav.
 *
 * These are the only place the Palbox and party container ids are recorded, so without
 * them a Pal's slot number cannot be turned into "Palbox page 3, row 2". Missing or
 * unreadable player files are not fatal; locations just degrade to raw container ids.
 */
async function readPlayerFiles(
  files: PlayerFile[],
  warnings: string[],
): Promise<{ players: Map<string, Partial<Player>>; roles: ContainerRoles }> {
  const players = new Map<string, Partial<Player>>();
  const roles: ContainerRoles = { palbox: new Set(), party: new Set() };

  for (const file of files) {
    try {
      const { gvas } = await decompressSav(file.data);
      const parsed = readPlayerSav(gvas);
      const saveData = parsed.properties.SaveData?.value;
      if (!saveData) continue;

      const uid = uidFromFileName(file.name);
      const palbox = saveData.PalStorageContainerId?.value?.ID?.value;
      const party = saveData.OtomoCharacterContainerId?.value?.ID?.value;
      if (typeof palbox === 'string') roles.palbox.add(palbox);
      if (typeof party === 'string') roles.party.add(party);

      players.set(uid, {
        playerUid: uid,
        palboxContainerId: typeof palbox === 'string' ? palbox : null,
        partyContainerId: typeof party === 'string' ? party : null,
      });
    } catch (err) {
      warnings.push(`Could not read player file ${file.name}: ${String(err)}`);
    }
  }
  return { players, roles };
}

/** Parses a save from raw bytes. This is the single entry point for both front-ends. */
export async function parseSave(input: SaveInput, onProgress?: ProgressFn): Promise<SaveData> {
  const started = Date.now();
  const warnings: string[] = [];

  onProgress?.('decompressing', 'unwrapping the save container');
  const { gvas, container, saveType } = await decompressSav(input.level);

  onProgress?.('parsing', `reading ${(gvas.length / 1024 / 1024).toFixed(1)} MB of save data`);
  const parsed = readLevelSav(gvas);

  if (parsed.trailerLength > 4) {
    warnings.push(
      `${parsed.trailerLength} bytes of unparsed trailer data; the save format may have changed.`,
    );
  }

  onProgress?.('players', 'locating Palbox containers');
  const playerFiles = input.players ?? [];
  if (playerFiles.length === 0) {
    warnings.push(
      'No player .sav files were provided, so Palbox page/row/column cannot be resolved. ' +
        'Select the whole save folder (including Players/) to get exact locations.',
    );
  }
  const { players: playerData, roles } = await readPlayerFiles(playerFiles, warnings);

  const world = parsed.properties.worldSaveData?.value;
  if (!world) throw new Error('Save has no worldSaveData; this does not look like a Level.sav.');

  const charMap = world.CharacterSaveParameterMap?.value;
  if (!Array.isArray(charMap)) {
    throw new Error('CharacterSaveParameterMap missing or unparsed.');
  }

  onProgress?.('extracting', `${charMap.length} character records`);
  const pals: Pal[] = [];
  const players: Player[] = [];
  let skipped = 0;

  for (const entry of charMap) {
    const rawData = entry?.value?.RawData?.value;
    const saveParam = rawData?.object?.SaveParameter?.value;
    if (!saveParam) {
      skipped++;
      continue;
    }
    const instanceId: string = entry.key?.InstanceId?.value ?? EMPTY_GUID;
    const groupId: string = rawData.group_id ?? EMPTY_GUID;

    if (scalar(saveParam, 'IsPlayer') === true) {
      const uid: string = entry.key?.PlayerUId?.value ?? EMPTY_GUID;
      const fromFile = playerData.get(uid);
      players.push({
        playerUid: uid,
        instanceId,
        name: stringAt(saveParam, 'NickName', '(unnamed)'),
        level: numberAt(saveParam, 'Level', 1),
        palboxContainerId: fromFile?.palboxContainerId ?? null,
        partyContainerId: fromFile?.partyContainerId ?? null,
      });
      continue;
    }

    const pal = extractPal(saveParam, instanceId, groupId, roles);
    if (pal) pals.push(pal);
    else skipped++;
  }

  const guilds = extractGuilds(world.GroupSaveDataMap);

  // Fill in player names from guild membership for players whose character record is not
  // in this Level.sav (common on servers where someone has not logged in since a wipe).
  const knownUids = new Set(players.map((p) => p.playerUid));
  for (const guild of guilds) {
    for (const member of guild.members) {
      if (knownUids.has(member.playerUid)) continue;
      const fromFile = playerData.get(member.playerUid);
      players.push({
        playerUid: member.playerUid,
        instanceId: EMPTY_GUID,
        name: member.name,
        level: 0,
        palboxContainerId: fromFile?.palboxContainerId ?? null,
        partyContainerId: fromFile?.partyContainerId ?? null,
      });
      knownUids.add(member.playerUid);
    }
  }

  onProgress?.('done');
  return {
    pals,
    players,
    guilds,
    warnings,
    meta: {
      container,
      saveType,
      skippedCharacters: skipped,
      parseMs: Date.now() - started,
    },
  };
}
