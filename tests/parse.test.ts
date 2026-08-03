/**
 * Cross-implementation parser check.
 *
 * `tests/fixtures` is written by cheahjs/palworld-save-tools (see scripts/make-fixture.py),
 * so these assertions verify PalForge reads a save produced by a completely separate
 * implementation of the format -- not just its own output.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadSave } from '../src/node/loadSave.js';
import { findSpecies, passiveDisplayName, speciesName } from '../src/core/data/index.js';
import type { Pal } from '../src/core/save/types.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures', import.meta.url));

const save = await loadSave(FIXTURE_DIR);
const bySpecies = (name: string): Pal => {
  const idx = findSpecies(name);
  const pal = save.pals.find((p) => p.speciesIndex === idx);
  if (!pal) throw new Error(`no ${name} in fixture (got: ${save.pals.map((p) => speciesName(p.speciesIndex)).join(', ')})`);
  return pal;
};

describe('save parsing', () => {
  it('decompresses a PlZ save and reports its container', () => {
    expect(save.meta.container).toBe('PlZ');
    expect(save.meta.saveType).toBe(0x31);
  });

  it('extracts every Pal and excludes the player character', () => {
    expect(save.pals).toHaveLength(3);
    expect(save.players).toHaveLength(1);
    expect(save.players[0]!.name).toBe('Tester');
  });

  it('reads species, gender, IVs and passives', () => {
    const penking = bySpecies('Penking');
    expect(penking.gender).toBe('Male');
    expect(penking.ivs).toEqual({ hp: 94, attack: 81, defense: 97 });
    expect(penking.passives.map(passiveDisplayName).sort()).toEqual(['Artisan', 'Serious']);
    expect(penking.level).toBe(25);
  });

  it('strips the BOSS_ prefix so alphas resolve to their base breeding species', () => {
    const anubis = bySpecies('Anubis');
    expect(anubis.characterId).toBe('BOSS_Anubis');
    expect(anubis.isBoss).toBe(true);
    expect(anubis.nickname).toBe('Sandy');
    expect(anubis.rank).toBe(3);
    expect(anubis.passives.map(passiveDisplayName)).toContain('Legend');
  });

  it('maps a Palbox slot index to page/row/column', () => {
    const penking = bySpecies('Penking');
    // Slot 12 with a 6x5 page: page 1, row 3, column 1.
    expect(penking.location.kind).toBe('palbox');
    expect(penking.location.page).toBe(1);
    expect(penking.location.row).toBe(3);
    expect(penking.location.column).toBe(1);

    const celaray = bySpecies('Celaray');
    // Slot 37 lands on page 2 (slots 30-59), offset 7 -> row 2, column 2.
    expect(celaray.location.page).toBe(2);
    expect(celaray.location.row).toBe(2);
    expect(celaray.location.column).toBe(2);
  });

  it('recognises party members separately from Palbox storage', () => {
    const anubis = bySpecies('Anubis');
    expect(anubis.location.kind).toBe('party');
    expect(anubis.location.label).toBe('Party slot 1');
  });

  it('reads active skills with the EPalWazaID prefix stripped', () => {
    const penking = bySpecies('Penking');
    expect(penking.masteredSkills).toEqual(['WaterGun', 'IceMissile']);
    expect(penking.equippedSkills).toEqual(['WaterGun']);
  });

  it('extracts guild membership', () => {
    expect(save.guilds).toHaveLength(1);
    const guild = save.guilds[0]!;
    expect(guild.name).toBe('Testers');
    expect(guild.members.map((m) => m.name)).toEqual(['Tester']);
  });

  it('links Pals to the owning player and their Palbox container', () => {
    const penking = bySpecies('Penking');
    expect(penking.ownerPlayerUid).toBe('11111111-1111-1111-1111-111111111111');
    expect(save.players[0]!.palboxContainerId).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('parses without leaving unread trailer data', () => {
    expect(save.warnings).toEqual([]);
  });
});
