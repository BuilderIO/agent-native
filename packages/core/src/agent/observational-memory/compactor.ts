
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
