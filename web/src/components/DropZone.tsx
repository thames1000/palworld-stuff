/** Landing surface: pick or drop a save folder. Nothing is uploaded anywhere. */
import { useRef, useState } from 'react';
import { DATASET_VERSION, SPECIES } from '@core/data/index';
import { fromDataTransfer, fromFileList, type PickedSave } from '../lib/pickSave';
import { Button, Spinner } from './ui';

const SAVE_LOCATIONS: Array<{ platform: string; path: string }> = [
  { platform: 'Steam (Windows)', path: '%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\<steam-id>\\<world-id>\\' },
  {
    platform: 'Steam (Linux / Proton)',
    path: '~/.steam/steam/steamapps/compatdata/1623730/pfx/drive_c/users/steamuser/AppData/Local/Pal/Saved/SaveGames/…',
  },
  { platform: 'Xbox / Game Pass', path: '%LOCALAPPDATA%\\Packages\\PocketpairInc.Palworld_…\\SystemAppData\\wgs\\' },
  { platform: 'Dedicated server', path: '<server>/Pal/Saved/SaveGames/0/<world-id>/' },
];

export function DropZone({
  onPick,
  onSkip,
  busy,
  progress,
  error,
}: {
  onPick: (picked: PickedSave) => void;
  /** Continue without a save, entering Pals and pairings by hand. */
  onSkip: () => void;
  busy: boolean;
  progress: { stage: string; detail?: string } | null;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handle = async (run: () => Promise<PickedSave> | PickedSave) => {
    setLocalError(null);
    try {
      onPick(await run());
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  };

  const shown = localError ?? error;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink-0">
          Pal<span className="text-accent">Forge</span>
        </h1>
        <p className="mt-2 text-sm text-ink-1">
          Breeding plans built from the Pals you actually own.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handle(() => fromDataTransfer(e.dataTransfer));
        }}
        className={`rounded-xl border-2 border-dashed p-10 text-center transition ${
          dragging ? 'border-accent bg-accent/8' : 'border-edge bg-surface-1'
        }`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Spinner label={progress ? `${progress.stage}…` : 'Working…'} />
            {progress?.detail && <p className="text-xs text-ink-2">{progress.detail}</p>}
          </div>
        ) : (
          <>
            <p className="text-base font-medium text-ink-0">Drop your Palworld world folder here</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-1">
              The folder containing <code className="text-accent">Level.sav</code>. Including its{' '}
              <code className="text-accent">Players/</code> subfolder lets PalForge show exact
              Palbox page, row and column for every Pal.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" onClick={() => folderInput.current?.click()}>
                Choose save folder
              </Button>
              <Button onClick={() => fileInput.current?.click()}>Choose Level.sav only</Button>
            </div>
          </>
        )}

        <input
          ref={folderInput}
          type="file"
          className="hidden"
          // Non-standard but supported across current browsers; this is what lets us pick
          // up Players/*.sav alongside Level.sav in a single choice.
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(e) => e.target.files && void handle(() => fromFileList(e.target.files!))}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".sav"
          className="hidden"
          onChange={(e) => e.target.files && void handle(() => fromFileList(e.target.files!))}
        />
      </div>

      {shown && (
        <div className="mt-4 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {shown}
        </div>
      )}

      {!busy && (
        <div className="mt-4 rounded-lg border border-edge/60 bg-surface-1 px-4 py-3 text-center">
          <p className="text-sm text-ink-1">No save handy?</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-ink-2">
            Enter the Pals you own yourself, or walk the breeding table by hand to work out a route
            — same plans, same egg math, nothing to load.
          </p>
          <div className="mt-3">
            <Button onClick={onSkip}>Plan without a save</Button>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-good/30 bg-good/8 px-4 py-3">
        <p className="text-sm font-medium text-good">Your save never leaves this device.</p>
        <p className="mt-1 text-xs text-ink-1">
          Everything is parsed and solved in your browser. There is no server, and nothing is
          uploaded — which matters, because a save file contains the Steam IDs and display names
          of everyone who has played on that world.
        </p>
      </div>

      <details className="mt-6 rounded-lg border border-edge/60 bg-surface-1 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-1">
          Where do I find my save?
        </summary>
        <dl className="mt-3 space-y-3">
          {SAVE_LOCATIONS.map((loc) => (
            <div key={loc.platform}>
              <dt className="text-xs font-semibold text-ink-0">{loc.platform}</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-2">{loc.path}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="mt-8 text-center text-[11px] text-ink-2">
        {SPECIES.length} species · PalCalc dataset {DATASET_VERSION}
      </p>
    </div>
  );
}
