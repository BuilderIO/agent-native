import type { AgentEngine, EngineEvent } from "../agent/engine/types.js";
import { trackingIdentityProperties } from "./tracking-identity.js";
import type { ObservabilityConfig } from "./types.js";
import { DEFAULT_OBSERVABILITY_CONFIG } from "./types.js";

export const DEFAULT_INFERRED_SENTIMENT_MODEL = "gpt-5-6-luna";
export const HOSTED_INFERRED_SENTIMENT_SAMPLE_RATE = 1;
export const INFERRED_SENTIMENT_MAX_CHARS = 2_000;
export const INFERRED_SENTIMENT_TIMEOUT_MS = 5_000;

export type InferredSentiment = "positive" | "negative" | "neutral";

type SentimentEnv = Record<string, string | undefined>;

const ENABLED_VALUES = new Set(["1", "true", "on", "yes"]);
const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);
const FIRST_PARTY_HOST_SUFFIX = ".agent-native.com";

function hostnameFromUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isFirstPartyHostedAgentNative(
  env: SentimentEnv = process.env,
): boolean {
  return [
    env.APP_URL,
    env.BETTER_AUTH_URL,
    env.URL,
    env.DEPLOY_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ]
    .map(hostnameFromUrl)
    .some(
      (hostname) =>
        hostname === "agent-native.com" ||
        Boolean(hostname?.endsWith(FIRST_PARTY_HOST_SUFFIX)),
    );
}

function parseBooleanOverride(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (ENABLED_VALUES.has(normalized)) return true;
  if (DISABLED_VALUES.has(normalized)) return false;
  return undefined;
}

function parseSampleRate(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * Resolve inference defaults without making self-hosted apps opt in silently.
 * Explicit opt-out always wins. Otherwise stored app config and deployment
 * env can override the first-party hosted default.
 */
export function resolveInferredSentimentConfig(
  stored: Partial<ObservabilityConfig> | null | undefined,
  env: SentimentEnv = process.env,
): Pick<
  ObservabilityConfig,
  | "inferredSentimentEnabled"
  | "inferredSentimentSampleRate"
  | "inferredSentimentModel"
> {
  const hosted = isFirstPartyHostedAgentNative(env);
  const storedRate = parseSampleRate(stored?.inferredSentimentSampleRate);
  const envRate = parseSampleRate(
    env.AGENT_NATIVE_INFERRED_SENTIMENT_SAMPLE_RATE,
  );
  const envEnabled = parseBooleanOverride(env.AGENT_NATIVE_INFERRED_SENTIMENT);
  const storedModel = stored?.inferredSentimentModel?.trim();
  const envModel = env.AGENT_NATIVE_INFERRED_SENTIMENT_MODEL?.trim();

  return {
    inferredSentimentEnabled:
      envEnabled === false || stored?.inferredSentimentEnabled === false
        ? false
        : (envEnabled ?? stored?.inferredSentimentEnabled ?? hosted),
    inferredSentimentSampleRate:
      envRate ??
      storedRate ??
      (hosted ? HOSTED_INFERRED_SENTIMENT_SAMPLE_RATE : 0),
    inferredSentimentModel:
      envModel ||
      storedModel ||
      DEFAULT_OBSERVABILITY_CONFIG.inferredSentimentModel,
  };
}

/** Stable deterministic sampling keeps retries for the same run consistent. */
export function shouldSampleInferredSentiment(
  runId: string,
  sampleRate: number,
): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  let hash = 0x811c9dc5;
  for (let index = 0; index < runId.length; index += 1) {
    hash ^= runId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000 < sampleRate;
}

export function shouldInferSentimentForTurn(args: {
  internalContinuation: boolean;
  isBackgroundWorker: boolean;
  backgroundContinuationCount: number;
  hasUserText: boolean;
}): boolean {
  if (!args.hasUserText || args.internalContinuation) return false;
  return !args.isBackgroundWorker || args.backgroundContinuationCount === 0;
}

export function parseInferredSentiment(
  output: string,
): InferredSentiment | null {
  const normalized = output.trim().toLowerCase();
  return normalized === "positive" ||
    normalized === "negative" ||
    normalized === "neutral"
    ? normalized
    : null;
}

function truncateInput(text: string): string {
  return Array.from(text.trim())
    .slice(0, INFERRED_SENTIMENT_MAX_CHARS)
    .join("");
}

async function classifySentiment(args: {
  engine: AgentEngine;
  model: string;
  text: string;
}): Promise<InferredSentiment | null> {
  if (
    !args.engine.preserveCustomModels &&
    args.engine.supportedModels.length > 0 &&
    !args.engine.supportedModels.includes(args.model)
  ) {
    return null;
  }

  const input = truncateInput(args.text);
  if (!input) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    INFERRED_SENTIMENT_TIMEOUT_MS,
  );
  let output = "";
  let finalOutput = "";
  try {
    for await (const event of args.engine.stream({
      model: args.model,
      systemPrompt:
        "Classify the user's emotional sentiment. Reply with exactly one lowercase word: positive, negative, or neutral.",
      messages: [{ role: "user", content: [{ type: "text", text: input }] }],
      tools: [],
      abortSignal: controller.signal,
      maxOutputTokens: 8,
      temperature: 0,
      reasoningEffort: "low",
    })) {
      const typedEvent = event as EngineEvent;
      if (typedEvent.type === "text-delta") output += typedEvent.text;
      if (typedEvent.type === "assistant-content") {
        finalOutput = typedEvent.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
      }
      if (typedEvent.type === "stop" && typedEvent.reason === "error") {
        return null;
      }
    }
    return parseInferredSentiment(finalOutput || output);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Best-effort classifier + content-free tracking emit. The main chat path
 * awaits this only after the user-visible response has finished streaming.
 */
export async function inferAndTrackSentiment(args: {
  /** Test/custom seam. Production intentionally uses the managed Builder engine. */
  engine?: AgentEngine;
  classifierModel: string;
  precedingResponseModel: string;
  text: string;
  precedingRunId: string;
  classificationTriggerRunId: string;
  threadId: string | null;
  userId: string | null;
  sampleRate: number;
}): Promise<void> {
  try {
    if (
      !shouldSampleInferredSentiment(
        args.classificationTriggerRunId,
        args.sampleRate,
      )
    ) {
      return;
    }
    const engine =
      args.engine ??
      (await import("../agent/engine/builder-engine.js")).createBuilderEngine();
    const sentiment = await classifySentiment({
      engine,
      model: args.classifierModel,
      text: args.text,
    });
    if (!sentiment) return;

    const { track } = await import("../tracking/registry.js");
    track(
      "$ai_sentiment",
      {
        ...trackingIdentityProperties(),
        source: "agent_observability",
        method: "llm",
        sentiment,
        model: args.precedingResponseModel,
        classifier_model: args.classifierModel,
        classifier_engine: engine.name,
        attribution: "user_reaction_to_preceding_model",
        run_id: args.precedingRunId,
        classification_trigger_run_id: args.classificationTriggerRunId,
        thread_id: args.threadId,
        $ai_model: args.precedingResponseModel,
        $ai_trace_id: args.precedingRunId,
        $ai_session_id: args.threadId ?? undefined,
      },
      { userId: args.userId ?? undefined },
    );
  } catch {
    // Inference and analytics are both optional and must never affect chat.
  }
}
