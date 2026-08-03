"""Builds a small but structurally real Level.sav + Players/*.sav fixture.

The fixture is written by cheahjs/palworld-save-tools -- an independent, well-established
implementation of this format -- so reading it back with PalForge's TypeScript parser is a
genuine cross-implementation check rather than a self-consistency test.

Usage:
    PST=/path/to/palworld-save-tools python3 scripts/make-fixture.py <out-dir>
"""
import base64
import os
import sys

os.environ.setdefault("FORCE_STDLIB_ONLY", "1")

PST = os.environ.get("PST")
if PST:
    sys.path.insert(0, PST)

from palworld_save_tools.archive import UUID  # noqa: E402
from palworld_save_tools.gvas import GvasFile  # noqa: E402
from palworld_save_tools.palsav import compress_gvas_to_sav  # noqa: E402
from palworld_save_tools.paltypes import (  # noqa: E402
    PALWORLD_CUSTOM_PROPERTIES,
    PALWORLD_TYPE_HINTS,
)

EMPTY = UUID.from_str("00000000-0000-0000-0000-000000000000")

PLAYER_UID = "11111111-1111-1111-1111-111111111111"
PALBOX_CONTAINER = "22222222-2222-2222-2222-222222222222"
PARTY_CONTAINER = "33333333-3333-3333-3333-333333333333"
GUILD_ID = "44444444-4444-4444-4444-444444444444"


def header():
    return {
        "magic": 0x53415647,
        "save_game_version": 3,
        "package_file_version_ue4": 522,
        "package_file_version_ue5": 1009,
        "engine_version_major": 5,
        "engine_version_minor": 1,
        "engine_version_patch": 1,
        "engine_version_changelist": 0,
        "engine_version_branch": "++UE5+Release-5.1",
        "custom_version_format": 3,
        "custom_versions": [],
        "save_game_class_name": "/Script/Pal.PalWorldSaveGame",
    }


def struct(value, struct_type="StructProperty"):
    return {
        "struct_type": struct_type,
        "struct_id": EMPTY,
        "id": None,
        "value": value,
        "type": "StructProperty",
    }


def guid_struct(value):
    return struct(UUID.from_str(value), struct_type="Guid")


def byte_prop(value):
    return {"id": None, "type": "ByteProperty", "value": {"type": "None", "value": value}}


def int_prop(value):
    return {"id": None, "type": "IntProperty", "value": value}


def str_prop(value):
    return {"id": None, "type": "StrProperty", "value": value}


def name_prop(value):
    return {"id": None, "type": "NameProperty", "value": value}


def bool_prop(value):
    return {"id": None, "type": "BoolProperty", "value": value}


def enum_prop(enum_type, value):
    return {"id": None, "type": "EnumProperty", "value": {"type": enum_type, "value": value}}


def name_array(values):
    return {
        "array_type": "NameProperty",
        "id": None,
        "value": {"values": list(values)},
        "type": "ArrayProperty",
    }


def enum_array(values):
    return {
        "array_type": "EnumProperty",
        "id": None,
        "value": {"values": list(values)},
        "type": "ArrayProperty",
    }


def slot_id(container, index):
    return struct(
        {
            "ContainerId": struct({"ID": guid_struct(container)}, struct_type="PalContainerId"),
            "SlotIndex": int_prop(index),
        },
        struct_type="PalCharacterSlotId",
    )


def pal(character_id, gender, passives, ivs, container, slot, nickname="", level=25, rank=1):
    """One CharacterSaveParameterMap entry for a Pal."""
    hp, attack, defense = ivs
    return {
        "CharacterID": name_prop(character_id),
        "Gender": enum_prop("EPalGenderType", f"EPalGenderType::{gender}"),
        "NickName": str_prop(nickname),
        "Level": byte_prop(level),
        "Exp": {"id": None, "type": "Int64Property", "value": 0},
        "Rank": byte_prop(rank),
        "Rank_HP": byte_prop(0),
        "Rank_Attack": byte_prop(0),
        "Rank_Defence": byte_prop(0),
        "Rank_CraftSpeed": byte_prop(0),
        "Talent_HP": byte_prop(hp),
        "Talent_Shot": byte_prop(attack),
        "Talent_Defense": byte_prop(defense),
        "PassiveSkillList": name_array(passives),
        "MasteredWaza": enum_array(["EPalWazaID::WaterGun", "EPalWazaID::IceMissile"]),
        "EquipWaza": enum_array(["EPalWazaID::WaterGun"]),
        "OwnerPlayerUId": guid_struct(PLAYER_UID),
        "SlotId": slot_id(container, slot),
    }


def player_character():
    return {
        "CharacterID": name_prop("PlayerFemale"),
        "IsPlayer": bool_prop(True),
        "NickName": str_prop("Tester"),
        "Level": byte_prop(40),
        "Exp": {"id": None, "type": "Int64Property", "value": 12345},
    }


