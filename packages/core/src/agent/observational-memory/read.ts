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
import { countWindowTokens } from "./message-text.js";
import { listObservationalMemory } from "./store.js";
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
 * Build the three-tier Observational Memory context for a thread. The returned
 * tiers are ready to be injected into the turn's prompt assembly.
 *
 * This is consumed by the agent loop (`production-agent.ts`): when a thread has
 * persisted observations/reflections, the older raw-message prefix (everything
 * before `recentMessages`) is replaced with the `reflections` + `observations`
 * text, `recentMessages` is kept verbatim, and a short "Observational Memory"
 * block is prepended. Threads with no OM entries are left unchanged.
 */
/** True when this thread has at least one persisted observation or reflection. */
export function hasObservationalMemory(context: ObservationalContext): boolean {
  return context.reflections.length > 0 || context.observations.length > 0;
}

/**
 * Serialize the reflections + observations tiers into a single, clearly
 * delimited prompt block. The recent-raw-message tail is NOT serialized here —
 * it stays as verbatim engine messages — so this block represents only the
 * compacted older history that replaces the raw prefix.
 *
 * Returns an empty string when there is nothing compacted yet, so callers can
 * cheaply skip injection for short threads.
 */
export function serializeObservationalMemoryBlock(
  context: ObservationalContext,
): string {
  if (!hasObservationalMemory(context)) return "";
  const sections: string[] = [];
  sections.push(
    "[Observational Memory] The earlier part of this long conversation has been " +
      "compacted into the dated reflections and observations below. Treat these " +
      "as an authoritative record of what already happened — do not redo " +
      "completed work, and trust the recorded decisions, names, dates, and " +
      "status. The most recent turns follow verbatim after this block.",
  );
  if (context.reflections.length > 0) {
    sections.push(
      "## Reflections (highest-level)\n" +
        context.reflections.map((entry) => entry.text).join("\n\n"),
    );
  }
  if (context.observations.length > 0) {
    sections.push(
      "## Observations (dense, dated)\n" +
        context.observations.map((entry) => entry.text).join("\n\n"),
    );
  }
  return sections.join("\n\n");
}

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
