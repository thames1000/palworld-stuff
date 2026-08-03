/** Filesystem front-end for the portable save parser. */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSave, type PlayerFile } from '../core/save/extract.js';
import type { SaveData } from '../core/save/types.js';

export interface LoadOptions {
  /** Skip reading Players/*.sav (faster, but locations stay as raw container ids). */
  skipPlayerFiles?: boolean;
}

/** Loads a save. `target` may be a Level.sav path or the directory containing it. */
export async function loadSave(target: string, opts: LoadOptions = {}): Promise<SaveData> {
  const levelPath = target.toLowerCase().endsWith('.sav') ? target : join(target, 'Level.sav');
  if (!existsSync(levelPath)) {
    throw new Error(`Level.sav not found at ${levelPath}`);
  }

  const level = new Uint8Array(await readFile(levelPath));

  let players: PlayerFile[] = [];
  if (!opts.skipPlayerFiles) {
    const playersDir = join(dirname(levelPath), 'Players');
    try {
      const names = (await readdir(playersDir)).filter((f) => f.toLowerCase().endsWith('.sav'));
      players = await Promise.all(
        names.map(async (name) => ({
          name,
          data: new Uint8Array(await readFile(join(playersDir, name))),
        })),
      );
    } catch {
      // No Players/ directory. parseSave warns about the consequences for locations.
    }
  }

  return parseSave({ level, players });
}