def char_entry(instance_id, save_parameter, player_uid="00000000-0000-0000-0000-000000000000"):
    return {
        "key": {
            "PlayerUId": guid_struct(player_uid),
            "InstanceId": guid_struct(instance_id),
            "DebugName": str_prop(""),
        },
        "value": {
            "RawData": {
                "array_type": "ByteProperty",
                "id": None,
                "value": {
                    "object": {"SaveParameter": struct(save_parameter, "PalIndividualCharacterSaveParameter")},
                    "unknown_bytes": [0, 0, 0, 0],
                    "group_id": UUID.from_str(GUILD_ID),
                },
                "custom_type": ".worldSaveData.CharacterSaveParameterMap.Value.RawData",
                "type": "ArrayProperty",
            }
        },
    }


def character_map(entries):
    return {
        "key_type": "StructProperty",
        "value_type": "StructProperty",
        "key_struct_type": "StructProperty",
        "value_struct_type": "StructProperty",
        "id": None,
        "value": entries,
        "type": "MapProperty",
    }


def group_map():
    raw = {
        "group_type": "EPalGroupType::Guild",
        "group_id": UUID.from_str(GUILD_ID),
        "group_name": "Testers",
        "individual_character_handle_ids": [],
        "org_type": 0,
        "base_ids": [],
        "base_camp_level": 3,
        "map_object_instance_ids_base_camp_points": [],
        "guild_name": "Testers",
        "admin_player_uid": UUID.from_str(PLAYER_UID),
        "players": [
            {
                "player_uid": UUID.from_str(PLAYER_UID),
                "player_info": {"last_online_real_time": 1700000000, "player_name": "Tester"},
            }
        ],
    }
    entry = {
        "key": UUID.from_str(GUILD_ID),
        "value": {
            "GroupType": enum_prop("EPalGroupType", "EPalGroupType::Guild"),
            # No custom_type here: the group decoder is registered on the outer
            # MapProperty and rewrites this RawData in place.
            "RawData": {
                "array_type": "ByteProperty",
                "id": None,
                "value": raw,
                "type": "ArrayProperty",
            },
        },
    }
    return {
        "key_type": "StructProperty",
        "value_type": "StructProperty",
        "key_struct_type": "Guid",
        "value_struct_type": "StructProperty",
        "id": None,
        "value": [entry],
        "custom_type": ".worldSaveData.GroupSaveDataMap",
        "type": "MapProperty",
    }


def build_level():
    entries = [
        char_entry("aaaaaaaa-0000-0000-0000-000000000001", player_character(), PLAYER_UID),
        # Penking: the Artisan+Serious parent from the worked example. Note the save
        # stores internal names, which often differ from the displayed ones.
        char_entry(
            "aaaaaaaa-0000-0000-0000-000000000002",
            pal("CaptainPenguin", "Male", ["CraftSpeed_up2", "CraftSpeed_up1"], (94, 81, 97), PALBOX_CONTAINER, 12),
        ),
        # Celaray, carrying a negative passive to filter on.
        char_entry(
            "aaaaaaaa-0000-0000-0000-000000000003",
            pal("FlyingManta", "Female", ["PAL_CorporateSlave", "CraftSpeed_down1"], (30, 55, 40), PALBOX_CONTAINER, 37),
        ),
        # An alpha, to exercise the BOSS_ prefix stripping.
        char_entry(
            "aaaaaaaa-0000-0000-0000-000000000004",
            pal("BOSS_Anubis", "Male", ["Legend", "MoveSpeed_up_3"], (100, 100, 100), PARTY_CONTAINER, 0, nickname="Sandy", level=50, rank=3),
        ),
    ]
    world = {
        "CharacterSaveParameterMap": character_map(entries),
        "GroupSaveDataMap": group_map(),
        # A property PalForge should skip by byte length rather than parse.
        "FoliageGridSaveDataMap": {
            "key_type": "StructProperty",
            "value_type": "StructProperty",
            "key_struct_type": "StructProperty",
            "value_struct_type": "StructProperty",
            "id": None,
            "value": [],
            "type": "MapProperty",
        },
    }
    return {
        "header": header(),
        "properties": {"worldSaveData": struct(world, "PalWorldSaveData")},
        "trailer": base64.b64encode(b"\x00\x00\x00\x00").decode("utf-8"),
    }


def build_player():
    save_data = {
        "PlayerUId": guid_struct(PLAYER_UID),
        "PalStorageContainerId": struct({"ID": guid_struct(PALBOX_CONTAINER)}, "PalContainerId"),
        "OtomoCharacterContainerId": struct({"ID": guid_struct(PARTY_CONTAINER)}, "PalContainerId"),
    }
    return {
        "header": header(),
        "properties": {"SaveData": struct(save_data, "PalIndividualCharacterSaveParameter")},
        "trailer": base64.b64encode(b"\x00\x00\x00\x00").decode("utf-8"),
    }


def write_sav(path, payload, custom_properties):
    gvas = GvasFile.load(payload)
    data = gvas.write(custom_properties)
    with open(path, "wb") as fh:
        fh.write(compress_gvas_to_sav(data, 0x31))
    print(f"wrote {path} ({os.path.getsize(path):,} bytes)")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures"
    os.makedirs(os.path.join(out, "Players"), exist_ok=True)
    write_sav(os.path.join(out, "Level.sav"), build_level(), PALWORLD_CUSTOM_PROPERTIES)
    write_sav(
        os.path.join(out, "Players", PLAYER_UID.replace("-", "") + ".sav"),
        build_player(),
        {},
    )


if __name__ == "__main__":
    main()
