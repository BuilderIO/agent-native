/**
 * The Observer.
 *
 * When a thread's UNOBSERVED messages exceed the observation token threshold,
 * the Observer runs ONE internal (tool-less) agent call to compress that window
 * into a dense, dated observation log, persists it as a `tier: "observation"`
 * entry, and marks those messages observed (recorded via the entry's
 * `sourceEndIndex`, which `getObservedThroughIndex` reads back).
 *
 * It does NOT touch the agent loop — the internal call goes through the shared
 * `runInternalAgentCall` seam (provider-agnostic, mockable).
 */

import { countTextTokens } from "../context-xray/tokenize.js";
import type { EngineMessage } from "../engine/types.js";
import {
  resolveObservationalMemoryConfig,
  type ObservationalMemoryConfig,
} from "./config.js";
import {
  runInternalAgentCall,
  type InternalAgentRunFn,
} from "./internal-run.js";
import { countWindowTokens, windowToText } from "./message-text.js";
import { OBSERVER_SYSTEM_PROMPT, buildObserverPrompt } from "./prompts.js";
import {
  getObservedThroughIndex,
  insertObservationalMemory,
  listObservationalMemory,
} from "./store.js";
import type {
  ObservationalMemoryEntry,
  ObservationalMemoryOwner,
} from "./types.js";

export interface RunObserverOptions extends ObservationalMemoryOwner {
  threadId: string;
  /** The full, ordered thread messages. */
  messages: EngineMessage[];
  config?: Partial<ObservationalMemoryConfig>;
  /** Internal-run seam — defaults to the real one; injected in tests. */
  runInternal?: InternalAgentRunFn;
}

export interface RunObserverResult {
  /** True when an observation was produced and persisted. */
  observed: boolean;
  entry?: ObservationalMemoryEntry;
  /** Tokens in the unobserved window that was considered. */
  unobservedTokens: number;
}

/**
 * Compact a thread's unobserved tail into an observation IF it exceeds the
 * token threshold; otherwise no-op.
 */
export async function runObserver(
  options: RunObserverOptions,
): Promise<RunObserverResult> {
  const config = resolveObservationalMemoryConfig(options.config);
  const owner: ObservationalMemoryOwner = {
    ownerEmail: options.ownerEmail,
    orgId: options.orgId ?? null,
  };

  const observedThrough = await getObservedThroughIndex({
    ...owner,
    threadId: options.threadId,
  });
  const startIndex = observedThrough + 1;
  const unobserved = options.messages.slice(startIndex);
  if (unobserved.length === 0) {
    return { observed: false, unobservedTokens: 0 };
  }

  const unobservedTokens = await countWindowTokens(unobserved);
  if (unobservedTokens < config.observationTokenThreshold) {
    return { observed: false, unobservedTokens };
  }

  const windowText = windowToText(unobserved);
  if (!windowText.trim()) {
    return { observed: false, unobservedTokens };
  }

  // Feed prior observations as continuity context so the new log doesn't repeat
  // already-compacted history.
  const priorObservations = (
    await listObservationalMemory({
      ...owner,
      threadId: options.threadId,
      tier: "observation",
    })
  )
    .map((entry) => entry.text)
    .join("\n\n");

  const run = options.runInternal ?? runInternalAgentCall;
  const observationText = await run({
    systemPrompt: OBSERVER_SYSTEM_PROMPT,
    prompt: buildObserverPrompt({
      threadId: options.threadId,
      windowText,
      priorObservations,
    }),
    maxOutputTokens: config.observationMaxOutputTokens,
  });

  if (!observationText.trim()) {
    return { observed: false, unobservedTokens };
  }

  const { tokens: tokenEstimate } = await countTextTokens(observationText);
  const endIndex = options.messages.length - 1;

  const entry = await insertObservationalMemory({
    ...owner,
    threadId: options.threadId,
    tier: "observation",
    text: observationText,
    tokenEstimate,
    sourceStartIndex: startIndex,
    sourceEndIndex: endIndex,
    sourceMessageCount: unobserved.length,
  });

  return { observed: true, entry, unobservedTokens };
}
