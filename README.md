# PalForge

Breeding planner for Palworld that reads your actual save file.

Pick your save, name a target species and the passives you want, and it works out whether
you can get there with the Pals you already own — and if so, the exact sequence of pairings,
including where each parent is sitting in your Palbox.

No save to hand? The web app also plans from a roster you type in yourself, and lets you
build a route by hand — see [Planning without a save](#planning-without-a-save).

There are two front-ends over one shared core: a **web app** that runs entirely in your
browser, and a **CLI**.

---

## Web app

```bash
npm install
npm run web:dev      # http://localhost:5173
npm run web:build    # static site in dist-web/
```

`dist-web/` is a plain static bundle — drop it on GitHub Pages, Netlify, Cloudflare Pages,
or any static host. It is built with a relative base path, so it works from a subdirectory
as well as a domain root.

**Vercel.** `vercel.json` configures it: import the repo and deploy, no dashboard settings
needed. The config exists because the defaults would be wrong — Vercel's Vite preset runs
`npm run build`, which here is `tsc` for the CLI, and serves `dist/`. It is pointed at
`npm run web:build` and `dist-web/` instead. There are no rewrites: the app is a single page
with no router, and a catch-all would break the relative asset paths on any nested URL.
Hashed files under `/assets/` get a one-year immutable cache.

`engines.node` lists the majors this builds on rather than an open `>=20`. Vercel resolves
that field to the newest *available* major it matches and lets it override the dashboard
setting, so an open range quietly moves the build onto each new Node major as it lands.
The list resolves to the same version an open range does today; it just stops moving on its
own.

**Nothing is uploaded.** The save is read, parsed, and solved in the browser; there is no
server and no network request carrying your data. That matters beyond principle: a Palworld
save contains the Steam IDs and display names of everyone who has played on that world, so
a tool that uploaded it would be taking custody of other people's data.

Drop (or pick) the **world folder** — the one containing `Level.sav`. Including its
`Players/` subfolder is what lets PalForge report exact Palbox page, row and column; with
only `Level.sav` you still get every Pal, but locations degrade to raw container IDs.

The UI has three surfaces:

- **Plan** — target builder on the left (species, required and excluded passives, IV floors,
  gender, generation cap, optimisation mode), plan on the right: a verdict banner, then
  numbered steps showing each parent, where to find it, what to keep, and expected eggs.
- **Pals** — every Pal in scope, searchable by species, nickname or passive, filterable by
  gender, location and IV floor, sortable by any column. Click a species to make it the plan
  target. Without a save, this is where you enter the Pals you own instead.
- **Explore** — build a route yourself rather than having one solved for you. See
  [Planning without a save](#planning-without-a-save).

Parsing and solving run in a Web Worker, so a large save never freezes the page.

## Planning without a save

The save file is the fastest way in, not a requirement. **Plan without a save** on the
landing screen skips it entirely, and both of the surfaces it opens work identically when a
save *is* loaded.

**My Pals** is a roster you type in. **Add a Pal** opens a dialog where you pick the species
and fill in gender, passives and — if you know them — IVs, so each entry arrives complete
and the list stays a scannable one-line-per-Pal summary however long it gets. *Add and enter
another* keeps the dialog open on the same species for entering a run of them. That roster
feeds the same solver the save-file path uses, so the verdicts, egg estimates and step lists
are the ones you would get from a save.

**Explore** is the reverse of the solver. You start from the Pal you want and, for each
slot, either say you already have one or pick a pair that makes it — chosen from the full
list of parent pairs that produce that species, with the ones you can field right now
sorted to the top. Every pairing is checked against the breeding table as you go, so a
branch that no longer produces what the slot claims says so rather than quietly breaking
the plan. The egg and passive math is shared with the automatic search, so a hand-built
route and a solved one are directly comparable. There is also a plain `A × B = ?` lookup.

**Carrying a roster between browsers.** *Export* writes the list to a `.json` file (or copies
it to the clipboard); *Import* takes that file back, or pasted text, and either adds it to
what is already there or replaces it. Entries are keyed by the game's internal names rather
than by position in the dataset, so a roster exported today still reads correctly after a
Palworld patch shifts the dataset around. Display names are accepted on the way in too, so a
hand-written list works, and anything unreadable is reported entry by entry instead of being
silently dropped.

Both are kept in the browser's local storage and nowhere else. A tree remembers the Pals
filling its slots, so it survives editing your roster or opening a different save — slots
whose Pal is still around are re-read from it, and slots whose Pal has gone are flagged
rather than silently believed.

The 288×288 breeding matrices only load when you open Explore, so the initial page is no
heavier than it was before.

## CLI

```bash
npm run build
node dist/node/cli.js <save-path> --target Anubis --passives Artisan,Serious
# or, without building:
npm run dev -- <save-path> --target Anubis --passives Artisan,Serious
```

`<save-path>` is the folder containing `Level.sav`, or the file itself. The CLI always needs
a save; hand-entered rosters and manual routes are web-app features.

| Flag | Meaning |
| --- | --- |
| `--target <species>` | Species to breed, by display or internal name |
| `--passives a,b,c` | Passives the result must have (max 4) |
| `--exclude a,b` | Passives the result must not have |
| `--gender Male\|Female` | Required gender of the result |
| `--min-hp/--min-attack/--min-defense N` | IV thresholds |
| `--mode` | `generations` \| `eggs` \| `clean` \| `balanced` (default) |
| `--max-generations N` | Depth limit for the tree (default 5) |
| `--beam N` | Nodes carried per round; higher is slower and more thorough (default 1200) |
| `--player <name>` / `--guild <name>` | Restrict the candidate pool |
| `--list-pals` | Show the candidate Pals instead of solving |
| `--list-species` / `--list-passives` | Reference listings (no save needed) |
| `--mermaid` | Also print a Mermaid diagram of the plan |
| `--json` | Machine-readable output |

## Where saves live

| Platform | Location |
| --- | --- |
| Steam (Windows) | `%LOCALAPPDATA%\Pal\Saved\SaveGames\<steam-id>\<world-id>\` |
| Steam (Linux/Proton) | `~/.steam/steam/steamapps/compatdata/1623730/pfx/drive_c/users/steamuser/AppData/Local/Pal/Saved/SaveGames/...` |
| Xbox / Game Pass | `%LOCALAPPDATA%\Packages\PocketpairInc.Palworld_...\SystemAppData\wgs\` |
| Dedicated server | `<server>/Pal/Saved/SaveGames/0/<world-id>/` |

## "Is it possible?"

Both front-ends report the same verdict:

- `already-owned` — you already have a Pal meeting the whole spec
- `breedable` — a complete route exists using only Pals you own
- `missing-passives` — the species is reachable but some required passive exists nowhere in
  your save, so a guaranteed (non-mutation) route is impossible
- `species-unreachable` — no chain of pairings from anything you own produces the target
- `no-pals` — nothing usable in the current scope

## How it works

**Save reading.** `.sav` files are a compressed wrapper around Unreal's GVAS format.
PalForge handles both containers — `PlZ` (zlib, up to game 0.5.x) and `PlM` (Oodle Kraken,
0.6 onward including 1.0) — plus the Xbox `CNK` header. Only three branches of
`worldSaveData` are actually parsed (Pals, Pal containers, guilds); everything else is
skipped by its recorded byte length, which is what keeps a large `Level.sav` readable in
seconds.

**Breeding table.** Palworld's breeding results are *not* a formula. A "child rank is the
average of the parents" model gets a large fraction of pairs wrong, so PalForge ships the
full datamined 288×288 parent-pair table from
[PalCalc](https://github.com/tylercamp/palcalc), along with per-species gender ratios and
the inheritance weights the probability math needs.

**Reverse lookup.** The Explore tab needs the opposite of the breeding table — every parent
pair that produces a given species. That index is derived from the same matrix on first use
rather than shipped separately; the table is symmetric across all 82,944 entries, so pairs
are stored once and `A × B` and `B × A` are never both offered.

**Search.** A bounded dynamic program over `(species, passive bitmask)` states. Each round
pairs the surviving nodes, looks the child species up in the table, and unions the parents'
passive masks. The best node per state is kept, and a beam of the most promising ones is
carried forward. PalCalc's precomputed minimum-breeding-step matrix prunes any species that
can no longer reach the target in the generations remaining.

### Modelling assumptions

These drive the egg estimates, so they are worth knowing:

- An **owned** Pal's parent pool is its real passive list, junk included. A Pal with four
  passives genuinely is a poor parent and the math reflects that.
- A **bred** intermediate is assumed to carry only the passives the plan wants from it. In
  practice you re-roll until you get a reasonably clean child, so this is the optimistic end
  of the range. Expected junk is reported separately, and `--mode clean` optimises against it.
- Success at a step means the child has **all** the wanted passives; extras are tolerated.
- A pair of species always produces the same child, so **passive inheritance is the only
  per-egg uncertainty**. Where a step costs more than its passive odds alone, that is the
  separate cost of getting its two parents to be opposite sexes — a bred parent having to
  come out a particular sex at that species' gender ratio, or two bred parents having to
  land opposite each other. The two are reported separately rather than multiplied into one
  "per hatch" figure, which would read as though the egg might hatch the wrong species.
- Fresh IV rolls are treated as uniform over 0–100, approximating the game's real roll
  distribution.
- A hand-entered Pal is modelled exactly like a save-file one. Where a value cannot
  reasonably be typed from memory it is filled in neutrally — unknown IVs count as 50, and a
  Pal with no gender set is treated as able to pair with anything, which is optimistic.
- The search is a beam heuristic, not an exhaustive proof. A `species-unreachable` verdict
  *is* exact (it comes from the reachability matrix), but "no route found" within a given
  generation cap and beam is not proof that none exists — widen them.

## Scope

Implemented: save import (PlZ/PlM/CNK), player and guild selection, species/gender/passive/
IV/skill/location extraction, owned-only route search, reachability reporting, route
ranking, full plan output with Palbox locations, hand-entered rosters, hand-built routes
with reverse parent-pair lookup, and both front-ends.

Not yet implemented: mutation routes, Cake selection and resource costs, active-skill
inheritance as a search constraint, incubation-time optimisation, and shareable plan links.
IV thresholds currently act as a filter and a final-step probability report rather than a
dimension of the search itself. Hand-built routes are not checked for whether you own
enough copies of a Pal to run two branches at once.

## Layout

```
src/core/     platform-neutral: parser, data tables, solver (no Node APIs at all)
src/node/     CLI and filesystem glue
web/          Vite + React + Tailwind app; worker/ runs the core off the main thread
scripts/      data generation, test-fixture generation
tests/        parser, solver, performance, and web render tests
```

`src/core` uses only `Uint8Array`, `DataView`, `TextDecoder`, `DecompressionStream` and
`atob`, all of which exist in both Node 20+ and browsers — so there is exactly one
implementation of the parsing and solving logic, not two.

## Updating game data after a patch

```bash
npm run gen-data
```

Pulls a fresh dataset from PalCalc and rewrites `src/core/data/tables.ts` and
`matrices.ts`. The script prints the dataset version and warns if any species pair no longer
resolves to a child. The two 288×288 matrices live in their own module because only the
solver and the Explore tab need them — that keeps ~440 kB out of the initial UI bundle, the
worker having its own copy and the explorer being loaded on demand.

## Development

```bash
npm test           # vitest: parser, solver, performance, web render
npm run typecheck  # both the Node and web tsconfigs
```

The parser tests read a fixture in `tests/fixtures` that is **written by
[cheahjs/palworld-save-tools](https://github.com/cheahjs/palworld-save-tools)** (see
`scripts/make-fixture.py`), so they check PalForge against an independent implementation of
the format rather than against itself. Regenerating it needs Python 3.9+ and a checkout of
that project:

```bash
PST=/path/to/palworld-save-tools python3 scripts/make-fixture.py tests/fixtures
```

## Credits and licensing

- Breeding, species and passive data: [PalCalc](https://github.com/tylercamp/palcalc),
  datamined from the game's `.pak` files.
- Save format reference implementation:
  [cheahjs/palworld-save-tools](https://github.com/cheahjs/palworld-save-tools) (MIT).
- Oodle decompression for `PlM` saves: [`ooz-wasm`](https://www.npmjs.com/package/ooz-wasm),
  which is **GPL-3.0-or-later**. It is loaded lazily and only touched when a `PlM` save is
  opened, but if you intend to redistribute PalForge — including hosting the web app — that
  licence applies to what you ship.
