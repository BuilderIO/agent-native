import { countTextTokens } from "../context-xray/tokenize.js";
import {
  resolveObservationalMemoryConfig,
  type ObservationalMemoryConfig,
} from "./config.js";
import {
  runInternalAgentCall,
  type InternalAgentRunFn,
} from "./internal-run.js";
import { REFLECTOR_SYSTEM_PROMPT, buildReflectorPrompt } from "./prompts.js";
import {
  getObservationLogTokens,
  insertObservationalMemory,
  listObservationalMemory,
} from "./store.js";
import type {
  ObservationalMemoryEntry,
  ObservationalMemoryOwner,
} from "./types.js";

export interface RunReflectorOptions extends ObservationalMemoryOwner {
  threadId: string;
  config?: Partial<ObservationalMemoryConfig>;
  runInternal?: InternalAgentRunFn;
}

export interface RunReflectorResult {
  reflected: boolean;
  entry?: ObservationalMemoryEntry;
  observationLogTokens: number;
}

export async function runReflector(
  options: RunReflectorOptions,
): Promise<RunReflectorResult> {
  const config = resolveObservationalMemoryConfig(options.config);
  const owner: ObservationalMemoryOwner = {
    ownerEmail: options.ownerEmail,
    orgId: options.orgId ?? null,
  };

  const observationLogTokens = await getObservationLogTokens({
    ...owner,
    threadId: options.threadId,
  });
  if (observationLogTokens < config.reflectionTokenThreshold) {
    return { reflected: false, observationLogTokens };
  }

  const observations = await listObservationalMemory({
    ...owner,
    threadId: options.threadId,
    tier: "observation",
  });
  if (observations.length === 0) {
    return { reflected: false, observationLogTokens };
  }
  const observationsText = observations.map((entry) => entry.text).join("\n\n");

  const priorReflections = (
    await listObservationalMemory({
      ...owner,
      threadId: options.threadId,
      tier: "reflection",
    })
  )
    .map((entry) => entry.text)
    .join("\n\n");

  const run = options.runInternal ?? runInternalAgentCall;
  const reflectionText = await run({
    systemPrompt: REFLECTOR_SYSTEM_PROMPT,
    prompt: buildReflectorPrompt({
      threadId: options.threadId,
      observationsText,
      priorReflections,
    }),
    maxOutputTokens: config.reflectionMaxOutputTokens,
  });

  if (!reflectionText.trim()) {
    return { reflected: false, observationLogTokens };
  }

  const { tokens: tokenEstimate } = await countTextTokens(reflectionText);
  const sourceStart = observations[0]?.sourceStartIndex ?? null;
  const sourceEnd =
    observations[observations.length - 1]?.sourceEndIndex ?? null;

  const entry = await insertObservationalMemory({
    ...owner,
    threadId: options.threadId,
    tier: "reflection",
    text: reflectionText,
    tokenEstimate,
    sourceStartIndex: sourceStart,
    sourceEndIndex: sourceEnd,
    sourceMessageCount: observations.length,
  });

  return { reflected: true, entry, observationLogTokens };
}
