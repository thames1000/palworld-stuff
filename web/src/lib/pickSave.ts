/**
 * Locating Level.sav and its Players/ folder from whatever the user gives us.
 *
 * The Palbox and party container ids live only in the per-player .sav files, so a lone
 * Level.sav yields Pals without real locations. Everything here is oriented around getting
 * the whole world folder when we can, while still working from a single file.
 */

export interface PickedSave {
  level: File;
  players: File[];
  /** Path the Level.sav was found at, for display. */
  levelPath: string;
}

/** A file plus the path it appeared at, relative to whatever the user selected. */
interface Entry {
  path: string;
  file: File;
}

const LEVEL_NAME = 'level.sav';

function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * Chooses the Level.sav to use when the selection contains more than one.
 *
 * Prefers one that actually has player files beside it, since that is the world the user
 * plays; falls back to the largest, which is the most populated world.
 */
function chooseLevel(levels: Entry[], all: Entry[]): Entry {
  const withPlayers = levels.filter((level) => {
    const prefix = `${dirOf(level.path)}/players/`.replace(/^\//, '');
    return all.some((e) => e.path.toLowerCase().startsWith(prefix.toLowerCase()));
  });
  const pool = withPlayers.length > 0 ? withPlayers : levels;
  return pool.reduce((best, e) => (e.file.size > best.file.size ? e : best), pool[0]!);
}

function assemble(entries: Entry[]): PickedSave {
  const levels = entries.filter((e) => e.file.name.toLowerCase() === LEVEL_NAME);

  if (levels.length === 0) {
    const sav = entries.filter((e) => e.file.name.toLowerCase().endsWith('.sav'));
    if (sav.length === 1) {
      // A single .sav under another name: most likely a renamed Level.sav, so try it and
      // let the container check produce the real error if it is something else.
      return { level: sav[0]!.file, players: [], levelPath: sav[0]!.path };
    }
    throw new Error(
      'No Level.sav found in that selection. Pick the world folder that contains Level.sav ' +
        '(usually .../Pal/Saved/SaveGames/<steam-id>/<world-id>/).',
    );
  }

  const level = chooseLevel(levels, entries);
  const playersPrefix = `${dirOf(level.path)}/Players/`.replace(/^\//, '').toLowerCase();
  const players = entries
    .filter(
      (e) => e.path.toLowerCase().startsWith(playersPrefix) && e.file.name.toLowerCase().endsWith('.sav'),
    )
    .map((e) => e.file);

  return { level: level.file, players, levelPath: level.path };
}

/** From an `<input type="file" webkitdirectory>` or a plain file input. */
export function fromFileList(list: FileList): PickedSave {
  const entries: Entry[] = Array.from(list).map((file) => ({
    // webkitRelativePath is empty for a plain (non-directory) file input.
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }));
  return assemble(entries);
}

/** Depth-limited so a mis-drop of a huge tree cannot hang the page. */
const MAX_DEPTH = 6;

async function readDirectory(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns at most ~100 items per call and must be drained.
  const out: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

async function walk(entry: FileSystemEntry, prefix: string, depth: number, out: Entry[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    // Only .sav files matter; skip everything else so a stray screenshots folder is free.
    if (file.name.toLowerCase().endsWith('.sav')) out.push({ path, file });
    return;
  }

  if (entry.isDirectory) {
    const children = await readDirectory((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await walk(child, path, depth + 1, out);
  }
}

/** From a drag-and-drop, which may carry whole directories. */
export async function fromDataTransfer(transfer: DataTransfer): Promise<PickedSave> {
  const roots: FileSystemEntry[] = [];
  const plainFiles: File[] = [];

  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      roots.push(entry);
    } else {
      const file = item.getAsFile();
      if (file) plainFiles.push(file);
    }
  }

  const entries: Entry[] = plainFiles.map((file) => ({ path: file.name, file }));
  for (const root of roots) await walk(root, '', 0, entries);

  if (entries.length === 0) {
    throw new Error('That drop contained no .sav files. Drag the world folder, or Level.sav itself.');
  }
  return assemble(entries);
}
