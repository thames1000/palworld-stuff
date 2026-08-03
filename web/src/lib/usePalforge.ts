/** React binding for the parse/solve worker. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveData } from '@core/save/types';
import type { TargetSpec } from '@core/solver/types';
import type { Scope, SolveSummary, WorkerRequest, WorkerResponse } from '../worker/protocol';
import type { PickedSave } from './pickSave';

export type Phase = 'empty' | 'loading' | 'ready' | 'error';

export interface PalforgeState {
  phase: Phase;
  save: SaveData | null;
  savePath: string | null;
  progress: { stage: string; detail?: string } | null;
  error: string | null;
  solving: boolean;
  summary: SolveSummary | null;
}

export function usePalforge() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<PalforgeState>({
    phase: 'empty',
    save: null,
    savePath: null,
    progress: null,
    error: null,
    solving: false,
    summary: null,
  });

  useEffect(() => {
    const worker = new Worker(new URL('../worker/palforge.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      setState((prev) => {
        switch (message.kind) {
          case 'progress':
            return { ...prev, progress: { stage: message.stage, detail: message.detail } };
          case 'parsed':
            return {
              ...prev,
              phase: 'ready',
              save: message.save,
              progress: null,
              error: null,
              summary: null,
            };
          case 'solved':
            return { ...prev, solving: false, summary: message.summary };
          case 'error':
            return {
              ...prev,
              // A failed solve should not throw away a save that loaded fine.
              phase: prev.save ? 'ready' : 'error',
              solving: false,
              progress: null,
              error: message.message,
            };
        }
      });
    };

    worker.onerror = (event) => {
      setState((prev) => ({
        ...prev,
        phase: prev.save ? 'ready' : 'error',
        solving: false,
        error: event.message || 'The save worker crashed.',
      }));
    };

    return () => worker.terminate();
  }, []);

  const load = useCallback(async (picked: PickedSave) => {
    setState((prev) => ({
      ...prev,
      phase: 'loading',
      error: null,
      summary: null,
      savePath: picked.levelPath,
      progress: { stage: 'reading', detail: picked.level.name },
    }));
    try {
      const level = await picked.level.arrayBuffer();
      const players = await Promise.all(
        picked.players.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() })),
      );
      const request: WorkerRequest = { kind: 'parse', level, players };
      // Hand the buffers over rather than copying them; a Level.sav can be hundreds of MB.
      workerRef.current?.postMessage(request, [level, ...players.map((p) => p.data)]);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const solve = useCallback((spec: TargetSpec, scope: Scope) => {
    setState((prev) => ({ ...prev, solving: true, error: null }));
    const request: WorkerRequest = { kind: 'solve', spec, scope };
    workerRef.current?.postMessage(request);
  }, []);

  const reset = useCallback(() => {
    setState({
      phase: 'empty',
      save: null,
      savePath: null,
      progress: null,
      error: null,
      solving: false,
      summary: null,
    });
  }, []);

  const dismissError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return { ...state, load, solve, reset, dismissError };
}
