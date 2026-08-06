/**
 * Planning without a save: the reverse breeding index, hand-entered Pals, and the
 * scoring of trees the player builds themselves.
 */
import { describe, expect, it } from 'vitest';
import {
  BREEDING_MATRIX,
  breedingResult,
  genderedCombosFor,
  parentPairsFor,
} from '../src/core/data/breeding.js';
import { GENDERED_COMBOS, SPECIES, findPassive, findSpecies, speciesName } from '../src/core/data/index.js';
import { manualPal, type ManualPalSpec } from '../src/core/save/manual.js';
import { parseRosterFile, serializeRoster } from '../src/core/save/rosterFile.js';
import { evaluateManualTree, newManualNode, updateManualNode, type ManualNode } from '../src/core/solver/manual.js';
import { solve } from '../src/core/solver/search.js';
import type { TargetSpec } from '../src/core/solver/types.js';
import type { Gender } from '../src/core/save/types.js';

const ARTISAN = findPassive('Artisan')!.internalName;
const SERIOUS = findPassive('Serious')!.internalName;
const LUCKY = findPassive('Lucky')!.internalName;

let counter = 0;
function pal(species: string, gender: Gender, passives: string[] = []): ManualPalSpec {
  const speciesIndex = findSpecies(species);
  if (speciesIndex < 0) throw new Error(`unknown test species ${species}`);
  counter++;
  return {
    id: `m${counter}`,
    speciesIndex,
    gender,
    passives,
    ivs: { hp: 50, attack: 50, defense: 50 },
    nickname: '',
  };
}

/** A one-step tree: two Pals you have, bred into `target`. */
function pairTree(target: string, a: ManualPalSpec, b: ManualPalSpec): ManualNode {
  return {
    id: 'root',
    speciesIndex: findSpecies(target),
    have: null,
    parents: [
      { id: 'a', speciesIndex: a.speciesIndex, have: a, parents: null },
      { id: 'b', speciesIndex: b.speciesIndex, have: b, parents: null },
    ],
  };
}

