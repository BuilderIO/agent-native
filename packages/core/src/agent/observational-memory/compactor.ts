/**
 * Compactor orchestration for Observational Memory.
 *
 * `maybeCompactThread` is the single, decoupled entry point the agent loop can
 * call AFTER a turn: it runs the Observer (which no-ops below the observation
 * threshold) and then the Reflector (which no-ops below the reflection
 * threshold). It is intentionally NOT wired into production-agent.ts here — it
 * is exported so the loop can call it later.
 *
 * Messages can be supplied directly (the loop already has them) or loaded from
 * the chat-threads store by `threadId` via the persisted `thread_data`. Loading
 * goes through the existing `threadDataToEngineMessages` reader so OM never
 * reimplements thread parsing.
 */

import { getThread } from "../../chat-threads/store.js";
import type { EngineMessage } from "../engine/types.js";
import { threadDataToEngineMessages } from "../thread-data-builder.js";
import type { ObservationalMemoryConfig } from "./config.js";
import type { InternalAgentRunFn } from "./internal-run.js";
import { runObserver, type RunObserverResult } from "./observer.js";
import { runReflector, type RunReflectorResult } from "./reflector.js";
import type { ObservationalMemoryOwner } from "./types.js";

export interface MaybeCompactThreadOptions extends ObservationalMemoryOwner {
  threadId: string;
  /**
   * The full, ordered thread messages. When omitted, they are loaded from the
   * chat-threads store by `threadId`.
   */
  messages?: EngineMessage[];
  config?: Partial<ObservationalMemoryConfig>;
  /** Internal-run seam — defaults to the real one; injected in tests. */
  runInternal?: InternalAgentRunFn;
}

export interface MaybeCompactThreadResult {
  observer: RunObserverResult;
  reflector: RunReflectorResult;
}

async function loadThreadMessages(threadId: string): Promise<EngineMessage[]> {
  const thread = await getThread(threadId);
  if (!thread?.threadData) return [];
  return threadDataToEngineMessages(thread.threadData);
}

/**
 * Run a full compaction pass for a thread. Observer first (may fold the
 * unobserved tail into an observation), then Reflector (may condense the
 * observation log into a reflection). Both are no-ops below their thresholds,
 * so this is cheap to call after every turn.
 */
export async function maybeCompactThread(
  options: MaybeCompactThreadOptions,
): Promise<MaybeCompactThreadResult> {
  const messages =
    options.messages ?? (await loadThreadMessages(options.threadId));

  const observer = await runObserver({
    ownerEmail: options.ownerEmail,
    orgId: options.orgId ?? null,
    threadId: options.threadId,
    messages,
    config: options.config,
    runInternal: options.runInternal,
  });

  const reflector = await runReflector({
    ownerEmail: options.ownerEmail,
    orgId: options.orgId ?? null,
    threadId: options.threadId,
    config: options.config,
    runInternal: options.runInternal,
  });

  return { observer, reflector };
}
