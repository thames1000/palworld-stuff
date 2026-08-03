/**
 * Palworld-specific layer on top of GVAS.
 *
 * Several Palworld structures are stored as opaque byte arrays ("RawData") that Unreal
 * itself does not understand; the game serializes them by hand. Those need bespoke
 * decoders, mirroring cheahjs/palworld-save-tools.
 */
import { FArchiveReader, instanceIdReader, uuidReader, type CustomPropertyDecoder, type PathFilter, type PropertyValue } from './reader.js';
import { readGvas, type GvasFile } from './gvas.js';

export const PALWORLD_TYPE_HINTS: Record<string, string> = {
  '.worldSaveData.CharacterContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Key': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Value': 'StructProperty',
  '.worldSaveData.CharacterContainerSaveData.Value': 'StructProperty',
  '.worldSaveData.GroupSaveDataMap.Key': 'Guid',
  '.worldSaveData.GroupSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Value': 'StructProperty',
};

/** Coerces a decoded ByteProperty array into a flat byte view. */
function asBytes(values: unknown): Uint8Array {
  if (values instanceof Uint8Array) return values;
  return Uint8Array.from((values as number[]) ?? []);
}

/** Reads a `RawData` ArrayProperty and hands back its bytes for hand-decoding. */
function readRawBytes(
  reader: FArchiveReader,
  typeName: string,
  size: number,
  path: string,
): { wrapper: PropertyValue; bytes: Uint8Array } {
  if (typeName !== 'ArrayProperty') {
    throw new Error(`Expected ArrayProperty at ${path}, got ${typeName}`);
  }
  const wrapper = reader.property(typeName, size, path, path);
  return { wrapper, bytes: asBytes(wrapper.value?.values) };
}

/**
 * One character record: a player or a Pal, plus the guild it belongs to.
 *
 * The tail of this blob grew in later game versions (0.6+ appends 4 trailing bytes, and
 * sometimes more). Anything past the group id is read leniently so a future patch that
 * appends another field degrades to "ignored" rather than throwing away the whole save.
 */
const decodeCharacter: CustomPropertyDecoder = (reader, typeName, size, path) => {
  const { wrapper, bytes } = readRawBytes(reader, typeName, size, path);
  const inner = reader.internalCopy(bytes);
  const decoded: PropertyValue = {
    object: inner.propertiesUntilEnd(),
    unknown_bytes: inner.byteList(4),
    group_id: inner.guid(),
  };
  if (!inner.eof()) {
    decoded.trailing_bytes = inner.readToEnd();
  }
  wrapper.value = decoded;
  return wrapper;
};

/** A single slot inside a Pal container: who owns it and which character sits there. */
const decodeCharacterContainerSlot: CustomPropertyDecoder = (reader, typeName, size, path) => {
  const { wrapper, bytes } = readRawBytes(reader, typeName, size, path);
  if (bytes.length === 0) {
    wrapper.value = null;
    return wrapper;
  }
  const inner = reader.internalCopy(bytes);
  wrapper.value = {
    player_uid: inner.guid(),
    instance_id: inner.guid(),
    permission_tribe_id: inner.byte(),
  };
  return wrapper;
};

/** Guilds, organizations and solo-player groups all share this record shape. */
const decodeGroup: CustomPropertyDecoder = (reader, typeName, size, path) => {
  if (typeName !== 'MapProperty') {
    throw new Error(`Expected MapProperty at ${path}, got ${typeName}`);
  }
  const wrapper = reader.property(typeName, size, path, path);
  for (const entry of wrapper.value as Array<{ key: unknown; value: PropertyValue }>) {
    const groupType: string = entry.value.GroupType.value.value;
    const raw = entry.value.RawData;
    raw.value = decodeGroupBytes(reader, asBytes(raw.value?.values), groupType);
  }
  return wrapper;
};

export interface GroupPlayerInfo {
  player_uid: string;
  last_online_real_time: number;
  player_name: string;
}

