import { describe, expect, it } from 'vitest';
import {
  findPassive,
  findSpecies,
  SPECIES,
  passiveColorTier,
  speciesIconUrl,
  speciesName,
} from '../src/core/data/index.js';
import { renderPlanMermaid, renderPlanMermaidModel } from '../src/core/solver/diagram.js';
import { breedingResult, parentPairsFor } from '../src/core/data/breeding.js';
import {
  expectedProductionCycles,
  ivRollModelForCake,
  parseCakeVariant,
} from '../src/core/solver/cakes.js';
import { solve } from '../src/core/solver/search.js';
import { flattenPlan, type PlanStep } from '../src/core/solver/steps.js';
import {
  childIvDistribution,
  expectedUnwantedPassives,
  ivProbability,
  ivSuccessProbability,
  knownIvDistribution,
  passiveInheritanceProbability,
  requiredIvMask,
} from '../src/core/solver/probability.js';
import {
  expectedMutationCount,
  hatchesForMutationConfidence,
  mutationChanceAfterHatches,
  mutationChancePerHatch,
  mutationParentsForChild,
  mutationResultChanceForChild,
  mutationResultsForPair,
} from '../src/core/solver/mutations.js';
import type { PlanNode, TargetSpec } from '../src/core/solver/types.js';
import type { Gender, Pal } from '../src/core/save/types.js';

let counter = 0;
function makePal(
  species: string,
  gender: Gender,
  passives: string[],
  ivs: [number, number, number] = [50, 50, 50],
): Pal {
  const speciesIndex = findSpecies(species);
  if (speciesIndex < 0) throw new Error(`unknown test species ${species}`);
  const internal = passives.map((p) => {
    const found = findPassive(p);
    if (!found) throw new Error(`unknown test passive ${p}`);
    return found.internalName;
  });
  counter++;
  return {
    instanceId: `test-${counter}`,
    speciesIndex,
    characterId: species,
    isBoss: false,
    nickname: '',
    gender,
    level: 20,
    rank: 1,
    souls: { hp: 0, attack: 0, defense: 0, craftSpeed: 0 },
    ivs: { hp: ivs[0], attack: ivs[1], defense: ivs[2] },
    passives: internal,
    masteredSkills: [],
    equippedSkills: [],
    ownerPlayerUid: 'player-1',
    groupId: 'guild-1',
    location: { kind: 'palbox', containerId: 'c1', slotIndex: counter, label: `Palbox slot ${counter}` },
  };
}

function spec(overrides: Partial<TargetSpec> = {}): TargetSpec {
  return {
    speciesIndex: findSpecies('Anubis'),
    requiredPassives: [findPassive('Artisan')!.internalName, findPassive('Serious')!.internalName],
    excludedPassives: [],
    minIvs: { hp: null, attack: null, defense: null },
    gender: null,
    maxGenerations: 5,
    mode: 'balanced',
    beamSize: 1200,
    allowExcludedParents: false,
    ...overrides,
  };
}

function ownedNode(pal: Pal): PlanNode {
  return {
    speciesIndex: pal.speciesIndex,
    mask: 0,
    generation: 0,
    poolSize: pal.passives.length,
    stepEggs: 0,
    passiveSuccess: 1,
    genderFactor: 1,
    genderRequirement: null,
    totalEggs: 0,
    expectedUnwanted: 0,
    source: pal,
    parents: null,
    requiredGender: null,
  };
}

function bredNode(
  species: string,
  parents: [PlanNode, PlanNode],
  overrides: Partial<PlanNode> = {},
): PlanNode {
  return {
    speciesIndex: findSpecies(species),
    mask: 0,
    generation: Math.max(parents[0].generation, parents[1].generation) + 1,
    poolSize: 0,
    stepEggs: 1,
    passiveSuccess: 1,
    genderFactor: 1,
    genderRequirement: null,
    totalEggs: parents[0].totalEggs + parents[1].totalEggs + 1,
    expectedUnwanted: 0,
    source: null,
    parents,
    requiredGender: null,
    ...overrides,
  };
}

