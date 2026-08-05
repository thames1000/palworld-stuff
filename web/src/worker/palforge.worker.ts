/**
 * Parses saves and runs the breeding search off the main thread.
 *
 * A large Level.sav takes seconds to parse and a full search can take a second or more;
 * both would otherwise freeze the page. The parsed save stays resident here so repeated
 * solves never re-parse or re-transfer it.
 */
import { parseSave } from '@core/save/extract';
import { solve } from '@core/solver/search';
import { flattenPlan } from '@core/solver/steps';
import type { Pal, SaveData } from '@core/save/types';
import type { Scope, SolveSource, WorkerRequest, WorkerResponse } from './protocol';

let loaded: SaveData | null = null;

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

function applyScope(save: SaveData, scope: Scope): Pal[] {
  let pals = save.pals;
  if (scope.playerUid) pals = pals.filter((p) => p.ownerPlayerUid === scope.playerUid);
  if (scope.guildId) pals = pals.filter((p) => p.groupId === scope.guildId);
  if (!scope.includeParty) pals = pals.filter((p) => p.location.kind !== 'party');
  return pals;
}

function candidatesFor(source: SolveSource): Pal[] {
  if (source.kind === 'roster') return source.pals;
  if (!loaded) throw new Error('No save has been loaded yet.');
  return applyScope(loaded, source.scope);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'parse') {
      loaded = await parseSave(
        {
          level: new Uint8Array(request.level),
          players: request.players.map((p) => ({ name: p.name, data: new Uint8Array(p.data) })),
        },
        (stage, detail) => post({ kind: 'progress', stage, detail }),
      );
      post({ kind: 'parsed', save: loaded });
      return;
    }

    if (request.kind === 'solve') {
      const candidates = candidatesFor(request.source);
      const result = solve(candidates, request.spec);
      post({
        kind: 'solved',
        summary: {
          spec: request.spec,
          feasibility: result.feasibility,
          steps: result.plan ? flattenPlan(result.plan) : [],
          generations: result.plan?.generation ?? null,
          totalEggs: result.plan?.totalEggs ?? null,
          missingPassives: result.missingPassives,
          existingMatches: result.existingMatches,
          alternatives: result.alternatives.map((alt) => ({
            speciesIndex: alt.speciesIndex,
            mask: alt.mask,
            generations: alt.generation,
            totalEggs: alt.totalEggs,
          })),
          finalGenderProbability: result.finalGenderProbability,
          finalIvProbability: result.finalIvProbability,
          diagnostics: result.diagnostics,
          searchedNodes: result.searchedNodes,
          elapsedMs: result.elapsedMs,
          candidateCount: candidates.length,
        },
      });
    }
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