export interface GroupData {
  group_type: string;
  group_id: string;
  group_name: string;
  individual_character_handle_ids: Array<{ guid: string; instance_id: string }>;
  org_type?: number;
  base_ids?: string[];
  base_camp_level?: number;
  guild_name?: string;
  admin_player_uid?: string;
  players?: GroupPlayerInfo[];
  player_uid?: string;
}

function decodeGroupBytes(parent: FArchiveReader, bytes: Uint8Array, groupType: string): GroupData {
  const r = parent.internalCopy(bytes);
  const data: GroupData = {
    group_type: groupType,
    group_id: r.guid(),
    group_name: r.fstring(),
    individual_character_handle_ids: r.tarray(instanceIdReader),
  };
  const isOrg =
    groupType === 'EPalGroupType::Guild' ||
    groupType === 'EPalGroupType::IndependentGuild' ||
    groupType === 'EPalGroupType::Organization';
  if (isOrg) {
    data.org_type = r.byte();
    data.base_ids = r.tarray(uuidReader);
  }
  if (groupType === 'EPalGroupType::Guild' || groupType === 'EPalGroupType::IndependentGuild') {
    data.base_camp_level = r.i32();
    r.tarray(uuidReader); // map object instance ids for base camp points
    data.guild_name = r.fstring();
  }
  if (groupType === 'EPalGroupType::IndependentGuild') {
    // A solo player's implicit guild; the owning player is recorded inline.
    data.player_uid = r.guid();
    r.fstring(); // duplicate guild name
    data.players = [
      {
        player_uid: data.player_uid,
        last_online_real_time: r.i64(),
        player_name: r.fstring(),
      },
    ];
  }
  if (groupType === 'EPalGroupType::Guild') {
    data.admin_player_uid = r.guid();
    const count = r.i32();
    const players: GroupPlayerInfo[] = new Array(count);
    for (let i = 0; i < count; i++) {
      players[i] = {
        player_uid: r.guid(),
        last_online_real_time: r.i64(),
        player_name: r.fstring(),
      };
    }
    data.players = players;
  }
  return data;
}

export const PALWORLD_CUSTOM_PROPERTIES: Record<string, CustomPropertyDecoder> = {
  '.worldSaveData.GroupSaveDataMap': decodeGroup,
  '.worldSaveData.CharacterSaveParameterMap.Value.RawData': decodeCharacter,
  '.worldSaveData.CharacterContainerSaveData.Value.Slots.Slots.RawData': decodeCharacterContainerSlot,
};

/**
 * The only three worldSaveData branches PalForge reads. Everything else -- foliage, map
 * objects, work assignments, item containers -- is skipped by byte length, which is what
 * makes parsing a large Level.sav take seconds instead of minutes.
 */
const WANTED_BRANCHES = new Set([
  'CharacterSaveParameterMap',
  'CharacterContainerSaveData',
  'GroupSaveDataMap',
]);

const WORLD_PREFIX = '.worldSaveData.';

export const palforgePathFilter: PathFilter = (path) => {
  if (!path.startsWith(WORLD_PREFIX)) return true;
  const rest = path.slice(WORLD_PREFIX.length);
  // Only direct children of worldSaveData are gated; once inside a wanted branch we
  // always parse, and skipped branches are never descended into.
  if (rest.includes('.')) return true;
  return WANTED_BRANCHES.has(rest);
};

/** Parses a decompressed Level.sav payload, reading only what PalForge needs. */
export function readLevelSav(gvasBytes: Uint8Array): GvasFile {
  return readGvas(gvasBytes, {
    typeHints: PALWORLD_TYPE_HINTS,
    customProperties: PALWORLD_CUSTOM_PROPERTIES,
    shouldParse: palforgePathFilter,
  });
}

/** Player .sav files are small, so they are parsed in full. */
export function readPlayerSav(gvasBytes: Uint8Array): GvasFile {
  return readGvas(gvasBytes, { typeHints: PALWORLD_TYPE_HINTS });
}
