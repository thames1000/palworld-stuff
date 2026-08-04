# PalForge Palbox export

A small client-side mod that writes your Palbox out as a PalForge roster file.

It exists for one situation: playing on a server you do not administer. Your Pals live in
the server's `Level.sav`, and nothing the server exposes remotely carries the fields a
breeding plan needs — the REST API's player list has no Pal data at all, and its world
actor snapshot omits gender, passives and IVs. Without file access the only alternative is
typing your box back in by hand. This reads it from the copy your own client already holds.

**It is read-only.** It looks up objects, formats text, and writes one JSON file. It never
sets a property, calls a gameplay function, or sends anything to the server. Nothing about
what you own changes, and there is nothing here a server would see.

## Requirements

[UE4SS](https://github.com/UE4SS-RE/RE-UE4SS) for Palworld. Windows client only — this
hooks the game process, so it does not apply to the Linux dedicated server build.

## Install

Copy the `PalForgeExport` folder into your UE4SS mods directory:

```
Palworld/Pal/Binaries/Win64/ue4ss/Mods/PalForgeExport/     (UE4SS 3.x)
Palworld/Pal/Binaries/Win64/Mods/PalForgeExport/           (UE4SS 2.x)
```

The `enabled.txt` inside it is what UE4SS looks for. On 2.x you may also need to add a
`PalForgeExport : 1` line to `Mods/mods.txt`.

## Use

1. Launch the game and join your world.
2. **Open your Palbox.** This matters: the mod reads Pals the client has loaded, and until
   you have opened the box its contents are not necessarily in memory. If the export comes
   back with only the Pals in your party, this is why.
3. Press **F8**.
4. `PalForgeRoster.json` is written next to the game executable, in
   `Palworld/Pal/Binaries/Win64/`.
5. In PalForge: **My Pals → Import**, choose that file.

The UE4SS console lists every Pal as it exports, so you can check the result against the
box on screen without opening the file.

## What it reads

Species, gender, passives, IVs and nickname — the fields a plan is built from. Alpha and
predator variants are recorded as their base species (`BOSS_Anubis` → `Anubis`), which is
what matters for breeding. IVs come from `Talent_HP`, `Talent_Shot` and `Talent_Defense`,
the same mapping the save-file parser uses.

Wild Pals loaded around you are skipped: they have no owner, and that is the whole
ownership test. Your client is never sent another player's Palbox, so "has an owner at all"
is enough to mean "yours", without having to locate your own player id first.

## If it stops working

Palworld renames properties between versions, and this reads them by name. The mod is
written to fail loudly rather than silently: each field is read through a guard, so a
rename costs you that one field rather than the whole export.

The likely thing to adjust is at the top of `Scripts/main.lua` — `IV_FIELDS`,
`VARIANT_PREFIXES` and `GENDER_BY_VALUE` are constants for exactly this reason. If every
Pal exports with the wrong sex, swap the two values in `GENDER_BY_VALUE`; that means the
build is handing back raw enum integers rather than names, and nothing else needs changing.

## Status

The export logic and its output format are tested: the script has been run against stubbed
UE4SS objects covering alpha prefixes, both gender representations, duplicate instances,
wild Pals, the player character and JSON escaping, and its output imports through PalForge
with no warnings.

What has **not** been verified is the binding to the live game — whether
`PalIndividualCharacterParameter` and the field names above match your build of Palworld.
That is the part to expect to adjust, and the console output is there to make it obvious
when it needs it.
