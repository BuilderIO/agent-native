import { getThread } from "../../chat-threads/store.js";
import type { EngineMessage } from "../engine/types.js";
import { threadDataToEngineMessages } from "../thread-data-builder.js";
import {
  resolveObservationalMemoryConfig,
  type ObservationalMemoryConfig,
} from "./config.js";
import type { InternalAgentRunFn } from "./internal-run.js";
import { countWindowTokens } from "./message-text.js";
import { runObserver, type RunObserverResult } from "./observer.js";
import { runReflector, type RunReflectorResult } from "./reflector.js";
import { getObservedThroughIndex } from "./store.js";
import type { ObservationalMemoryOwner } from "./types.js";

export interface MaybeCompactThreadOptions extends ObservationalMemoryOwner {
  threadId: string;
  messages?: EngineMessage[];
  config?: Partial<ObservationalMemoryConfig>;
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

export interface ThreadCompactionStatus {
  /** Tokens in messages the Observer has not compacted yet. */
  unobservedTokens: number;
  /** The post-turn pass compacts once `unobservedTokens` reaches this. */
  observationTokenThreshold: number;
  /**
   * Undefined when the observation cursor is past the stored thread, so the
   * next automatic pass cannot be predicted from this thread's messages.
   */
  tokensUntilAutoCompact?: number;
}

export async function getThreadCompactionStatus(
  options: ObservationalMemoryOwner & {
    threadId: string;
    messages?: EngineMessage[];
    config?: Partial<ObservationalMemoryConfig>;
  },
): Promise<ThreadCompactionStatus> {
  const config = resolveObservationalMemoryConfig(options.config);
  const messages =
    options.messages ?? (await loadThreadMessages(options.threadId));
  const observedThrough = await getObservedThroughIndex({
    ownerEmail: options.ownerEmail,
    orgId: options.orgId ?? null,
    threadId: options.threadId,
  });
  const threshold = config.observationTokenThreshold;
  if (observedThrough + 1 > messages.length) {
    return { unobservedTokens: 0, observationTokenThreshold: threshold };
  }
  const unobservedTokens = await countWindowTokens(
    messages.slice(observedThrough + 1),
  );
  return {
    unobservedTokens,
    observationTokenThreshold: threshold,
    tokensUntilAutoCompact: Math.max(0, threshold - unobservedTokens),
  };
}

/**
 * Compact a thread now instead of waiting for the post-turn threshold: any
 * unobserved message is observed, and the Reflector runs under its usual
 * threshold. The next model call reads the result, so a manifest computed
 * before then still shows the old size.
 */
export async function compactThreadNow(
  options: Omit<MaybeCompactThreadOptions, "config">,
): Promise<MaybeCompactThreadResult> {
  return maybeCompactThread({
    ...options,
    config: { observationTokenThreshold: 1 },
  });
}