describe('probability model', () => {
  it('recognises cake aliases and the exact Vegetable Cake production multiplier', () => {
    expect(parseCakeVariant('vegetable')).toBe('vegetable');
    expect(parseCakeVariant('deluxe')).toBe('extravagant-vegetable');
    expect(parseCakeVariant('Extravagant Vegetable Cake')).toBe('extravagant-vegetable');
    expect(expectedProductionCycles(7, 'vegetable')).toBe(3.5);
    expect(expectedProductionCycles(7, 'mushroom')).toBe(7);
  });

  it('computes hypergeometric passive inheritance from the datamined weights', () => {
    // Pool of exactly the two wanted passives: any draw of 2+ takes both.
    expect(passiveInheritanceProbability(2, 2)).toBeCloseTo(0.6, 6);
    // Two junk passives dilute the pool sharply.
    expect(passiveInheritanceProbability(4, 2)).toBeCloseTo(0.25, 6);
    // Nothing wanted is always satisfied; wanting more than exists never is.
    expect(passiveInheritanceProbability(3, 0)).toBe(1);
    expect(passiveInheritanceProbability(2, 3)).toBe(0);
  });

  it('penalises dirty parent pools', () => {
    expect(passiveInheritanceProbability(2, 1)).toBeGreaterThan(passiveInheritanceProbability(6, 1));
  });

  it('never predicts more junk passives than the Pal has room for', () => {
    expect(expectedUnwantedPassives(8, 4)).toBe(0);
    expect(expectedUnwantedPassives(8, 1)).toBeLessThanOrEqual(3);
  });

  it('represents a known Pal as one deterministic IV threshold mask', () => {
    const thresholds = [90, 90, 90];
    const distribution = knownIvDistribution([95, 70, 100], thresholds);
    expect(requiredIvMask(thresholds)).toBe(0b111);
    expect(distribution[0b101]).toBe(1);
    expect(distribution.reduce((sum, probability) => sum + probability, 0)).toBe(1);
  });

  it('matches the direct final-step IV calculation', () => {
    const thresholds = [90, 90, 90];
    const parentA = [100, 95, 20];
    const parentB = [80, 100, 99];
    const child = childIvDistribution(
      knownIvDistribution(parentA, thresholds),
      knownIvDistribution(parentB, thresholds),
      thresholds,
    );
    expect(ivSuccessProbability(child, thresholds)).toBeCloseTo(
      ivProbability(parentA, parentB, thresholds),
      12,
    );
    expect(child.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12);
  });

  it('applies IV-focused cake bonuses to fresh IV rolls', () => {
    const thresholds = [90, 90, 90];
    const parentA = [100, 10, 10];
    const parentB = [100, 20, 20];
    const standard = ivProbability(parentA, parentB, thresholds, ivRollModelForCake('standard'));
    const mushroom = ivProbability(parentA, parentB, thresholds, ivRollModelForCake('mushroom'));
    const extravagant = ivProbability(
      parentA,
      parentB,
      thresholds,
      ivRollModelForCake('extravagant-vegetable'),
    );

    expect(mushroom).toBeGreaterThan(standard);
    expect(extravagant).toBeGreaterThan(standard);
    expect(mushroom).toBeCloseTo(extravagant, 12);
  });

  it('calculates breeding mutation odds from per-hatch chances', () => {
    expect(mutationChancePerHatch('standard')).toBe(0.01);
    expect(mutationChancePerHatch('vegetable')).toBe(0.01);
    expect(mutationChancePerHatch('extravagant-vegetable')).toBe(0.03);
    expect(mutationChanceAfterHatches(100, 0.01)).toBeCloseTo(1 - 0.99 ** 100, 12);
    expect(expectedMutationCount(100, 0.03)).toBeCloseTo(3, 12);
    expect(hatchesForMutationConfidence(0.01, 0.5)).toBe(69);
    expect(hatchesForMutationConfidence(0.03, 0.5)).toBe(23);
  });

  it('models possible mutated children and reverse mutation parents', () => {
    const rayhound = findSpecies('Rayhound');
    const foxcicle = findSpecies('Foxcicle');
    const majex = findSpecies('Majex');
    const solmoraLux = findSpecies('Solmora Lux');

    const results = mutationResultsForPair(rayhound, foxcicle);
    expect(results.map((result) => result.speciesIndex)).toContain(majex);
    expect(results.map((result) => result.speciesIndex)).toContain(solmoraLux);
    expect(results.every((result) => result.relativeChance > 0)).toBe(true);
    expect(results.every((result) => SPECIES[result.speciesIndex].breedingPower < SPECIES[rayhound].breedingPower)).toBe(true);

    const majexParents = mutationParentsForChild(majex);
    expect(majexParents.selfPairs.length).toBeGreaterThan(0);
    expect(majexParents.totalPairs).toBeGreaterThan(majexParents.selfPairs.length);
    expect(majexParents.partnersOf(rayhound)).toContain(foxcicle);
    expect(mutationResultChanceForChild(rayhound, foxcicle, majex)).toBeGreaterThan(0);
  });

  it('excludes Palpedia ignore-combi species from mutation result pools', () => {
    const broncherry = findSpecies('Broncherry');
    const blazamut = findSpecies('Blazamut');
    const bellanoir = findSpecies('Bellanoir');
    const warsectTerra = findSpecies('Warsect Terra');
    const wumpoBotan = findSpecies('Wumpo Botan');
    const reptyroCryst = findSpecies('Reptyro Cryst');
    const jormuntide = findSpecies('Jormuntide');

    const results = mutationResultsForPair(broncherry, blazamut);
    expect(results.map((result) => result.speciesIndex)).not.toContain(bellanoir);
    expect(results.map((result) => result.speciesIndex)).toEqual([
      warsectTerra,
      wumpoBotan,
      reptyroCryst,
      jormuntide,
    ]);
    expect(mutationResultChanceForChild(broncherry, blazamut, warsectTerra)).toBeCloseTo(15 / 41 * 100, 12);
    expect(mutationResultChanceForChild(broncherry, blazamut, wumpoBotan)).toBeCloseTo(15 / 41 * 100, 12);
    expect(mutationResultChanceForChild(broncherry, blazamut, reptyroCryst)).toBeCloseTo(10 / 41 * 100, 12);
    expect(mutationResultChanceForChild(broncherry, blazamut, jormuntide)).toBeCloseTo(1 / 41 * 100, 12);
  });

  it('carries IV threshold odds through bred parents', () => {
    const thresholds = [90, 90, 90];
    const firstGeneration = childIvDistribution(
      knownIvDistribution([100, 100, 10], thresholds),
      knownIvDistribution([10, 100, 100], thresholds),
      thresholds,
    );
    const finalGeneration = childIvDistribution(
      firstGeneration,
      knownIvDistribution([100, 10, 100], thresholds),
      thresholds,
    );
    const probability = ivSuccessProbability(finalGeneration, thresholds);
    expect(probability).toBeGreaterThan(0);
    expect(probability).toBeLessThan(1);
    expect(finalGeneration.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });
});

describe('solver', () => {
  it('detects a Pal you already own that meets the target', () => {
    const pals = [makePal('Anubis', 'Male', ['Artisan', 'Serious'])];
    const result = solve(pals, spec());
    expect(result.feasibility).toBe('already-owned');
    expect(result.existingMatches).toHaveLength(1);
  });

  it('does not count an owned Pal that is missing a required passive', () => {
    const pals = [makePal('Anubis', 'Male', ['Artisan'])];
    const result = solve(pals, spec());
    expect(result.feasibility).not.toBe('already-owned');
  });

  it('finds a single-step route from two owned parents', () => {
    // Relaxaurus Lux x Jormuntide Ignis is a real pairing that yields Anubis.
    const pals = [
      makePal('Relaxaurus Lux', 'Male', ['Artisan']),
      makePal('Jormuntide Ignis', 'Female', ['Serious']),
    ];
    const result = solve(pals, spec());
    expect(result.feasibility).toBe('breedable');
    expect(result.plan).not.toBeNull();
    expect(speciesName(result.plan!.speciesIndex)).toBe('Anubis');
    expect(result.plan!.generation).toBe(1);
    expect(result.plan!.parents).not.toBeNull();
    expect(result.plan!.totalEggs).toBeGreaterThan(0);
  });

  it('renders a clean Mermaid diagram from a solved plan', () => {
    const target = spec();
    const pals = [
      makePal('Relaxaurus Lux', 'Male', ['Artisan']),
      makePal('Jormuntide Ignis', 'Female', ['Serious']),
    ];
    pals[0]!.nickname = '<Sparky "One">';

    const result = solve(pals, target);
    const rendered = renderPlanMermaidModel(flattenPlan(result.plan!), target);
    const diagram = rendered.source;

    expect(diagram).toContain('flowchart TD');
    expect(diagram).toContain('classDef final');
    expect(rendered.icons.some((icon) => icon.url.endsWith('/relaxaurus-lux.webp'))).toBe(true);
    expect(diagram).not.toContain('@{ img:');
    expect(diagram).toContain('class pal_0 owned;');
    expect(diagram).toContain('class step_1 final;');
    expect(diagram).toContain('Relaxaurus Lux');
    expect(diagram).toContain('&lt;Sparky &quot;One&quot;&gt;');
    expect(diagram).toContain('Jormuntide Ignis');
    expect(diagram).toContain('Step 1 final');
    expect(diagram).not.toContain('has Artisan');
    expect(diagram).not.toContain('expected Artisan + Serious');
    expect(diagram).not.toContain('no passive target');
    expect(diagram).toContain('-->');

    const childIcon = rendered.icons.find((icon) => icon.nodeId === 'step_1');
    expect(childIcon?.passives.map((passive) => passive.label)).toEqual(['Artisan', 'Serious']);
    expect(childIcon?.passives.map((passive) => passive.tier)).toEqual(['yellow', 'white']);
  });

  it('does not reuse owned Pal nodes across diagram layers', () => {
    const target = spec();
    const repeatedParent = makePal('Relaxaurus Lux', 'Male', ['Artisan']);
    const firstMate = makePal('Jormuntide Ignis', 'Female', ['Serious']);
    const steps: PlanStep[] = [
      {
        index: 1,
        speciesIndex: findSpecies('Palumba'),
        mask: 1,
        parents: [
          { kind: 'owned', pal: repeatedParent },
          { kind: 'owned', pal: firstMate },
        ],
        expectedEggs: 1,
        passiveSuccess: 1,
        genderFactor: 1,
        genderRequirement: null,
        expectedUnwanted: 0,
        isFinal: false,
      },
      {
        index: 2,
        speciesIndex: findSpecies('Anubis'),
        mask: 3,
        parents: [
          { kind: 'owned', pal: repeatedParent },
          { kind: 'step', step: 1, speciesIndex: findSpecies('Palumba'), mask: 1 },
        ],
        expectedEggs: 2,
        passiveSuccess: 1,
        genderFactor: 1,
        genderRequirement: null,
        expectedUnwanted: 0,
        isFinal: true,
      },
    ];

    const rendered = renderPlanMermaidModel(steps, target);
    const diagram = rendered.source;
    const repeatedParentIcons = rendered.icons.filter((icon) =>
      icon.url.endsWith('/relaxaurus-lux.webp'),
    );

    expect(repeatedParentIcons).toHaveLength(2);
    expect(diagram).not.toContain('@{ img:');
    expect(diagram).toContain('pal_0 --> step_1');
    expect(diagram).toContain('pal_2 --> step_2');
    expect(diagram).not.toContain('pal_0 --> step_2');
  });

  it('includes cake-adjusted production cycles in Mermaid labels', () => {
    const target = spec({ cake: 'vegetable' });
    const steps: PlanStep[] = [
      {
        index: 1,
        speciesIndex: findSpecies('Anubis'),
        mask: 3,
        parents: [
          { kind: 'owned', pal: makePal('Relaxaurus Lux', 'Male', ['Artisan']) },
          { kind: 'owned', pal: makePal('Jormuntide Ignis', 'Female', ['Serious']) },
        ],
        expectedEggs: 4,
        passiveSuccess: 0.25,
        genderFactor: 1,
        genderRequirement: null,
        expectedUnwanted: 0,
        isFinal: true,
      },
    ];

    const diagram = renderPlanMermaidModel(steps, target).source;
    expect(diagram).toContain('~4.0 hatches');
    expect(diagram).toContain('~2.0 cake cycles');
  });

  it('collapses repeated bred subtrees into a made-earlier Pal reference', () => {
    const firstSootseer = bredNode('Sootseer', [
      ownedNode(makePal('Mammorest', 'Male', [])),
      ownedNode(makePal('Wumpo Botan', 'Female', [])),
    ]);
    const firstDualith = bredNode('Dualith', [
      ownedNode(makePal('Wumpo Botan', 'Male', [])),
      ownedNode(makePal('Blazamut', 'Female', [])),
    ]);
    const firstDualithNoct = bredNode('Dualith Noct', [firstSootseer, firstDualith]);
    const secondSootseer = bredNode('Sootseer', [
      ownedNode(makePal('Mammorest', 'Male', [])),
      ownedNode(makePal('Wumpo Botan', 'Female', [])),
    ]);
    const secondDualith = bredNode('Dualith', [
      ownedNode(makePal('Wumpo Botan', 'Male', [])),
      ownedNode(makePal('Blazamut', 'Female', [])),
    ]);
    const secondDualithNoct = bredNode('Dualith Noct', [secondSootseer, secondDualith]);
    const eidrolon = bredNode('Eidrolon', [
      ownedNode(makePal('Blazamut', 'Male', [])),
      secondDualithNoct,
    ]);
    const root = bredNode('Solenne', [firstDualithNoct, eidrolon]);

    const steps = flattenPlan(root);
    const diagram = renderPlanMermaidModel(
      steps,
      spec({ speciesIndex: findSpecies('Solenne'), requiredPassives: [] }),
    ).source;

    expect(steps.map((step) => `${step.index}:${speciesName(step.speciesIndex)}`)).toEqual([
      '1:Sootseer',
      '2:Dualith',
      '3:Dualith Noct',
      '4:Eidrolon',
      '5:Solenne',
    ]);
    expect(steps[3]!.parents[1]).toEqual({
      kind: 'bred',
      step: 3,
      speciesIndex: findSpecies('Dualith Noct'),
      mask: 0,
    });
    expect(diagram).toContain('made_0["Dualith Noct - Created in step 3"]');
    expect(diagram).toContain('made_0 --> step_4');
    expect(diagram).toContain('step_3 --> step_5');
    expect(diagram).not.toContain('Step 6');
  });

  it('does not collapse bred nodes with different passive targets', () => {
    const firstWumpoBotan = bredNode('Wumpo Botan', [
      ownedNode(makePal('Wumpo', 'Male', [])),
      ownedNode(makePal('Blazamut', 'Female', [])),
    ]);
    const secondWumpoBotan = bredNode(
      'Wumpo Botan',
      [ownedNode(makePal('Wumpo', 'Male', [])), ownedNode(makePal('Blazamut', 'Female', []))],
      { mask: 1 },
    );
    const root = bredNode('Flaracle', [firstWumpoBotan, secondWumpoBotan]);

    const steps = flattenPlan(root);

    expect(steps.map((step) => `${step.index}:${speciesName(step.speciesIndex)}`)).toEqual([
      '1:Wumpo Botan',
      '2:Wumpo Botan',
      '3:Flaracle',
    ]);
    expect(steps[2]!.parents.map((parent) => parent.kind)).toEqual(['step', 'step']);
  });

  it('uses PalMods icon urls for displayable Pals', () => {
    expect(speciesIconUrl(findSpecies('Fuack Ignis'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/fuack-ignis.webp',
    );
    expect(speciesIconUrl(findSpecies('Palumba'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/palumba.webp',
    );
    expect(speciesIconUrl(findSpecies('Sootseer'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/sootseer.webp',
    );
    expect(speciesIconUrl(findSpecies('Dualith'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/dualith.webp',
    );
    expect(speciesIconUrl(findSpecies('Dualith Noct'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/dualith-noct.webp',
    );
    expect(speciesIconUrl(findSpecies('Eidrolon'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/eidrolon.webp',
    );
    expect(speciesIconUrl(findSpecies('Flaracle'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/flaracle.webp',
    );
    expect(speciesIconUrl(findSpecies('Gumoss (Special)'))).toBe(
      'https://assets.palmods.gg/v1.0.0/pals/icons/gumoss-special.webp',
    );
  });

  it('maps passive ranks to the displayed color tiers', () => {
    expect(passiveColorTier(findPassive('Legend')!.internalName)).toBe('diamond');
    expect(passiveColorTier(findPassive('Artisan')!.internalName)).toBe('yellow');
    expect(passiveColorTier(findPassive('Serious')!.internalName)).toBe('white');
    expect(passiveColorTier(findPassive('Clumsy')!.internalName)).toBe('red');
  });

  it('refuses to pair two owned Pals of the same gender', () => {
    const pals = [
      makePal('Relaxaurus Lux', 'Male', ['Artisan']),
      makePal('Jormuntide Ignis', 'Male', ['Serious']),
    ];
    const result = solve(pals, spec({ maxGenerations: 1 }));
    expect(result.plan).toBeNull();
  });

  it('reports a species that no owned Pal can ever reach', () => {
    // Jetragon can only be produced by another Jetragon.
    const pals = [makePal('Lamball', 'Male', ['Artisan']), makePal('Cattiva', 'Female', ['Serious'])];
    const result = solve(pals, spec({ speciesIndex: findSpecies('Jetragon') }));
    expect(result.feasibility).toBe('species-unreachable');
    expect(result.plan).toBeNull();
  });

  it('reports which required passives nobody carries', () => {
    const pals = [
      makePal('Relaxaurus Lux', 'Male', ['Artisan']),
      makePal('Jormuntide Ignis', 'Female', ['Serious']),
    ];
    const result = solve(
      pals,
      spec({
        requiredPassives: [
          findPassive('Artisan')!.internalName,
          findPassive('Serious')!.internalName,
          findPassive('Legend')!.internalName,
        ],
      }),
    );
    expect(result.feasibility).toBe('missing-passives');
    expect(result.missingPassives).toEqual([findPassive('Legend')!.internalName]);
    expect(result.plan).toBeNull();
  });

  it('excludes Pals carrying a ruled-out passive, and honours the override', () => {
    const pals = [
      makePal('Relaxaurus Lux', 'Male', ['Artisan', 'Clumsy']),
      makePal('Jormuntide Ignis', 'Female', ['Serious']),
    ];
    const withExclusion = solve(pals, spec({ excludedPassives: [findPassive('Clumsy')!.internalName] }));
    expect(withExclusion.plan).toBeNull();

    const allowing = solve(
      pals,
      spec({ excludedPassives: [findPassive('Clumsy')!.internalName], allowExcludedParents: true }),
    );
    expect(allowing.plan).not.toBeNull();
  });

  it('prefers the cleaner parent when one carries junk passives', () => {
    const clean = solve(
      [makePal('Relaxaurus Lux', 'Male', ['Artisan']), makePal('Jormuntide Ignis', 'Female', ['Serious'])],
      spec(),
    );
    const dirty = solve(
      [
        makePal('Relaxaurus Lux', 'Male', ['Artisan', 'Clumsy', 'Brittle', 'Slacker']),
        makePal('Jormuntide Ignis', 'Female', ['Serious']),
      ],
      spec({ allowExcludedParents: true }),
    );
    expect(clean.plan!.totalEggs).toBeLessThan(dirty.plan!.totalEggs);
  });

  it('builds a multi-step tree when no direct pairing exists', () => {
    const pals = [
      makePal('Lamball', 'Male', ['Artisan']),
      makePal('Cattiva', 'Female', ['Serious']),
      makePal('Chikipi', 'Female', []),
      makePal('Penking', 'Male', []),
    ];
    const result = solve(pals, spec({ maxGenerations: 6 }));
    if (result.plan) {
      expect(result.plan.generation).toBeGreaterThanOrEqual(1);
      expect(speciesName(result.plan.speciesIndex)).toBe('Anubis');
    } else {
      // Acceptable outcome, but it must be explained rather than silently empty.
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('reports IV odds when the final parent is itself bred', () => {
    const intermediate = findSpecies('Relaxaurus Lux');
    const finalMate = findSpecies('Jormuntide Ignis');
    const target = findSpecies('Anubis');
    const firstPair = parentPairsFor(intermediate).find(
      ([a, b]) =>
        a !== intermediate &&
        b !== intermediate &&
        a !== finalMate &&
        b !== finalMate &&
        a !== b &&
        breedingResult(a, finalMate) !== target &&
        breedingResult(b, finalMate) !== target,
    );
    expect(firstPair).toBeDefined();
    const [firstA, firstB] = firstPair!;
    const pals = [
      makePal(speciesName(firstA), 'Unknown', [], [100, 100, 20]),
      makePal(speciesName(firstB), 'Unknown', [], [20, 100, 100]),
      makePal(speciesName(finalMate), 'Unknown', [], [100, 20, 100]),
    ];
    const result = solve(
      pals,
      spec({
        requiredPassives: [],
        minIvs: { hp: 90, attack: 90, defense: 90 },
        maxGenerations: 6,
      }),
    );
    expect(result.plan).not.toBeNull();
    expect(result.plan!.generation).toBeGreaterThan(1);
    expect(result.finalIvProbability).not.toBeNull();
    expect(result.finalIvProbability!).toBeGreaterThan(0);
    expect(result.diagnostics.join(' ')).not.toContain('No final IV odds');
    const steps = flattenPlan(result.plan!);
    expect(steps.every((step) => step.ivSuccess != null && step.ivSuccess > 0)).toBe(true);
    expect(
      steps.every(
        (step) =>
          step.expectedEggs >=
          1 / (step.passiveSuccess * step.genderFactor * (step.ivSuccess ?? 1)),
      ),
    ).toBe(true);
  });

  it('retains the more IV-viable Pal for the same species and passive state', () => {
    const low = makePal('Relaxaurus Lux', 'Male', [], [10, 10, 10]);
    const high = makePal('Relaxaurus Lux', 'Male', [], [100, 100, 100]);
    const mate = makePal('Jormuntide Ignis', 'Female', [], [100, 100, 100]);
    const result = solve(
      [low, high, mate],
      spec({ requiredPassives: [], minIvs: { hp: 90, attack: 90, defense: 90 } }),
    );
    expect(result.plan).not.toBeNull();
    const ownedIds = flattenPlan(result.plan!)
      .flatMap((step) => step.parents)
      .flatMap((parent) => (parent.kind === 'owned' ? [parent.pal.instanceId] : []));
    expect(ownedIds).toContain(high.instanceId);
    expect(ownedIds).not.toContain(low.instanceId);
    expect(result.finalIvProbability).toBeGreaterThan(0);
  });

  it('uses IV cake bonuses when estimating solver hatch counts', () => {
    const pals = [
      makePal('Relaxaurus Lux', 'Male', [], [100, 10, 10]),
      makePal('Jormuntide Ignis', 'Female', [], [100, 20, 20]),
    ];
    const target = {
      requiredPassives: [],
      minIvs: { hp: 90, attack: 90, defense: 90 },
      maxGenerations: 1,
      mode: 'eggs' as const,
    };

    const standard = solve(pals, spec({ ...target, cake: 'standard' }));
    const mushroom = solve(pals, spec({ ...target, cake: 'mushroom' }));

    expect(standard.plan).not.toBeNull();
    expect(mushroom.plan).not.toBeNull();
    expect(mushroom.finalIvProbability!).toBeGreaterThan(standard.finalIvProbability!);
    expect(mushroom.plan!.stepEggs).toBeLessThan(standard.plan!.stepEggs);
  });

  it('reports no-pals rather than crashing on an empty Palbox', () => {
    const result = solve([], spec());
    expect(result.feasibility).toBe('no-pals');
  });
});
