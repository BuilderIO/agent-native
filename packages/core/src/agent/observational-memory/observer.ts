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
  messages: EngineMessage[];
  config?: Partial<ObservationalMemoryConfig>;
  runInternal?: InternalAgentRunFn;
}

export interface RunObserverResult {
  observed: boolean;
  entry?: ObservationalMemoryEntry;
  unobservedTokens: number;
}

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
  if (startIndex > options.messages.length) {
    console.warn(
      `[observational-memory] thread ${options.threadId}: cursor ${observedThrough} is past the end of this ${options.messages.length}-message window, so nothing can be observed on this basis.`,
    );
    return { observed: false, unobservedTokens: 0 };
  }
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
