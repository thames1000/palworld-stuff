/**
 * Smoke test for the web UI.
 *
 * Server-rendering the tree exercises every import and every render path down to the first
 * paint, which is where module-level mistakes (bad alias, missing export, a component that
 * throws on empty state) actually show up. It deliberately does not try to drive the
 * worker: there is no Worker in this environment, and the parse/solve logic it runs is
 * already covered by the parser and solver suites.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from '../web/src/App';
import { Explorer } from '../web/src/components/Explorer';
import { PairPicker } from '../web/src/components/PairPicker';
import { PalTable } from '../web/src/components/PalTable';
import { PlanView } from '../web/src/components/PlanView';
import { PlanBuilder } from '../web/src/components/PlanBuilder';
import { PalDialog } from '../web/src/components/PalDialog';
import { ClearAllDialog, RosterEditor } from '../web/src/components/RosterEditor';
import { ImportDialog } from '../web/src/components/RosterTransfer';
import { findPassive, findSpecies, speciesName } from '../src/core/data/index.js';
import { parentPairsFor } from '../src/core/data/breeding.js';
import { manualPal, type ManualPalSpec } from '../src/core/save/manual.js';
import { newManualNode, type ManualNode } from '../src/core/solver/manual.js';
import type { ManualPlanState } from '../web/src/lib/manualPlan';
import type { TargetSpec } from '../src/core/solver/types.js';
import type { Pal } from '../src/core/save/types.js';

const spec: TargetSpec = {
  speciesIndex: findSpecies('Anubis'),
  requiredPassives: [findPassive('Artisan')!.internalName],
  excludedPassives: [],
  minIvs: { hp: null, attack: null, defense: null },
  gender: null,
  maxGenerations: 5,
  mode: 'balanced',
  beamSize: 1200,
  allowExcludedParents: false,
};

const samplePal: Pal = {
  instanceId: 'a',
  speciesIndex: findSpecies('Penking'),
  characterId: 'CaptainPenguin',
  isBoss: false,
  nickname: 'Waddles',
  gender: 'Male',
  level: 25,
  rank: 1,
  souls: { hp: 0, attack: 0, defense: 0, craftSpeed: 0 },
  ivs: { hp: 94, attack: 81, defense: 97 },
  passives: [findPassive('Artisan')!.internalName],
  masteredSkills: [],
  equippedSkills: [],
  ownerPlayerUid: 'p',
  groupId: 'g',
  location: {
    kind: 'palbox',
    containerId: 'c',
    slotIndex: 12,
    page: 1,
    row: 3,
    column: 1,
    label: 'Palbox page 1, row 3, col 1',
  },
};

const manualSpec: ManualPalSpec = {
  id: 'r1',
  speciesIndex: findSpecies('Relaxaurus Lux'),
  gender: 'Male',
  passives: [findPassive('Artisan')!.internalName],
  ivs: { hp: 70, attack: 60, defense: 50 },
  nickname: 'Sparky',
};

function manualPlanState(overrides: Partial<ManualPlanState> = {}): ManualPlanState {
  return {
    roster: [],
    addPal: () => manualSpec,
    insertPal: () => {},
    insertPals: () => {},
    replaceRoster: () => {},
    updatePal: () => {},
    removePal: () => {},
    duplicatePal: () => {},
    clearRoster: () => {},
    tree: newManualNode('root', findSpecies('Anubis')),
    setTree: () => {},
    resetTree: () => {},
    ...overrides,
  };
}

function explorer(tree: ManualNode, pool: Pal[] = []) {
  return renderToString(
    <Explorer
      tree={tree}
      onTreeChange={() => {}}
      onResetTree={() => {}}
      pool={pool}
      requiredPassives={[findPassive('Artisan')!.internalName]}
      targetSpecies={findSpecies('Anubis')}
      onUseAsTarget={() => {}}
      onInsertToRoster={() => {}}
    />,
  ).replaceAll('<!-- -->', '');
}

describe('web UI', () => {
  it('explains how IV targets currently affect route planning', () => {
    const html = renderToString(
      <PlanBuilder
        spec={spec}
        onChange={() => {}}
        onSolve={() => {}}
        solving={false}
        candidateCount={1}
      />,
    );
    expect(html).toContain('Final IV odds estimate');
    expect(html).toContain('prefer routes likely to reach your thresholds');
    expect(html).toContain('IV rerolls are included in expected hatch totals, including selected cake modifiers');
    expect(html).toContain('Cake variant');
    expect(html).toContain('Mushroom Cake');
    expect(html).toContain('Vegetable Cake');
    expect(html).toContain('Extravagant Vegetable Cake');
    expect(html).toContain('Special Cake');
    const generationControl = html.slice(html.indexOf('Max generations'), html.indexOf('Optimise for'));
    expect(generationControl).toContain('type="number"');
    expect(generationControl).toContain('min="1"');
    expect(generationControl).not.toContain('<select');
  });

  it('shows IV-focused cake uplift in the target readiness panel', () => {
    const html = renderToString(
      <PlanBuilder
        spec={{ ...spec, cake: 'mushroom', minIvs: { hp: 90, attack: 90, defense: 90 } }}
        onChange={() => {}}
        onSolve={() => {}}
        solving={false}
        candidateCount={4}
        readiness={{
          targetOwnedCount: 0,
          coveredRequiredPassives: [findPassive('Artisan')!.internalName],
          missingRequiredPassives: [],
          excludedCarrierCount: 0,
          unknownGenderCount: 0,
        }}
      />,
    ).replaceAll('<!-- -->', '');

    expect(html).toContain('IV uplift');
    expect(html).toContain('+1 to +5 fresh');
    expect(html).toContain('estimated +1 to +5 fresh-IV uplift');
  });

  it('preflights the target against the current Pal pool before solving', () => {
    const html = renderToString(
      <PlanBuilder
        spec={{
          ...spec,
          cake: 'vegetable',
          requiredPassives: [
            findPassive('Artisan')!.internalName,
            findPassive('Legend')!.internalName,
          ],
          excludedPassives: [findPassive('Clumsy')!.internalName],
          minIvs: { hp: 90, attack: null, defense: null },
        }}
        onChange={() => {}}
        onSolve={() => {}}
        solving={false}
        candidateCount={12}
        readiness={{
          targetOwnedCount: 1,
          coveredRequiredPassives: [findPassive('Artisan')!.internalName],
          missingRequiredPassives: [findPassive('Legend')!.internalName],
          excludedCarrierCount: 2,
          unknownGenderCount: 3,
        }}
      />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Readiness');
    expect(html).toContain('Passive missing');
    expect(html).toContain('12');
    expect(html).toContain('1/2 in scope');
    expect(html).toContain('HP ≥ 90');
    expect(html).toContain('Egg production');
    expect(html).toContain('2 eggs/cycle');
    expect(html).toContain('Excluded carriers');
    expect(html).toContain('Unknown gender');
    expect(html).toContain('Legend');
  });

  it('renders the drop zone before a save is loaded', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Drop your Palworld world folder here');
    // The privacy promise is the reason this app is client-side; it must be on screen.
    expect(html).toContain('never leaves this device');
  });

  it('offers a way in that does not need a save at all', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Plan without a save');
  });

  it('renders the Pal table with locations and passives', () => {
    // React's server renderer separates adjacent interpolations with comment markers;
    // strip them so assertions can match the text a user would actually read.
    const html = renderToString(<PalTable pals={[samplePal]} onPickSpecies={() => {}} />).replaceAll(
      '<!-- -->',
      '',
    );
    expect(html).toContain('Penking');
    expect(html).toContain('Waddles');
    expect(html).toContain('Palbox page 1, row 3, col 1');
    expect(html).toContain('Artisan');
    expect(html).toContain('1 of 1 Pals');
  });

  it('color-codes Pal table passives by tier', () => {
    const pal = {
      ...samplePal,
      passives: [
        findPassive('Legend')!.internalName,
        findPassive('Artisan')!.internalName,
        findPassive('Serious')!.internalName,
        findPassive('Clumsy')!.internalName,
      ],
    };
    const html = renderToString(<PalTable pals={[pal]} onPickSpecies={() => {}} />).replaceAll(
      '<!-- -->',
      '',
    );

    expect(html).toContain('data-passive-tier="diamond"');
    expect(html).toContain('data-passive-tier="yellow"');
    expect(html).toContain('data-passive-tier="white"');
    expect(html).toContain('data-passive-tier="red"');
    expect(html).toContain('text-passive-diamond');
    expect(html).toContain('text-passive-yellow');
    expect(html).toContain('text-passive-white');
    expect(html).toContain('text-passive-red');
  });

  it('renders an empty plan panel without a summary', () => {
    const html = renderToString(<PlanView summary={null} spec={spec} />);
    expect(html).toContain('Current target');
    expect(html).toContain('Anubis');
    expect(html).toContain('Artisan');
    expect(html).toContain('Find breeding plan');
  });

  it('warns when the displayed plan no longer matches the edited target', () => {
    const html = renderToString(
      <PlanView
        summary={{
          spec,
          feasibility: 'breedable',
          steps: [],
          generations: null,
          totalEggs: null,
          missingPassives: [],
          existingMatches: [],
          alternatives: [],
          finalGenderProbability: 0.5,
          finalIvProbability: null,
          diagnostics: [],
          searchedNodes: 10,
          elapsedMs: 3,
          candidateCount: 1,
        }}
        spec={{ ...spec, speciesIndex: findSpecies('Penking') }}
      />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Plan is from an earlier target');
    expect(html).toContain('Showing Anubis');
    expect(html).toContain('current target is Penking');
  });

  it('renders the diagram surface for a solved plan', () => {
    const html = renderToString(
      <PlanView
        summary={{
          spec: { ...spec, cake: 'mushroom', minIvs: { hp: 90, attack: 90, defense: 90 } },
          feasibility: 'breedable',
          steps: [
            {
              index: 1,
              speciesIndex: findSpecies('Anubis'),
              mask: 1,
              parents: [
                { kind: 'owned', pal: samplePal },
                {
                  kind: 'owned',
                  pal: {
                    ...samplePal,
                    instanceId: 'b',
                    speciesIndex: findSpecies('Jormuntide Ignis'),
                    gender: 'Female',
                    passives: [],
                  },
                },
              ],
              expectedEggs: 3.4,
              passiveSuccess: 0.3,
              ivSuccess: 0.125,
              genderFactor: 1,
              genderRequirement: null,
              expectedUnwanted: 0.2,
              isFinal: true,
            },
          ],
          generations: 1,
          totalEggs: 3.4,
          missingPassives: [],
          existingMatches: [],
          alternatives: [],
          finalGenderProbability: 0.5,
          finalIvProbability: null,
          diagnostics: [],
          searchedNodes: 10,
          elapsedMs: 3,
          candidateCount: 2,
        }}
        spec={{ ...spec, cake: 'mushroom', minIvs: { hp: 90, attack: 90, defense: 90 } }}
      />,
    ).replaceAll('<!-- -->', '');

    expect(html).toContain('Diagram');
    expect(html).toContain('Copy Mermaid');
    expect(html).toContain('Mermaid source');
    expect(html).toContain('flowchart TD');
    expect(html).toContain('12.5% IVs');
    expect(html).toContain('HP ≥ 90, Attack ≥ 90, Defense ≥ 90');
    expect(html).toContain('Mushroom Cake is included in these IV odds');
  });

  it('shows cake-adjusted production cycles for Vegetable Cake plans', () => {
    const html = renderToString(
      <PlanView
        summary={{
          spec: { ...spec, cake: 'vegetable' },
          feasibility: 'breedable',
          steps: [
            {
              index: 1,
              speciesIndex: findSpecies('Anubis'),
              mask: 1,
              parents: [
                { kind: 'owned', pal: samplePal },
                {
                  kind: 'owned',
                  pal: {
                    ...samplePal,
                    instanceId: 'b',
                    speciesIndex: findSpecies('Jormuntide Ignis'),
                    gender: 'Female',
                    passives: [],
                  },
                },
              ],
              expectedEggs: 4,
              passiveSuccess: 0.25,
              genderFactor: 1,
              genderRequirement: null,
              expectedUnwanted: 0,
              isFinal: true,
            },
          ],
          generations: 1,
          totalEggs: 4,
          missingPassives: [],
          existingMatches: [],
          alternatives: [],
          finalGenderProbability: 0.5,
          finalIvProbability: null,
          diagnostics: [],
          searchedNodes: 10,
          elapsedMs: 3,
          candidateCount: 2,
        }}
        spec={{ ...spec, cake: 'vegetable' }}
      />,
    ).replaceAll('<!-- -->', '');

    expect(html).toContain('Expected hatches');
    expect(html).toContain('Production cycles');
    expect(html).toContain('Vegetable Cake turns this into about');
    expect(html).toContain('Cake strategy');
  });

  it('renders mutation-assisted plan steps distinctly from normal breeding', () => {
    const immortality = findPassive('Immortality')!.internalName;
    const target = {
      ...spec,
      speciesIndex: findSpecies('Warsect Terra'),
      requiredPassives: [immortality],
      cake: 'extravagant-vegetable' as const,
      minIvs: { hp: 90, attack: 90, defense: 90 },
    };
    const html = renderToString(
      <PlanView
        summary={{
          spec: target,
          feasibility: 'mutation-assisted',
          steps: [
            {
              index: 1,
              speciesIndex: findSpecies('Warsect Terra'),
              mask: 1,
              parents: [
                {
                  kind: 'owned',
                  pal: { ...samplePal, instanceId: 'bron', speciesIndex: findSpecies('Broncherry') },
                },
                {
                  kind: 'owned',
                  pal: {
                    ...samplePal,
                    instanceId: 'blaz',
                    speciesIndex: findSpecies('Blazamut'),
                    gender: 'Female',
                    passives: [],
                  },
                },
              ],
              expectedEggs: 91.2,
              passiveSuccess: 1,
              ivSuccess: 1,
              genderFactor: 1,
              genderRequirement: null,
              mutation: {
                kind: 'species-result',
                targetShare: 15 / 41 * 100,
                mutationChancePerHatch: 0.03,
                speciesChancePerHatch: 0.03 * (15 / 41),
                mutationPassiveChance: 0.2,
                assumedPassives: [immortality],
                inheritedPassives: [],
                mutationIvFloor: 90,
              },
              expectedUnwanted: 0,
              isFinal: true,
            },
          ],
          generations: 1,
          totalEggs: 91.2,
          missingPassives: [immortality],
          existingMatches: [],
          alternatives: [],
          finalGenderProbability: 1,
          finalIvProbability: 1,
          diagnostics: ['This route uses at least one mutation-created Pal.'],
          searchedNodes: 12,
          elapsedMs: 4,
          candidateCount: 2,
        }}
        spec={target}
      />,
    ).replaceAll('<!-- -->', '');

    expect(html).toContain('Possible with mutation help');
    expect(html).toContain('mutation species');
    expect(html).toContain('Assumes the mutated hatch rolls');
    expect(html).toContain('20.0% of mutated hatches');
    expect(html).toContain('Immortality');
    expect(html).toContain('Mutation-supplied passives');
    expect(html).toContain('minimum 90+ IVs');
  });

  it('renders each solver verdict without throwing', () => {
    const verdicts = [
      'breedable',
      'mutation-assisted',
      'already-owned',
      'missing-passives',
      'species-unreachable',
      'no-pals',
    ] as const;
    for (const feasibility of verdicts) {
      const html = renderToString(
        <PlanView
          summary={{
            spec,
            feasibility,
            steps: [],
            generations: null,
            totalEggs: null,
            missingPassives: feasibility === 'missing-passives' ? ['Legend'] : [],
            existingMatches: feasibility === 'already-owned' ? [samplePal] : [],
            alternatives: [],
            finalGenderProbability: 0.5,
            finalIvProbability: null,
            diagnostics: [],
            searchedNodes: 10,
            elapsedMs: 3,
            candidateCount: 1,
          }}
          spec={spec}
        />,
      );
      expect(html.length).toBeGreaterThan(0);
    }
  });
});

describe('planning without a save', () => {
  it('prompts for a first Pal when the roster is empty', () => {
    const html = renderToString(<RosterEditor plan={manualPlanState()} />).replaceAll('<!-- -->', '');
    expect(html).toContain('My Pals (0)');
    expect(html).toContain('Add your first Pal');
  });

  it('offers Add both above and below the list, so a long roster needs no scrolling', () => {
    const html = renderToString(
      <RosterEditor plan={manualPlanState({ roster: [manualSpec] })} />,
    ).replaceAll('<!-- -->', '');
    // Once in the panel header, once at the foot of the list.
    expect(html.split('Add a Pal').length - 1).toBe(2);
  });

  it('renders a hand-entered Pal with its passives and IVs', () => {
    const html = renderToString(
      <RosterEditor plan={manualPlanState({ roster: [manualSpec] })} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Relaxaurus Lux');
    expect(html).toContain('Sparky');
    expect(html).toContain('Artisan');
    expect(html).toContain('My Pals (1)');
  });

  it('lets a manual roster be searched, filtered and sorted once it has entries', () => {
    const html = renderToString(
      <RosterEditor plan={manualPlanState({ roster: [manualSpec] })} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Search species, nickname or passive...');
    expect(html).toContain('Any gender');
    expect(html).toContain('Best IV');
    expect(html).toContain('Newest first');
    expect(html).toContain('1 of 1 Pal');
  });

  it('can use a hand-entered Pal species as the current planning target', () => {
    const html = renderToString(
      <RosterEditor plan={manualPlanState({ roster: [manualSpec] })} onUseAsTarget={() => {}} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Use as the plan target');
  });

  it('gathers a whole Pal in the add dialog before it joins the list', () => {
    const html = renderToString(
      <PalDialog initial={manualSpec} mode="add" onSubmit={() => {}} onCancel={() => {}} />,
    ).replaceAll('<!-- -->', '');

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // Every field is on the dialog, so nothing is left to fill in afterwards.
    expect(html).toContain('Species');
    expect(html).toContain('Gender');
    expect(html).toContain('Passives (1/4)');
    expect(html).toContain('Nickname');
    expect(html).toContain('Attack');
    // Entering a run of Pals should not mean reopening the dialog by hand each time.
    expect(html).toContain('Add and enter another');
    expect(html).toContain('Add Pal');
  });

  it('reuses the same dialog for editing, without the add-another shortcut', () => {
    const html = renderToString(
      <PalDialog initial={manualSpec} mode="edit" onSubmit={() => {}} onCancel={() => {}} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Edit Relaxaurus Lux');
    expect(html).toContain('Save changes');
    expect(html).not.toContain('Add and enter another');
  });

  it('offers import and export once there are Pals to carry', () => {
    const html = renderToString(
      <RosterEditor plan={manualPlanState({ roster: [manualSpec] })} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Export');
    expect(html).toContain('Import');
  });

  it('does not clear the roster until it has been confirmed', () => {
    let cleared = false;
    const html = renderToString(
      <RosterEditor
        plan={manualPlanState({ roster: [manualSpec], clearRoster: () => (cleared = true) })}
      />,
    ).replaceAll('<!-- -->', '');
    // Clear all is on offer, but the dialog behind it is not open and nothing has gone yet.
    expect(html).toContain('Clear all');
    expect(html).not.toContain('cannot be undone');
    expect(cleared).toBe(false);
  });

  it('says what clearing costs, and offers a copy before taking it', () => {
    const html = renderToString(
      <ClearAllDialog pals={[manualSpec, manualSpec]} onConfirm={() => {}} onCancel={() => {}} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('role="dialog"');
    // The count is the thing worth checking twice before agreeing to it.
    expect(html).toContain('Clear all 2 Pals?');
    expect(html).toContain('cannot be undone');
    // Export sits in the dialog because this is the moment you would want it.
    expect(html).toContain('Export');
    // Backing out must be available and must not read as the destructive option.
    expect(html).toContain('Keep my list');
  });

  it('counts a single Pal without the plural', () => {
    const html = renderToString(
      <ClearAllDialog pals={[manualSpec]} onConfirm={() => {}} onCancel={() => {}} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('Clear all 1 Pal?');
  });

  it('offers import even with an empty roster, so a list can be brought in first', () => {
    const html = renderToString(<RosterEditor plan={manualPlanState()} />).replaceAll('<!-- -->', '');
    expect(html).toContain('Import a list');
  });

  it('lets an import either add to the roster or replace it', () => {
    const html = renderToString(
      <ImportDialog currentCount={3} onImport={() => {}} onCancel={() => {}} />,
    ).replaceAll('<!-- -->', '');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Choose a roster file');
    // Pasting is offered too, for moving between browsers without a file.
    expect(html).toContain('Roster JSON');
  });

  it('renders an untouched tree as a single undecided slot', () => {
    const html = explorer(newManualNode('root', findSpecies('Anubis')));
    expect(html).toContain('Anubis');
    expect(html).toContain('undecided');
    expect(html).toContain('I have one');
    expect(html).toContain('Breed it');
  });

  it('adds a mutation calculator under Explore', () => {
    const html = explorer(newManualNode('root', findSpecies('Anubis')));
    expect(html).toContain('Mutation calculator');
    expect(html).toContain('Extravagant Vegetable Cake');
    expect(html).toContain('Chance after');
    expect(html).toContain('Target chance');
    expect(html).toContain('Mutation passives');
    expect(html).toContain('Skymarcher');
    expect(html).toContain('base 1.0% mutation rate');
    expect(html).toContain('3.0%');
    expect(html).toContain('Mutation result lookup');
    expect(html).toContain('Possible mutated children');
    expect(html).toContain('Normal child');
    expect(html).toContain('Majex');
    expect(html).toContain('Solmora Lux');
    expect(html).toContain('Reverse mutation lookup');
    expect(html).toContain('Same-species parents');
    expect(html).toContain('Same-pair options');
  });

  it('renders a finished tree with its steps and egg estimate', () => {
    const relaxaurus = findSpecies('Relaxaurus Lux');
    const jormuntide = findSpecies('Jormuntide Ignis');
    const tree: ManualNode = {
      id: 'root',
      speciesIndex: findSpecies('Anubis'),
      have: null,
      parents: [
        { id: 'a', speciesIndex: relaxaurus, have: manualSpec, parents: null },
        {
          id: 'b',
          speciesIndex: jormuntide,
          have: { ...manualSpec, id: 'r2', speciesIndex: jormuntide, gender: 'Female', nickname: '' },
          parents: null,
        },
      ],
    };

    const html = explorer(tree, [manualPal(manualSpec)]);
    expect(html).toContain('Jormuntide Ignis');
    expect(html).toContain('of hatches carry Artisan');
    expect(html).toContain('Diagram');
    expect(html).toContain('Copy Mermaid');
    expect(html).toContain('In breeding order');
    expect(html).toContain('Step 1');
    // A slot filled from the pool reports where that Pal is.
    expect(html).toContain('Entered by hand');
  });

  it('re-reads a slot from the current pool rather than trusting its stored copy', () => {
    const stale: ManualPalSpec = { ...manualSpec, passives: [], nickname: 'old name' };
    const tree: ManualNode = {
      id: 'root',
      speciesIndex: findSpecies('Anubis'),
      have: null,
      parents: [
        { id: 'a', speciesIndex: manualSpec.speciesIndex, have: stale, parents: null },
        { id: 'b', speciesIndex: findSpecies('Jormuntide Ignis'), have: null, parents: null },
      ],
    };

    // Same id, but the Pal has since gained a passive and a new nickname.
    const html = explorer(tree, [manualPal(manualSpec)]);
    expect(html).toContain('Sparky');
    expect(html).not.toContain('old name');
    expect(html).toContain('Artisan');
  });

  it('flags a slot whose Pal is no longer in scope', () => {
    const tree: ManualNode = {
      id: 'root',
      speciesIndex: findSpecies('Anubis'),
      have: null,
      parents: [
        { id: 'a', speciesIndex: manualSpec.speciesIndex, have: manualSpec, parents: null },
        { id: 'b', speciesIndex: findSpecies('Jormuntide Ignis'), have: null, parents: null },
      ],
    };
    // Empty pool: the Pal this slot names is gone.
    expect(explorer(tree, [])).toContain('no longer in scope');
  });

  it('never presents the gender cost as though the species were uncertain', () => {
    // A step whose left parent is itself bred. The child is always Anubis; the only reason
    // this costs two eggs is that the bred parent has to come out the right sex.
    const target = findSpecies('Anubis');
    const [pa, pb] = parentPairsFor(target)[0]!;
    const [ga, gb] = parentPairsFor(pa)[0]!;
    const at = (sp: number, gender: 'Male' | 'Female'): ManualPalSpec => ({
      ...manualSpec,
      id: `x${sp}${gender}`,
      speciesIndex: sp,
      gender,
      passives: [],
    });

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
            { id: 'g1', speciesIndex: ga, have: at(ga, 'Male'), parents: null },
            { id: 'g2', speciesIndex: gb, have: at(gb, 'Female'), parents: null },
          ],
        },
        { id: 'right', speciesIndex: pb, have: at(pb, 'Female'), parents: null },
      ],
    };

    const html = renderToString(
      <Explorer
        tree={tree}
        onTreeChange={() => {}}
        onResetTree={() => {}}
        pool={[]}
        requiredPassives={[]}
        targetSpecies={target}
        onUseAsTarget={() => {}}
      />,
    ).replaceAll('<!-- -->', '');

    const treeHtml = html.slice(0, html.indexOf('Mutation calculator'));
    // No required passives, so nothing about the egg itself is a gamble.
    expect(treeHtml).toContain('every hatch is the right species');
    expect(treeHtml).not.toContain('% per hatch');
    // The 50% must be attributed to the parent's gender, and named as such.
    expect(html).toContain('must come out');
    expect(html).toMatch(new RegExp(`the ${speciesName(pa)} you breed must come out (Male|Female)`));
  });

  it('surfaces a pairing that does not make what the slot claims', () => {
    const tree: ManualNode = {
      id: 'root',
      speciesIndex: findSpecies('Penking'),
      have: null,
      parents: [
        { id: 'a', speciesIndex: findSpecies('Lamball'), have: null, parents: null },
        { id: 'b', speciesIndex: findSpecies('Cattiva'), have: null, parents: null },
      ],
    };
    const html = explorer(tree);
    expect(html).toContain('not Penking');
  });

  it('ranks parent pairs so the ones you can field come first', () => {
    const anubis = findSpecies('Anubis');
    const html = renderToString(
      <PairPicker
        child={anubis}
        owned={new Set([findSpecies('Relaxaurus Lux'), findSpecies('Jormuntide Ignis')])}
        onChoose={() => {}}
        onCancel={() => {}}
      />,
    ).replaceAll('<!-- -->', '');

    expect(html).toContain('Pairs that make Anubis');
    expect(html).toContain('have both');
    // The pair we own must be rendered ahead of any pair we do not.
    expect(html.indexOf('have both')).toBeLessThan(html.indexOf('have one'));
  });
});
