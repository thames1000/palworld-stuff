import type { CakeVariant, TargetSpec } from './types.js';
import type { IvRollModel } from './probability.js';

export interface IvBonusRange {
  min: number;
  max: number;
}

export interface CakeInfo {
  id: CakeVariant;
  label: string;
  shortLabel: string;
  focus: string;
  effect: string;
  /** Egg output per breeding production cycle. Only Vegetable Cake is currently exact. */
  eggsPerCycle: number;
  /**
   * Estimated bonus applied to fresh IV rolls before threshold checks.
   *
   * Public sources describe the high-stat cakes qualitatively, but do not expose exact
   * weights. Keeping this explicit prevents the UI from implying datamined precision.
   */
  freshIvBonus?: IvBonusRange;
  aliases: string[];
}

export const CAKES: readonly CakeInfo[] = [
  {
    id: 'standard',
    label: 'Cake',
    shortLabel: 'Cake',
    focus: 'Baseline',
    effect: 'Original breeding cake. PalForge uses the datamined base inheritance and IV odds.',
    eggsPerCycle: 1,
    aliases: ['cake', 'normal', 'original', 'standard'],
  },
  {
    id: 'mushroom',
    label: 'Mushroom Cake',
    shortLabel: 'Mushroom',
    focus: 'IVs',
    effect:
      'Slightly improves the chance that newly born Pals have higher stats. PalForge models this as an estimated +1 to +5 fresh-IV uplift.',
    eggsPerCycle: 1,
    freshIvBonus: { min: 1, max: 5 },
    aliases: ['mushroom', 'mushroom-cake'],
  },
  {
    id: 'vegetable',
    label: 'Vegetable Cake',
    shortLabel: 'Vegetable',
    focus: 'Egg production',
    effect: 'Produces two Pal Eggs at once, so PalForge halves the displayed breeding cycles.',
    eggsPerCycle: 2,
    aliases: ['vegetable', 'vegetable-cake', 'veggie'],
  },
  {
    id: 'extravagant-vegetable',
    label: 'Extravagant Vegetable Cake',
    shortLabel: 'Extravagant',
    focus: 'Mutations + IVs',
    effect:
      'Raises mutation odds and makes better stat growth more likely. PalForge models the stat-growth part as an estimated +1 to +5 fresh-IV uplift.',
    eggsPerCycle: 1,
    freshIvBonus: { min: 1, max: 5 },
    aliases: [
      'extravagant',
      'extravagant-vegetable',
      'extravagant-vegetable-cake',
      'deluxe',
      'deluxe-vegetable',
      'deluxe-vegetable-cake',
    ],
  },
  {
    id: 'special',
    label: 'Special Cake',
    shortLabel: 'Special',
    focus: 'Passive inheritance',
    effect:
      'Improves the chance of inheriting multiple passive skills from the parents. Exact odds are not published, so PalForge keeps passive percentages at the base estimate.',
    eggsPerCycle: 1,
    aliases: ['special', 'special-cake'],
  },
];

const CAKE_BY_ID = new Map<CakeVariant, CakeInfo>(CAKES.map((cake) => [cake.id, cake]));
const CAKE_BY_ALIAS = new Map<string, CakeInfo>();
for (const cake of CAKES) {
  for (const alias of cake.aliases) CAKE_BY_ALIAS.set(alias.toLowerCase(), cake);
}

export function cakeInfo(id: CakeVariant | undefined): CakeInfo {
  return CAKE_BY_ID.get(id ?? 'standard') ?? CAKE_BY_ID.get('standard')!;
}

export function parseCakeVariant(value: string | undefined): CakeVariant | null {
  if (!value) return 'standard';
  const normalised = value.trim().toLowerCase().replaceAll(/\s+/g, '-');
  return CAKE_BY_ALIAS.get(normalised)?.id ?? null;
}

export function expectedProductionCycles(expectedEggs: number, cake: CakeVariant | undefined): number {
  return expectedEggs / cakeInfo(cake).eggsPerCycle;
}

export function cakeIvBonusLabel(id: CakeVariant | undefined): string | null {
  const bonus = cakeInfo(id).freshIvBonus;
  if (!bonus) return null;
  return bonus.min === bonus.max ? `+${bonus.min}` : `+${bonus.min} to +${bonus.max}`;
}

export function ivRollModelForCake(id: CakeVariant | undefined): IvRollModel {
  const bonus = cakeInfo(id).freshIvBonus;
  return bonus ? { freshBonusMin: bonus.min, freshBonusMax: bonus.max } : {};
}

export function cakeNotes(spec: TargetSpec): string[] {
  const cake = cakeInfo(spec.cake);
  const ivBonus = cakeIvBonusLabel(cake.id);
  switch (cake.id) {
    case 'mushroom':
      return [
        `Mushroom Cake uses PalForge's estimated ${ivBonus} fresh-IV uplift when IV floors are set.`,
      ];
    case 'vegetable':
      return ['Vegetable Cake produces two eggs per cycle; hatch odds stay the same, production cycles drop.'];
    case 'extravagant-vegetable':
      return [
        `Extravagant Vegetable Cake uses PalForge's estimated ${ivBonus} fresh-IV uplift when IV floors are set; mutation odds are shown as separate chance-based options when applicable.`,
      ];
    case 'special':
      return [
        'Special Cake supports multi-passive inheritance, but PalForge still reports the base passive odds until exact weights are known.',
      ];
    case 'standard':
      return [];
  }
}
