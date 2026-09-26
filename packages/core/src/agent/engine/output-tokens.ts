import { getAppConfig } from "../../app-config/index.js";
import { getMaxOutputTokensForModel } from "../model-config.js";

const MIN_MAX_OUTPUT_TOKENS = 256;

export const DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_BUILDER_MAX_OUTPUT_TOKENS = 8192;



export const MAIN_CHAT_MAX_OUTPUT_TOKENS_CAP = 64_000;
export const EMPTY_RESPONSE_RETRY_MAX_OUTPUT_TOKENS_CAP = 128_000;

export function resolveMainChatMaxOutputTokens(modelId?: string): number {
  return Math.min(
    getMaxOutputTokensForModel(modelId),
    getAppConfig().agent.mainChatMaxOutputTokens,
  );
}

export function resolveEmptyResponseRetryMaxOutputTokens(
  modelId?: string,
): number {
  const { mainChatMaxOutputTokens, emptyResponseRetryMaxOutputTokens } =
    getAppConfig().agent;
  return Math.min(
    getMaxOutputTokensForModel(modelId),
    Math.max(emptyResponseRetryMaxOutputTokens, mainChatMaxOutputTokens),
  );
}


export const ANTHROPIC_MIN_THINKING_BUDGET_TOKENS = 1024;

export function clampThinkingBudgetTokens(
  requestedBudgetTokens: number,
  maxOutputTokens: number,
): number | undefined {
  if (maxOutputTokens <= ANTHROPIC_MIN_THINKING_BUDGET_TOKENS) {
    return undefined;
  }
  const headroom = Math.max(8000, Math.round(0.4 * maxOutputTokens));
  const budgetCapForHeadroom = Math.max(
    ANTHROPIC_MIN_THINKING_BUDGET_TOKENS,
    maxOutputTokens - headroom,
  );
  const strictUpperBound = maxOutputTokens - 1;
  return Math.max(
    ANTHROPIC_MIN_THINKING_BUDGET_TOKENS,
    Math.min(requestedBudgetTokens, budgetCapForHeadroom, strictUpperBound),
  );
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;
  if (n == null || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

export function normalizeMaxOutputTokens(
  value: unknown,
  modelId?: string,
): number | null {
  const parsed = parsePositiveInteger(value);
  if (parsed == null) return null;
  return Math.min(
    getMaxOutputTokensForModel(modelId),
    Math.max(MIN_MAX_OUTPUT_TOKENS, parsed),
  );
}

function providerEnvOverride(
  engineName: string,
  modelId?: string,
): number | null {
  const provider = engineName.startsWith("ai-sdk:")
    ? engineName.slice("ai-sdk:".length)
    : engineName;
  const providerEnvKey = `AGENT_${provider
    .replace(/[^a-z0-9]+/gi, "_")
    .toUpperCase()}_MAX_OUTPUT_TOKENS`;
  // guard:allow-env-credential — output-token cap config, not a credential
  return normalizeMaxOutputTokens(process.env[providerEnvKey], modelId);
}

export function defaultMaxOutputTokensForEngine(
  engineName: string,
  modelId?: string,
): number {
  const providerOverride = providerEnvOverride(engineName, modelId);
  if (providerOverride != null) return providerOverride;

  const configured = normalizeMaxOutputTokens(
    getAppConfig().agent.maxOutputTokens,
    modelId,
  );
  if (configured != null) return configured;

  if (engineName === "builder") return DEFAULT_BUILDER_MAX_OUTPUT_TOKENS;
  if (engineName === "anthropic" || engineName === "ai-sdk:anthropic") {
    return DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS;
  }
  if (engineName === "ai-sdk:openrouter") {
    return DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS;
  }
  if (engineName.startsWith("ai-sdk:")) {
    return DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS;
  }
  return DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS;
}

export function resolveMaxOutputTokensForEngine(
  engineName: string,
  explicit?: unknown,
  modelId?: string,
): number {
  return (
    normalizeMaxOutputTokens(explicit, modelId) ??
    defaultMaxOutputTokensForEngine(engineName, modelId)
  );
}
