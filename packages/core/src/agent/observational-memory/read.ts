/**
 * Read API for Observational Memory.
 *
 * `buildObservationalContext` assembles the three tiers — reflections (highest
 * level) + observations (dense) + the recent raw message tail — into a single
 * structure ready to fold into a prompt. It is intentionally NOT wired into
 * production-agent.ts here; see the exported seam note below and the package
 * barrel export so the wire-up is one call later.
 *
 * Token-cheap by construction: a long thread is represented by its compacted
 * tiers plus only the last N raw turns, instead of the entire transcript.
 */

import type { EngineMessage } from "../engine/types.js";
import {
  resolveObservationalMemoryConfig,
  type ObservationalMemoryConfig,
} from "./config.js";
import { listObservationalMemory } from "./store.js";
import { countWindowTokens } from "./message-text.js";
import type {
  ObservationalContext,
  ObservationalMemoryEntry,
  ObservationalMemoryOwner,
} from "./types.js";

export interface BuildObservationalContextOptions extends ObservationalMemoryOwner {
  threadId: string;
  /** The full, ordered thread messages — the recent tail is taken from here. */
  messages: EngineMessage[];
  config?: Partial<ObservationalMemoryConfig>;
}

function sumTokens(entries: ObservationalMemoryEntry[]): number {
  return entries.reduce((acc, entry) => acc + (entry.tokenEstimate || 0), 0);
}

/**
 * SEAM (deferred wire-up): build the three-tier Observational Memory context
 * for a thread. The returned tiers are ready to be injected into the turn's
 * prompt assembly.
 *
 * TODO(charlie-merge): inject buildObservationalContext output into the turn
 * context assembly in production-agent.ts once the lazy-skill context changes
 * land. The intended shape: replace the older raw-message prefix (everything
 * before `recentMessages`) with the `reflections` + `observations` text, keep
 * `recentMessages` verbatim, and prepend a short "Observational Memory" system
 * section. This module deliberately does not edit production-agent.ts.
 */
export async function buildObservationalContext(
  options: BuildObservationalContextOptions,
): Promise<ObservationalContext> {
  const config = resolveObservationalMemoryConfig(options.config);
  const owner: ObservationalMemoryOwner = {
    ownerEmail: options.ownerEmail,
    orgId: options.orgId ?? null,
  };

  const [reflections, observations] = await Promise.all([
    listObservationalMemory({
      ...owner,
      threadId: options.threadId,
      tier: "reflection",
    }),
    listObservationalMemory({
      ...owner,
      threadId: options.threadId,
      tier: "observation",
    }),
  ]);

  const recentCount = Math.max(0, config.recentRawMessageCount);
  const recentMessages =
    recentCount > 0 ? options.messages.slice(-recentCount) : [];

  const recentTokens = await countWindowTokens(recentMessages);
  const reflectionTokens = sumTokens(reflections);
  const observationTokens = sumTokens(observations);

  return {
    threadId: options.threadId,
    reflections,
    observations,
    recentMessages,
    tokens: {
      reflections: reflectionTokens,
      observations: observationTokens,
      recentMessages: recentTokens,
      total: reflectionTokens + observationTokens + recentTokens,
    },
  };
}
