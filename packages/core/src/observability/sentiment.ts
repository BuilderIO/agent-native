import type { AgentEngine, EngineEvent } from "../agent/engine/types.js";
import { observabilityConfig } from "../app-config/observability.js";
import { trackingIdentityProperties } from "./tracking-identity.js";
import type { ObservabilityConfig } from "./types.js";

const DEFAULT_INFERRED_SENTIMENT_MODEL =
  observabilityConfig.shape.inferredSentimentModel.parse(undefined);

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
      envModel || storedModel || DEFAULT_INFERRED_SENTIMENT_MODEL,
  };
}

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

export const INFERRED_SENTIMENT_FAILURE_REASONS = [
  "engine_unavailable",
  "model_unsupported",
  "timeout",
  "parse_failed",
  "empty",
] as const;

export type InferredSentimentFailureReason =
  (typeof INFERRED_SENTIMENT_FAILURE_REASONS)[number];

type SentimentClassification =
  | { sentiment: InferredSentiment }
  | { failure: InferredSentimentFailureReason };

function engineCanRun(engine: AgentEngine, model: string): boolean {
  return (
    engine.preserveCustomModels === true ||
    engine.supportedModels.length === 0 ||
    engine.supportedModels.includes(model)
  );
}

// Codes an engine puts on a stop event or EngineError when the gateway or
// provider refuses the model itself. `builder_model_unauthorized` is
// BUILDER_MODEL_UNAUTHORIZED_ERROR_CODE; builder-engine is imported lazily here.
const MODEL_REJECTION_ERROR_CODES = new Set([
  "builder_model_unauthorized",
  "model_not_found",
  "not_found_error",
]);

// A rejected model is a configuration error to fix, not an outage to retry, so
// it must not be counted as `engine_unavailable`.
function engineFailureReason(
  errorCode: unknown,
): "engine_unavailable" | "model_unsupported" {
  return typeof errorCode === "string" &&
    MODEL_REJECTION_ERROR_CODES.has(errorCode.trim().toLowerCase())
    ? "model_unsupported"
    : "engine_unavailable";
}

function thrownErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "errorCode" in error
    ? error.errorCode
    : undefined;
}

async function classifySentiment(args: {
  engine: AgentEngine;
  model: string;
  text: string;
}): Promise<SentimentClassification> {
  // The engine is up but does not list the model: a configuration error, not
  // an outage, so it must not read as `engine_unavailable`.
  if (!engineCanRun(args.engine, args.model)) {
    return { failure: "model_unsupported" };
  }

  const input = truncateInput(args.text);
  if (!input) return { failure: "empty" };

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, INFERRED_SENTIMENT_TIMEOUT_MS);
  let output = "";
  let finalOutput = "";
  const interrupted = (errorCode?: unknown): SentimentClassification => ({
    failure: timedOut ? "timeout" : engineFailureReason(errorCode),
  });
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
        return interrupted(typedEvent.errorCode);
      }
    }
  } catch (error) {
    return interrupted(thrownErrorCode(error));
  } finally {
    clearTimeout(timeout);
  }
  // An aborted stream can end quietly; its partial text is not a verdict.
  if (timedOut) return { failure: "timeout" };
  const verdict = (finalOutput || output).trim();
  if (!verdict) return { failure: "empty" };
  const sentiment = parseInferredSentiment(verdict);
  return sentiment ? { sentiment } : { failure: "parse_failed" };
}

/**
 * The run's own engine when it can serve the classifier model, so a Builder run
 * classifies with the credentials it already holds. Otherwise the hosted
 * Builder engine; `null` when that cannot even be constructed.
 */
async function resolveClassifierEngine(args: {
  engine?: AgentEngine;
  runEngine?: AgentEngine;
  classifierModel: string;
}): Promise<AgentEngine | null> {
  if (args.engine) return args.engine;
  if (args.runEngine && engineCanRun(args.runEngine, args.classifierModel)) {
    return args.runEngine;
  }
  try {
    return (
      await import("../agent/engine/builder-engine.js")
    ).createBuilderEngine();
    // coercion-ok: the caller reports a null engine as `engine_unavailable`.
  } catch {
    return null;
  }
}

export async function inferAndTrackSentiment(args: {
  /** Explicit engine override; wins over `runEngine`. */
  engine?: AgentEngine;
  /** The engine that served the run being classified. */
  runEngine?: AgentEngine;
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
    const engine = await resolveClassifierEngine(args);
    const result: SentimentClassification = engine
      ? await classifySentiment({
          engine,
          model: args.classifierModel,
          text: args.text,
        })
      : { failure: "engine_unavailable" };

    const { track } = await import("../tracking/registry.js");
    const shared = {
      ...trackingIdentityProperties(),
      source: "agent_observability",
      method: "llm",
      model: args.precedingResponseModel,
      classifier_model: args.classifierModel,
      classifier_engine: engine?.name,
      run_id: args.precedingRunId,
      classification_trigger_run_id: args.classificationTriggerRunId,
      thread_id: args.threadId,
      $ai_model: args.precedingResponseModel,
      $ai_trace_id: args.precedingRunId,
      $ai_session_id: args.threadId ?? undefined,
    };
    // A classifier that fails must show up as a count, never as a quiet drop
    // in `$ai_sentiment`; the reason is coarse and carries no message content.
    track(
      "failure" in result ? "$ai_sentiment_failed" : "$ai_sentiment",
      "failure" in result
        ? { ...shared, reason: result.failure }
        : {
            ...shared,
            sentiment: result.sentiment,
            attribution: "user_reaction_to_preceding_model",
          },
      { userId: args.userId ?? undefined },
    );
  } catch (error) {
    // Optional inference must never affect chat, but an unexpected failure
    // outside the classifier must not vanish either.
    console.warn(
      "[agent-native] observability: sentiment inference failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
