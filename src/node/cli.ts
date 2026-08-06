#!/usr/bin/env node
/**
 * PalForge CLI.
 *
 *   palforge <save-path> --target Anubis --passives Artisan,Serious,Lucky
 *
 * `save-path` is the folder containing Level.sav (or the Level.sav itself).
 */
import { loadSave } from './loadSave.js';
import {
  DATASET_VERSION,
  findPassive,
  findSpecies,
  passiveDisplayName,
  speciesName,
  SPECIES,
} from '../core/data/index.js';
import { CAKES, parseCakeVariant } from '../core/solver/cakes.js';
import { solve, speciesLeadingTo } from '../core/solver/search.js';
import type { OptimizationMode, TargetSpec } from '../core/solver/types.js';
import {
  planToJson,
  renderMermaid,
  renderPalList,
  renderPlan,
  renderSpeciesSuggestions,
  setColor,
} from './render.js';
import type { Pal, SaveData } from '../core/save/types.js';

interface Args {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { positional, flags };
}

function str(args: Args, key: string): string | undefined {
  const v = args.flags.get(key);
  return typeof v === 'string' ? v : undefined;
}

function num(args: Args, key: string, fallback: number): number {
  const v = str(args, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(args: Args, key: string): boolean {
  return args.flags.get(key) === true || args.flags.get(key) === 'true';
}

function list(args: Args, key: string): string[] {
  const v = str(args, key);
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const USAGE = `
PalForge - breeding planner driven by your actual Palworld save

Usage:
  palforge <save-path> [options]

  <save-path>  Folder containing Level.sav, or the Level.sav file itself.
               Typically: .../Pal/Saved/SaveGames/<steam-id>/<world-id>/

Target:
  --target <species>        Species to breed, by display or internal name
  --passives a,b,c          Passives the result must have (max 4)
  --exclude a,b             Passives the result must not have
  --gender Male|Female      Required gender of the result
  --min-hp N                Minimum HP IV (0-100)
  --min-attack N            Minimum Attack IV
  --min-defense N           Minimum Defense IV
  --cake <variant>          cake | mushroom | vegetable | extravagant | special

Search:
  --mode <mode>             generations | eggs | clean | balanced   (default: balanced)
  --max-generations N       Depth limit for the breeding tree       (default: 5)
  --beam N                  Nodes carried per round; higher is slower but more thorough
                                                                    (default: 1200)
  --allow-excluded-parents  Let Pals carrying an excluded passive act as parents

Scope:
  --player <name|uid>       Only use Pals owned by this player
  --guild <name>            Only use Pals belonging to this guild
  --include-party           Include party Pals as breeding candidates (default: on)
  --skip-player-files       Do not read Players/*.sav (faster, coarser locations)

Output:
  --list-pals               List the candidate Pals instead of solving
  --list-species            List every known species and exit
  --list-passives           List every known passive and exit
  --limit N                 Row limit for listings                  (default: 40)
  --mermaid                 Also print a Mermaid diagram of the plan
  --json                    Machine-readable output
  --no-color                Disable ANSI colour
  --help                    This message
`;

function selectCandidates(save: SaveData, args: Args): { pals: Pal[]; scope: string } {
  let pals = save.pals;
  const scopes: string[] = [];

  const playerQuery = str(args, 'player');
  if (playerQuery) {
    const q = playerQuery.toLowerCase();
    const player =
      save.players.find((p) => p.name.toLowerCase() === q) ??
      save.players.find((p) => p.playerUid.toLowerCase() === q) ??
      save.players.find((p) => p.name.toLowerCase().includes(q));
    if (!player) {
      const known = save.players.map((p) => p.name).join(', ') || '(none found)';
      throw new Error(`No player matching "${playerQuery}". Players in this save: ${known}`);
    }
    pals = pals.filter((p) => p.ownerPlayerUid === player.playerUid);
    scopes.push(`player ${player.name}`);
  }

  const guildQuery = str(args, 'guild');
  if (guildQuery) {
    const q = guildQuery.toLowerCase();
    const guild =
      save.guilds.find((g) => g.name.toLowerCase() === q) ??
      save.guilds.find((g) => g.name.toLowerCase().includes(q));
    if (!guild) {
      const known = save.guilds.map((g) => g.name).join(', ') || '(none found)';
      throw new Error(`No guild matching "${guildQuery}". Guilds in this save: ${known}`);
    }
    pals = pals.filter((p) => p.groupId === guild.groupId);
    scopes.push(`guild ${guild.name}`);
  }

  return { pals, scope: scopes.join(', ') || 'all Pals in the save' };
}

function resolvePassives(names: string[], label: string): string[] {
  return names.map((n) => {
    const passive = findPassive(n);
    if (!passive) {
      throw new Error(`Unknown ${label} passive "${n}". Use --list-passives to see valid names.`);
    }
    return passive.internalName;
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (bool(args, 'no-color') || process.env.NO_COLOR) setColor(false);

  if (bool(args, 'help') || args.positional.length === 0) {
    // Listings that need no save file still work without a path.
    if (bool(args, 'list-species')) {
      const limit = num(args, 'limit', 1000);
      for (const s of [...SPECIES].sort((a, b) => a.paldexNo - b.paldexNo).slice(0, limit)) {
        console.log(`  #${String(s.paldexNo).padStart(3)}  ${s.name}  (${s.internalName})`);
      }
      return 0;
    }
    if (bool(args, 'list-passives')) {
      const { PASSIVES } = await import('../core/data/index.js');
      for (const p of [...PASSIVES].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))) {
        const sign = p.rank > 0 ? `+${p.rank}` : String(p.rank);
        console.log(`  ${p.name.padEnd(26)} rank ${sign.padStart(2)}  (${p.internalName})`);
      }
      return 0;
    }
    console.log(USAGE);
    console.log(`  game data: PalCalc dataset ${DATASET_VERSION}, ${SPECIES.length} species\n`);
    return args.positional.length === 0 && !bool(args, 'help') ? 1 : 0;
  }

  const savePath = args.positional[0]!;
  const save = await loadSave(savePath, { skipPlayerFiles: bool(args, 'skip-player-files') });

  for (const warning of save.warnings) console.error(`warning: ${warning}`);

  const { pals, scope } = selectCandidates(save, args);

  if (bool(args, 'list-pals')) {
    console.log(renderPalList(pals, num(args, 'limit', 40)));
    return 0;
  }

  const targetName = str(args, 'target');
  if (!targetName) {
    console.error('Missing --target. Run with --help for usage.');
    console.error(
      `\nThis save has ${save.pals.length} Pals, ${save.players.length} player(s): ` +
        save.players.map((p) => p.name).join(', '),
    );
    return 1;
  }

  const speciesIndex = findSpecies(targetName);
  if (speciesIndex < 0) {
    console.error(`Unknown species "${targetName}". Use --list-species to see valid names.`);
    return 1;
  }

  const requiredPassives = resolvePassives(list(args, 'passives'), 'required');
  if (requiredPassives.length > 4) {
    console.error('A Pal can hold at most 4 passives, so --passives accepts at most 4.');
    return 1;
  }
  const excludedPassives = resolvePassives(list(args, 'exclude'), 'excluded');

  const genderArg = str(args, 'gender');
  if (genderArg && genderArg !== 'Male' && genderArg !== 'Female') {
    console.error('--gender must be Male or Female.');
    return 1;
  }

  const modeArg = (str(args, 'mode') ?? 'balanced') as OptimizationMode;
  if (!['generations', 'eggs', 'clean', 'balanced'].includes(modeArg)) {
    console.error(`Unknown --mode "${modeArg}". Valid: generations, eggs, clean, balanced.`);
    return 1;
  }

  const cake = parseCakeVariant(str(args, 'cake'));
  if (!cake) {
    console.error(
      `Unknown --cake "${str(args, 'cake')}". Valid: ${CAKES.map((c) => c.aliases[0]).join(', ')}.`,
    );
    return 1;
  }

  const spec: TargetSpec = {
    speciesIndex,
    requiredPassives,
    excludedPassives,
    minIvs: {
      hp: num(args, 'min-hp', 0) || null,
      attack: num(args, 'min-attack', 0) || null,
      defense: num(args, 'min-defense', 0) || null,
    },
    gender: (genderArg as 'Male' | 'Female' | undefined) ?? null,
    maxGenerations: num(args, 'max-generations', 5),
    mode: modeArg,
    beamSize: num(args, 'beam', 1200),
    allowExcludedParents: bool(args, 'allow-excluded-parents'),
    cake,
  };

  const result = solve(pals, spec);

  if (bool(args, 'json')) {
    console.log(
      JSON.stringify({ scope, candidatePals: pals.length, ...(planToJson(result, spec) as object) }, null, 2),
    );
    return result.plan || result.feasibility === 'already-owned' ? 0 : 2;
  }

  console.log(`\nSave: ${savePath}`);
  console.log(
    `Scope: ${scope} - ${pals.length} candidate Pal(s), parsed in ${save.meta.parseMs}ms ` +
      `(${save.meta.container} container)`,
  );
  console.log(renderPlan(result, spec));

  if (result.feasibility === 'species-unreachable') {
    const leads = speciesLeadingTo(speciesIndex, 2);
    if (leads.length) {
      console.log('Species that reach the target within 2 breeding steps:');
      console.log(renderSpeciesSuggestions(leads, num(args, 'limit', 15)));
      console.log('');
    }
  }

  if (bool(args, 'mermaid') && result.plan) {
    console.log('Mermaid diagram:\n');
    console.log(renderMermaid(result.plan, spec));
    console.log('');
  }

  return result.plan || result.feasibility === 'already-owned' ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`\nerror: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
