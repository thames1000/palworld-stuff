/** Guards against the search becoming unusable on a realistically large Palbox. */
import { describe, expect, it } from 'vitest';
import { SPECIES, findPassive, findSpecies } from '../src/core/data/index.js';
import { solve } from '../src/core/solver/search.js';
import type { Pal } from '../src/core/save/types.js';
import type { TargetSpec } from '../src/core/solver/types.js';

const PASSIVE_NAMES = ['Artisan', 'Serious', 'Lucky', 'Swift', 'Runner', 'Musclehead', 'Clumsy', 'Brittle'];
const PASSIVES = PASSIVE_NAMES.map((n) => findPassive(n)!.internalName);

/** A deterministic Palbox spread across every species, with varied passive loadouts. */
function buildPalbox(size: number): Pal[] {
  const pals: Pal[] = [];
  for (let i = 0; i < size; i++) {
    const speciesIndex = (i * 7) % SPECIES.length;
    const passives = new Set<string>();
    for (let k = 0; k < i % 4; k++) passives.add(PASSIVES[(i + k) % PASSIVES.length]!);
    pals.push({
      instanceId: `p${i}`,
      speciesIndex,
      characterId: SPECIES[speciesIndex]!.internalName,
      isBoss: false,
      nickname: '',
      gender: i % 2 ? 'Male' : 'Female',
      level: 30,
      rank: 1,
      souls: { hp: 0, attack: 0, defense: 0, craftSpeed: 0 },
      ivs: { hp: 50 + (i % 50), attack: 50 + (i % 40), defense: 50 + (i % 30) },
      passives: [...passives],
      masteredSkills: [],
      equippedSkills: [],
      ownerPlayerUid: 'player-1',
      groupId: 'guild-1',
      location: { kind: 'palbox', containerId: 'c1', slotIndex: i, label: `Palbox slot ${i}` },
    });
  }
  return pals;
}

function spec(beamSize: number): TargetSpec {
  return {
    speciesIndex: findSpecies('Anubis'),
    requiredPassives: PASSIVES.slice(0, 4),
    excludedPassives: [],
    minIvs: { hp: null, attack: null, defense: null },
    gender: 'Male',
    maxGenerations: 5,
    mode: 'balanced',
    beamSize,
    allowExcludedParents: false,
  };
}

describe('search performance', () => {
  const pals = buildPalbox(960);

  it('solves a full 960-slot Palbox for a 4-passive target at the default beam', () => {
    const result = solve(pals, spec(1200));
    expect(result.feasibility).toBe('breedable');
    expect(result.plan).not.toBeNull();
    // Well under the point where a CLI would feel broken.
    expect(result.elapsedMs).toBeLessThan(15000);
  }, 60000);

  it('does not return a worse plan when the beam is widened', () => {
    const narrow = solve(pals, spec(400));
    const wide = solve(pals, spec(3000));
    expect(narrow.plan).not.toBeNull();
    expect(wide.plan).not.toBeNull();
    // A wider beam explores a superset of the narrow one's nodes, so the plan it settles
    // on must never cost more.
    expect(wide.plan!.totalEggs).toBeLessThanOrEqual(narrow.plan!.totalEggs + 1e-6);
  }, 120000);
});