describe('reverse breeding index', () => {
  it('only lists pairs that really produce the child', () => {
    for (const name of ['Anubis', 'Penking', 'Lamball', 'Jetragon']) {
      const child = findSpecies(name);
      const pairs = parentPairsFor(child);
      expect(pairs.length).toBeGreaterThan(0);
      for (const [a, b] of pairs) {
        expect(breedingResult(a, b)).toBe(child);
      }
    }
  });

  it('lists every pair that produces the child, exactly once', () => {
    const child = findSpecies('Anubis');
    const brute: string[] = [];
    for (let a = 0; a < SPECIES.length; a++) {
      for (let b = a; b < SPECIES.length; b++) {
        if (BREEDING_MATRIX[a]![b] === child) brute.push(`${a}x${b}`);
      }
    }
    const listed = parentPairsFor(child).map(([a, b]) => `${a}x${b}`);
    expect([...listed].sort()).toEqual([...brute].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('covers every species, and the index partitions the whole table', () => {
    let total = 0;
    for (let i = 0; i < SPECIES.length; i++) {
      const pairs = parentPairsFor(i);
      expect(pairs.length).toBeGreaterThan(0);
      total += pairs.length;
    }
    // Every unordered pair of the 288 species produces exactly one child.
    expect(total).toBe((SPECIES.length * (SPECIES.length + 1)) / 2);
  });

  it('normalises pairs so a x b and b x a are one entry', () => {
    for (const [a, b] of parentPairsFor(findSpecies('Penking'))) {
      expect(a).toBeLessThanOrEqual(b);
    }
  });

  it('flags the pairs whose child depends on which parent is male', () => {
    const combo = GENDERED_COMBOS[0]!;
    const found = genderedCombosFor(combo.parentA, combo.parentB);
    expect(found.length).toBeGreaterThan(0);
    // Order of the arguments must not matter.
    expect(genderedCombosFor(combo.parentB, combo.parentA)).toEqual(found);
    // An ordinary pair has none.
    expect(genderedCombosFor(findSpecies('Lamball'), findSpecies('Cattiva'))).toHaveLength(0);
  });
});

describe('hand-entered Pals', () => {
  it('produces a Pal the solver treats like any other', () => {
    const roster = [pal('Relaxaurus Lux', 'Male', [ARTISAN]), pal('Jormuntide Ignis', 'Female', [SERIOUS])];
    const spec: TargetSpec = {
      speciesIndex: findSpecies('Anubis'),
      requiredPassives: [ARTISAN, SERIOUS],
      excludedPassives: [],
      minIvs: { hp: null, attack: null, defense: null },
      gender: null,
      maxGenerations: 5,
      mode: 'balanced',
      beamSize: 1200,
      allowExcludedParents: false,
    };

    const result = solve(roster.map(manualPal), spec);
    expect(result.feasibility).toBe('breedable');
    expect(speciesName(result.plan!.speciesIndex)).toBe('Anubis');
    expect(result.plan!.generation).toBe(1);
  });

  it('keeps the gender rule that stops two males being paired', () => {
    const roster = [pal('Relaxaurus Lux', 'Male', [ARTISAN]), pal('Jormuntide Ignis', 'Male', [SERIOUS])];
    const spec: TargetSpec = {
      speciesIndex: findSpecies('Anubis'),
      requiredPassives: [ARTISAN, SERIOUS],
      excludedPassives: [],
      minIvs: { hp: null, attack: null, defense: null },
      gender: null,
      maxGenerations: 1,
      mode: 'balanced',
      beamSize: 1200,
      allowExcludedParents: false,
    };
    expect(solve(roster.map(manualPal), spec).plan).toBeNull();
  });
});

describe('manual tree evaluation', () => {
  const required = [ARTISAN, SERIOUS];

  it('scores a valid one-step tree and produces renderable steps', () => {
    const tree = pairTree(
      'Anubis',
      pal('Relaxaurus Lux', 'Male', [ARTISAN]),
      pal('Jormuntide Ignis', 'Female', [SERIOUS]),
    );
    const plan = evaluateManualTree(tree, { requiredPassives: required });

    expect(plan.complete).toBe(true);
    expect(plan.valid).toBe(true);
    expect(plan.problems).toEqual([]);
    expect(plan.openSlots).toBe(0);
    expect(plan.generations).toBe(1);
    expect(plan.totalEggs).toBeGreaterThan(0);
    expect(plan.missingPassives).toEqual([]);
    expect(plan.usedPals).toHaveLength(2);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.isFinal).toBe(true);
    expect(speciesName(plan.steps[0]!.speciesIndex)).toBe('Anubis');
  });

  it('agrees with the automatic solver on the cost of the same pairing', () => {
    const a = pal('Relaxaurus Lux', 'Male', [ARTISAN]);
    const b = pal('Jormuntide Ignis', 'Female', [SERIOUS]);
    const manual = evaluateManualTree(pairTree('Anubis', a, b), { requiredPassives: required });
    const solved = solve([a, b].map(manualPal), {
      speciesIndex: findSpecies('Anubis'),
      requiredPassives: required,
      excludedPassives: [],
      minIvs: { hp: null, attack: null, defense: null },
      gender: null,
      maxGenerations: 1,
      mode: 'balanced',
      beamSize: 1200,
      allowExcludedParents: false,
    });

    expect(solved.plan).not.toBeNull();
    expect(manual.totalEggs).toBeCloseTo(solved.plan!.totalEggs, 9);
    expect(manual.root.expectedUnwanted).toBeCloseTo(solved.plan!.expectedUnwanted, 9);
  });

  it('catches a pairing that does not produce the species the slot claims', () => {
    const tree = pairTree('Penking', pal('Lamball', 'Male'), pal('Cattiva', 'Female'));
    const plan = evaluateManualTree(tree, { requiredPassives: [] });

    expect(plan.valid).toBe(false);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]!.message).toContain('not Penking');
    expect(plan.root.producedSpecies).toBe(breedingResult(findSpecies('Lamball'), findSpecies('Cattiva')));
    expect(plan.steps).toEqual([]);
  });

  it('catches two parents of the same gender, and the same Pal used twice', () => {
    const sameGender = evaluateManualTree(
      pairTree('Anubis', pal('Relaxaurus Lux', 'Male'), pal('Jormuntide Ignis', 'Male')),
      { requiredPassives: [] },
    );
    expect(sameGender.valid).toBe(false);
    expect(sameGender.problems.some((p) => p.message.includes('same gender'))).toBe(true);

    const twin = pal('Anubis', 'Male');
    const selfPair = evaluateManualTree(pairTree('Anubis', twin, twin), { requiredPassives: [] });
    expect(selfPair.valid).toBe(false);
    expect(selfPair.problems.some((p) => p.message.includes('same Pal'))).toBe(true);
  });

  it('counts open slots and refuses to call an unfinished tree complete', () => {
    const tree: ManualNode = {
      id: 'root',
      speciesIndex: findSpecies('Anubis'),
      have: null,
      parents: [
        { id: 'a', speciesIndex: findSpecies('Relaxaurus Lux'), have: pal('Relaxaurus Lux', 'Male', [ARTISAN]), parents: null },
        newManualNode('b', findSpecies('Jormuntide Ignis')),
      ],
    };
    const plan = evaluateManualTree(tree, { requiredPassives: required });

    expect(plan.complete).toBe(false);
    expect(plan.openSlots).toBe(1);
    expect(plan.steps).toEqual([]);
    // The numbers above an open slot are provisional and must say so.
    expect(plan.root.speculative).toBe(true);
    expect(plan.root.parents![1]!.status).toBe('open');
  });

  it('evaluates deep hand-built trees beyond the old UI lookup cap', () => {
    let tree = newManualNode('leaf-20', findSpecies('Lamball'));
    for (let i = 19; i >= 0; i--) {
      tree = {
        id: `deep-${i}`,
        speciesIndex: findSpecies('Lamball'),
        have: null,
        parents: [tree, newManualNode(`side-${i}`, findSpecies('Cattiva'))],
      };
    }

    const plan = evaluateManualTree(tree, { requiredPassives: [] });

    expect(plan.generations).toBe(20);
    expect(plan.problems.every((problem) => !problem.message.includes('nested more than'))).toBe(true);
  });

  it('reports required passives that nothing in the tree carries', () => {
    const tree = pairTree(
      'Anubis',
      pal('Relaxaurus Lux', 'Male', [ARTISAN]),
      pal('Jormuntide Ignis', 'Female', []),
    );
    const plan = evaluateManualTree(tree, { requiredPassives: [ARTISAN, SERIOUS, LUCKY] });

    expect(plan.complete).toBe(true);
    // Structurally fine -- it breeds -- but it cannot deliver the whole spec.
    expect(plan.valid).toBe(true);
    expect(plan.missingPassives).toEqual([SERIOUS, LUCKY]);
  });

  it('flags a Pal filed under the wrong species slot', () => {
    const tree: ManualNode = {
      id: 'root',
      speciesIndex: findSpecies('Anubis'),
      have: null,
      parents: [
        { id: 'a', speciesIndex: findSpecies('Relaxaurus Lux'), have: pal('Lamball', 'Male'), parents: null },
        { id: 'b', speciesIndex: findSpecies('Jormuntide Ignis'), have: pal('Jormuntide Ignis', 'Female'), parents: null },
      ],
    };
    const plan = evaluateManualTree(tree, { requiredPassives: [] });
    expect(plan.valid).toBe(false);
    expect(plan.problems.some((p) => p.message.includes('but the Pal chosen is a Lamball'))).toBe(true);
  });

  it('checks the root against the target when one is given', () => {
    const tree = pairTree(
      'Anubis',
      pal('Relaxaurus Lux', 'Male', [ARTISAN]),
      pal('Jormuntide Ignis', 'Female', [SERIOUS]),
    );
    const plan = evaluateManualTree(tree, {
      requiredPassives: required,
      targetSpecies: findSpecies('Penking'),
    });
    expect(plan.valid).toBe(false);
    expect(plan.problems.some((p) => p.message.includes('but the target is Penking'))).toBe(true);
  });

  it('handles a two-generation tree, ordering steps parents-first', () => {
    const target = findSpecies('Anubis');
    const [pa, pb] = parentPairsFor(target)[0]!;
    const [ga, gb] = parentPairsFor(pa)[0]!;

    const tree: ManualNode = {
      id: 'root',
      speciesIndex: target,
      have: null,
      parents: [
        {
          id: 'left',
          speciesIndex: pa,
          have: null,
          parents: [
            { id: 'g1', speciesIndex: ga, have: pal(SPECIES[ga]!.name, 'Male', [ARTISAN]), parents: null },
            { id: 'g2', speciesIndex: gb, have: pal(SPECIES[gb]!.name, 'Female', [SERIOUS]), parents: null },
          ],
        },
        { id: 'right', speciesIndex: pb, have: pal(SPECIES[pb]!.name, 'Female'), parents: null },
      ],
    };

    const plan = evaluateManualTree(tree, { requiredPassives: required });
    expect(plan.valid).toBe(true);
    expect(plan.generations).toBe(2);
    expect(plan.steps).toHaveLength(2);
    // The inner pairing has to be bred before the one that consumes it.
    expect(plan.steps[0]!.speciesIndex).toBe(pa);
    expect(plan.steps[1]!.isFinal).toBe(true);
    expect(plan.steps[1]!.parents.some((p) => p.kind === 'step' && p.step === 1)).toBe(true);
  });

  it('updates a node by id without mutating the original tree', () => {
    const tree = pairTree(
      'Anubis',
      pal('Relaxaurus Lux', 'Male', [ARTISAN]),
      pal('Jormuntide Ignis', 'Female', [SERIOUS]),
    );
    const next = updateManualNode(tree, 'b', (node) => ({ ...node, have: null }));

    expect(next).not.toBe(tree);
    expect(tree.parents![1]!.have).not.toBeNull();
    expect(next.parents![1]!.have).toBeNull();
    // Untouched branches are shared rather than rebuilt.
    expect(next.parents![0]).toBe(tree.parents![0]);
  });
});

