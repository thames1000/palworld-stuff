/**
 * Moving a hand-entered roster between browsers and machines.
 *
 * The roster lives in this browser's local storage, which is exactly as portable as the
 * browser is -- i.e. not at all. Typing twenty Pals once is tolerable; typing them again on
 * the laptop is not. So the list goes out as a file you can carry, and comes back either as
 * a file or as pasted text, because sometimes the quickest route between two browsers is
 * the clipboard.
 */
import { useRef, useState } from 'react';
import { DATASET_VERSION } from '@core/data/index';
import type { ManualPalSpec } from '@core/save/manual';
import { parseRosterFile, serializeRoster, type RosterImport } from '@core/save/rosterFile';
import { newId } from '../lib/manualPlan';
import { Button, Modal, TextArea } from './ui';

function downloadRoster(pals: readonly ManualPalSpec[]): void {
  const text = serializeRoster(pals, DATASET_VERSION);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  link.download = `palforge-roster-${stamp}.json`;
  link.click();
  // Revoking immediately can cancel the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportButtons({ pals }: { pals: readonly ManualPalSpec[] }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serializeRoster(pals, DATASET_VERSION));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright; the file download always works.
      setCopied(false);
    }
  };

  return (
    <>
      <Button variant="ghost" onClick={() => downloadRoster(pals)}>
        Export
      </Button>
      <Button variant="ghost" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </>
  );
}

export function ImportDialog({
  onImport,
  onCancel,
  currentCount,
}: {
  /** `replace` discards the current roster; otherwise the imported Pals are added to it. */
  onImport: (pals: ManualPalSpec[], replace: boolean) => void;
  onCancel: () => void;
  currentCount: number;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<RosterImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const read = (raw: string) => {
    setError(null);
    setResult(null);
    try {
      setResult(parseRosterFile(raw, { makeId: () => newId('pal') }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pickFile = async (file: File) => {
    const raw = await file.text();
    setText(raw);
    read(raw);
  };

  return (
    <Modal
      title="Import Pals"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {result && result.pals.length > 0 && (
            <>
              {currentCount > 0 && (
                <Button onClick={() => onImport(result.pals, true)}>
                  Replace my {currentCount}
                </Button>
              )}
              <Button variant="primary" onClick={() => onImport(result.pals, false)}>
                {currentCount > 0
                  ? `Add ${result.pals.length} to my list`
                  : `Add ${result.pals.length} Pal${result.pals.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => fileInput.current?.click()}>Choose a roster file</Button>
          <span className="text-xs text-ink-2">or paste it below</span>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pickFile(file);
            }}
          />
        </div>

        <TextArea
          rows={8}
          value={text}
          placeholder='{ "format": "palforge-roster", … }'
          aria-label="Roster JSON"
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) read(e.target.value);
            else {
              setResult(null);
              setError(null);
            }
          }}
          className="font-mono text-xs"
        />

        {error && (
          <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {error}
          </p>
        )}

        {result && (
          <div className="space-y-2">
            <p
              className={`rounded-md border px-3 py-2 text-xs ${
                result.pals.length > 0
                  ? 'border-good/40 bg-good/10 text-good'
                  : 'border-warn/40 bg-warn/10 text-warn'
              }`}
            >
              {result.pals.length > 0
                ? `Read ${result.pals.length} Pal${result.pals.length === 1 ? '' : 's'}.`
                : 'Nothing importable in that.'}
            </p>
            {result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-[11px] text-ink-2">
          Species and passives are stored by name, so a roster exported today still reads
          correctly after a Palworld patch shifts the dataset around.
        </p>
      </div>
    </Modal>
  );
}
