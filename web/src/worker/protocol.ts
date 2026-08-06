/** Message contract between the UI thread and the parse/solve worker. */
import type { SaveData, Pal } from '@core/save/types';
import type { PlanStep } from '@core/solver/steps';
import type { Feasibility, MutationAttempt, TargetSpec } from '@core/solver/types';

export interface Scope {
  /** Only use Pals owned by this player. Null means every player in the save. */
  playerUid: string | null;
  /** Only use Pals filed under this guild. */
  guildId: string | null;
  /** Include party Pals as breeding candidates alongside Palbox storage. */
  includeParty: boolean;
}

/**
 * Where the solver's candidate Pals come from.
 *
 * A parsed save stays resident in the worker and is scoped there, so only the filter
 * crosses the boundary. A hand-entered roster has no worker-side copy, so it is sent
 * whole -- which is cheap, because a roster is something a person typed.
 */
export type SolveSource =
  | { kind: 'save'; scope: Scope }
  | { kind: 'roster'; pals: Pal[] };

export interface SolveSummary {
  /** The exact target spec this result was solved against. */
  spec: TargetSpec;
  feasibility: Feasibility;
  /** Flattened breeding steps, ready to render. Empty when there is no plan. */
  steps: PlanStep[];
  mutationAttempts?: MutationAttempt[];
  generations: number | null;
  totalEggs: number | null;
  missingPassives: string[];
  existingMatches: Pal[];
  alternatives: Array<{
    speciesIndex: number;
    mask: number;
    generations: number;
    totalEggs: number;
  }>;
  finalGenderProbability: number;
  finalIvProbability: number | null;
  diagnostics: string[];
  searchedNodes: number;
  elapsedMs: number;
  /** How many Pals the solver was actually allowed to use, after scoping. */
  candidateCount: number;
}

export type WorkerRequest =
  | {
      kind: 'parse';
      level: ArrayBuffer;
      players: Array<{ name: string; data: ArrayBuffer }>;
    }
  | { kind: 'solve'; spec: TargetSpec; source: SolveSource };

export type WorkerResponse =
  | { kind: 'progress'; stage: string; detail?: string }
  | { kind: 'parsed'; save: SaveData }
  | { kind: 'solved'; summary: SolveSummary }
  | { kind: 'error'; message: string };