describe('roster import/export', () => {
  let ids = 0;
  const options = { makeId: () => `imported-${++ids}` };

  it('round-trips a roster through the file format', () => {
    const roster = [
      pal('Anubis', 'Male', [ARTISAN, SERIOUS]),
      pal('Lamball', 'Female', []),
      { ...pal('Penking', 'Unknown', [LUCKY]), nickname: 'Waddles' },
    ];

    const restored = parseRosterFile(serializeRoster(roster), options).pals;

    expect(restored).toHaveLength(3);
    restored.forEach((got, i) => {
      const want = roster[i]!;
      expect(got.speciesIndex).toBe(want.speciesIndex);
      expect(got.gender).toBe(want.gender);
      expect(got.passives).toEqual(want.passives);
      expect(got.ivs).toEqual(want.ivs);
      expect(got.nickname).toBe(want.nickname);
    });
  });

  it('carries a readable label that import ignores', () => {
    const file = JSON.parse(serializeRoster([pal('Anubis', 'Male', [ARTISAN])]));
    expect(file.pals[0].label).toContain('Anubis');
    expect(file.pals[0].label).toContain('Artisan');

    // A label that disagrees with the internal names must not win.
    const tampered = JSON.stringify([
      { species: 'Anubis', label: 'Lamball — Legend', gender: 'Male', passives: [ARTISAN] },
    ]);
    const { pals } = parseRosterFile(tampered, options);
    expect(pals[0]!.speciesIndex).toBe(findSpecies('Anubis'));
    expect(pals[0]!.passives).toEqual([ARTISAN]);
  });

  it('writes species by internal name, not by dataset index', () => {
    // Indices shift whenever a patch adds a Pal; a file keyed by them would decode to the
    // wrong species after an update, which is exactly what this format must not do.
    const file = JSON.parse(serializeRoster([pal('Anubis', 'Male', [ARTISAN])]));
    expect(file.pals[0].species).toBe(SPECIES[findSpecies('Anubis')]!.internalName);
    expect(JSON.stringify(file)).not.toContain('speciesIndex');
  });

  it('gives imported Pals fresh ids so they never collide with the current roster', () => {
    const roster = [pal('Anubis', 'Male', []), pal('Lamball', 'Female', [])];
    const restored = parseRosterFile(serializeRoster(roster), options).pals;
    const allIds = [...roster, ...restored].map((p) => p.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('accepts a bare array, and display names in place of internal ones', () => {
    const text = JSON.stringify([
      { species: 'Anubis', gender: 'Male', passives: ['Artisan'], ivs: { hp: 90, attack: 80, defense: 70 } },
    ]);
    const { pals, warnings } = parseRosterFile(text, options);
    expect(warnings).toEqual([]);
    expect(pals).toHaveLength(1);
    expect(pals[0]!.speciesIndex).toBe(findSpecies('Anubis'));
    expect(pals[0]!.passives).toEqual([ARTISAN]);
    expect(pals[0]!.ivs).toEqual({ hp: 90, attack: 80, defense: 70 });
  });

  it('reports what it could not read instead of dropping it silently', () => {
    const text = JSON.stringify({
      format: 'palforge-roster',
      version: 1,
      pals: [
        { species: 'NotAPal', gender: 'Male', passives: [] },
        { species: 'Anubis', gender: 'Female', passives: ['Artisan', 'NotAPassive'] },
      ],
    });
    const { pals, warnings } = parseRosterFile(text, options);

    expect(pals).toHaveLength(1);
    expect(pals[0]!.passives).toEqual([ARTISAN]);
    expect(warnings.some((w) => w.includes('NotAPal'))).toBe(true);
    expect(warnings.some((w) => w.includes('NotAPassive'))).toBe(true);
  });

  it('defaults missing fields rather than failing the whole import', () => {
    const { pals, warnings } = parseRosterFile(JSON.stringify([{ species: 'Anubis' }]), options);
    expect(warnings).toEqual([]);
    expect(pals[0]!.gender).toBe('Unknown');
    expect(pals[0]!.passives).toEqual([]);
    expect(pals[0]!.ivs).toEqual({ hp: 50, attack: 50, defense: 50 });
  });

  it('refuses files that are not rosters, or are from a newer format', () => {
    expect(() => parseRosterFile('not json', options)).toThrow(/valid JSON/);
    expect(() => parseRosterFile(JSON.stringify({ format: 'something-else' }), options)).toThrow(
      /not a PalForge roster/,
    );
    expect(() =>
      parseRosterFile(JSON.stringify({ format: 'palforge-roster', version: 99, pals: [] }), options),
    ).toThrow(/newer version/);
  });

  it('clamps out-of-range IVs and trims an over-long passive list', () => {
    const text = JSON.stringify([
      {
        species: 'Anubis',
        ivs: { hp: 500, attack: -20, defense: 'nope' },
        passives: ['Artisan', 'Serious', 'Lucky', 'Swift', 'Runner'],
      },
    ]);
    const { pals, warnings } = parseRosterFile(text, options);
    expect(pals[0]!.ivs).toEqual({ hp: 100, attack: 0, defense: 50 });
    expect(pals[0]!.passives).toHaveLength(4);
    expect(warnings.some((w) => w.includes('more than four'))).toBe(true);
  });
});
