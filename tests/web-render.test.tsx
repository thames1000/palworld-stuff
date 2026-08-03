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
import { PalTable } from '../web/src/components/PalTable';
import { PlanView } from '../web/src/components/PlanView';
import { findPassive, findSpecies } from '../src/core/data/index.js';
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

describe('web UI', () => {
  it('renders the drop zone before a save is loaded', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Drop your Palworld world folder here');
    // The privacy promise is the reason this app is client-side; it must be on screen.
    expect(html).toContain('never leaves this device');
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

  it('renders an empty plan panel without a summary', () => {
    const html = renderToString(<PlanView summary={null} spec={spec} />);
    expect(html).toContain('Find breeding plan');
  });

  it('renders each solver verdict without throwing', () => {
    const verdicts = [
      'breedable',
      'already-owned',
      'missing-passives',
      'species-unreachable',
      'no-pals',
    ] as const;
    for (const feasibility of verdicts) {
      const html = renderToString(
        <PlanView
          summary={{
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
