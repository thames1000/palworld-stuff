/**
 * Typed access to the datamined game tables.
 *
 * Everything comes from the generated `tables.ts` module, so this works identically in
 * Node, in a bundler, and in a Web Worker -- no filesystem, no fetch, no JSON import
 * attributes. Regenerate with `npm run gen-data` after a Palworld patch.
 */
import {
  ACTIVE_SKILLS_TABLE,
  DATASET_VERSION as VERSION,
  GENDERED_COMBOS_TABLE,
  MECHANICS_TABLE,
  PASSIVES_TABLE,
  SPECIES_TABLE,
  type ActiveSkillRow,
  type GenderedComboRow,
  type PassiveRow,
  type SpeciesRow,
} from './tables.js';

export type Species = SpeciesRow;
export type Passive = PassiveRow;
export type ActiveSkill = ActiveSkillRow;
export type GenderedCombo = GenderedComboRow;

export interface BreedingMechanics {
  /** How many IVs come from parents (rest are rolled fresh), as weight per count. */
  ivInheritanceWeights: Record<string, number>;
  /** How many passives are drawn from the combined parent pool, as weight per count. */
  passiveInheritanceWeights: Record<string, number>;
  /** How many extra random passives are added on top, as weight per count. */
  passiveRandomWeights: Record<string, number>;
  unreachableSentinel: number;
}

export const DATASET_VERSION = VERSION;
export const SPECIES: readonly Species[] = SPECIES_TABLE;
export const PASSIVES: readonly Passive[] = PASSIVES_TABLE;
export const ACTIVE_SKILLS: readonly ActiveSkill[] = ACTIVE_SKILLS_TABLE;
export const MECHANICS: BreedingMechanics = MECHANICS_TABLE;

/** Pairs whose child depends on which parent is male. Rare, but must be surfaced. */
export const GENDERED_COMBOS: readonly GenderedCombo[] = GENDERED_COMBOS_TABLE;

const byInternal = new Map<string, number>();
const byLowerName = new Map<string, number>();
SPECIES.forEach((s, i) => {
  byInternal.set(s.internalName.toLowerCase(), i);
  byLowerName.set(s.name.toLowerCase(), i);
});

/**
 * Resolves a save-file CharacterID to a species index.
 *
 * Alpha/boss Pals are stored with a `BOSS_` prefix and predator variants with `PREDATOR_`;
 * both are the same breeding species as the base form. Returns -1 for humans and for
 * anything not in the dataset (event-only pals, NPCs).
 */
export function speciesIndexFromCharacterId(characterId: string): number {
  let id = characterId;
  for (const prefix of ['BOSS_', 'PREDATOR_', 'SUMMON_']) {
    if (id.toUpperCase().startsWith(prefix)) id = id.slice(prefix.length);
  }
  return byInternal.get(id.toLowerCase()) ?? -1;
}

/** Looks up a species by display name or internal name, case-insensitively. */
export function findSpecies(query: string): number {
  const q = query.trim().toLowerCase();
  return byLowerName.get(q) ?? byInternal.get(q) ?? -1;
}

export function speciesName(index: number): string {
  return SPECIES[index]?.name ?? `Unknown(${index})`;
}

const PALMODS_ICON_BASE_URL = 'https://assets.palmods.gg/v1.0.0/pals/icons/';

function palmodsIconSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, '$1')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Public Pal portrait used only for optional diagram/icon rendering. */
export function speciesIconUrl(index: number): string | null {
  const species = SPECIES[index];
  if (!species) return null;
  return `${PALMODS_ICON_BASE_URL}${palmodsIconSlug(species.name)}.webp`;
}

const passiveByInternal = new Map<string, Passive>();
const passiveByLowerName = new Map<string, Passive>();
for (const p of PASSIVES) {
  passiveByInternal.set(p.internalName.toLowerCase(), p);
  passiveByLowerName.set(p.name.toLowerCase(), p);
}

export function findPassive(query: string): Passive | undefined {
  const q = query.trim().toLowerCase();
  return passiveByLowerName.get(q) ?? passiveByInternal.get(q);
}

export function passiveDisplayName(internalName: string): string {
  return passiveByInternal.get(internalName.toLowerCase())?.name ?? internalName;
}

export type PassiveColorTier = 'diamond' | 'yellow' | 'white' | 'red';

export function passiveColorTierForRank(rank: number): PassiveColorTier {
  if (rank < 0) return 'red';
  if (rank >= 4) return 'diamond';
  if (rank >= 3) return 'yellow';
  return 'white';
}

export function passiveColorTier(internalName: string): PassiveColorTier {
  return passiveColorTierForRank(passiveByInternalName(internalName)?.rank ?? 0);
}

/** Full passive record for a save-file internal name, when the game documents it. */
export function passiveByInternalName(internalName: string): Passive | undefined {
  return passiveByInternal.get(internalName.toLowerCase());
}

const activeByInternal = new Map<string, ActiveSkill>();
for (const s of ACTIVE_SKILLS) activeByInternal.set(s.internalName.toLowerCase(), s);

export function activeSkillDisplayName(internalName: string): string {
  // Save files store these as `EPalWazaID::Foo`.
  const bare = internalName.replace(/^EPalWazaID::/i, '');
  return activeByInternal.get(bare.toLowerCase())?.name ?? bare;
}
