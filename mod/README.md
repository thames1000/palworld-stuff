# PalForge Palbox export

A small client-side mod that writes your Palbox and dimensional storage out as a PalForge
roster file.

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
2. **Open your Palbox or dimensional storage.** This matters: the mod reads Pals the client
   has loaded, and until a page has been shown to your client its contents are not
   necessarily in memory. If the export comes back with only the Pals in your party, this
   is why.
3. Press **F9** if you want to clear the current export session and start fresh.
4. Press **F8** after the current page loads.
5. Flip to the next Palbox or dimensional-storage page, wait for it to load, then press
   **F8** again. The file is cumulative, so every unique Pal seen by the current session is
   kept.
6. `PalForgeRoster.json` is written next to the game executable, in
   `Palworld/Pal/Binaries/Win64/`.
7. In PalForge: **My Pals → Import**, choose that file.

The UE4SS console lists the new Pals added by each scan, the cumulative count written to
the file, and how many loaded objects were duplicates or wild Pals. Re-scanning the same
page is safe when readable instance ids are available. If UE4SS hides those ids, the mod
prints a fallback-key warning and duplicate detection is best-effort.

The current implementation intentionally works from client-loaded Pal objects only. It
does not query the server's whole Palbox or dimensional storage in one call. That means the
reliable workflow is to page through the storage UI once and press **F8** on each loaded
page. If a future Palworld/UE4SS path exposes the full storage container directly, this can
become a one-shot export, but the cumulative scan is the safe client-side route today.

If the installed UE4SS build exposes reflected values only as `TrivialObject` memory
references, the mod cannot read the roster. It reports `Export unavailable` and deliberately
does not write a file; address strings are not valid species or roster data.

## What it reads

Species, gender, passives, IVs and nickname — the fields a plan is built from. Alpha and
predator variants are recorded as their base species (`BOSS_Anubis` → `Anubis`), which is
what matters for breeding. IVs come from `Talent_HP`, `Talent_Shot` and `Talent_Defense`,
the same mapping the save-file parser uses.

Wild Pals loaded around you are skipped when UE4SS exposes their owner GUID. Some UE4SS
builds expose GUIDs only as opaque memory references; on those builds the mod exports all
loaded Pal candidates and prints a warning that nearby wild Pals may be included. Export
immediately after opening the Palbox and check the reported count against the box.

## If it stops working

Palworld renames properties between versions, and this reads them by name. The mod is
written to fail loudly rather than silently: each field is read through a guard, so a
rename costs you that one field rather than the whole export.

The likely thing to adjust is at the top of `Scripts/main.lua` — `IV_FIELDS`,
`VARIANT_PREFIXES` and `GENDER_BY_VALUE` are constants for exactly this reason. The gender
fallback matches the current raw values (`None=0`, `Female=1`, `Male=2`) while still accepting
named enum values when UE4SS provides them.

## Status

The roster format and import path are tested, and the original exporter behavior has been
run against stubbed UE4SS objects covering alpha prefixes, both gender representations,
duplicate instances, wild Pals, the player character and JSON escaping.

What has **not** been verified is the binding to the live game — whether
`PalIndividualCharacterParameter`, the field names above and the dimensional-storage page
objects match your build of Palworld. That is the part to expect to adjust, and the console
output is there to make it obvious when it needs it.
