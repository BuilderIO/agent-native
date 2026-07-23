/**
 * Central model catalog for built-in agent engines.
 *
 * To bump the framework's managed default, update the Anthropic/OpenAI
 * constants below. Builder gateway and OpenRouter IDs are derived here so the
 * usual default bump stays in one file.
 */

// ---------------------------------------------------------------------------
// Per-model context window table (input token limit)
//
// Sources (June 2026):
//  Anthropic  https://platform.claude.com/docs/en/about-claude/models/overview
//  OpenAI     https://developers.openai.com/api/docs/models/gpt-5.6
//  Google     https://ai.google.dev/gemini-api/docs/models
//  OpenRouter https://openrouter.ai/api/v1/models
//
// Family defaults (used when a model id isn't listed explicitly):
//  claude-*        → 200_000  (Haiku 4.5 and earlier models)
//  gpt-5*          → 1_050_000 (GPT-5.6 Sol/Terra flagship context)
//  gemini-2* / gemini-3* → 1_048_576
//  everything else → 128_000  (safe conservative floor)
//
// Note: Fable 5, Sonnet 5, Sonnet 4.6, and Opus 4.6/4.7/4.8 support 1M via the API
// at standard prices.
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // ── Anthropic / Claude (via Builder gateway or Anthropic direct) ──────────
  "claude-fable-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,

  // ── Builder gateway OpenAI IDs (dot→dash) ────────────────────────────────
  "gpt-5-6-sol": 1_050_000,
  "gpt-5-6-terra": 1_050_000,
  "gpt-5-6-luna": 400_000,

  // ── Gemini (Builder gateway IDs) ─────────────────────────────────────────
  "gemini-3-1-pro": 1_048_576,
  "gemini-3-5-flash": 1_048_576,
  "gemini-3-1-flash-lite": 1_048_576,

  // ── OpenRouter model IDs ──────────────────────────────────────────────────
  "anthropic/claude-fable-5": 1_000_000,
  "anthropic/claude-opus-4.8": 1_000_000,
  "anthropic/claude-opus-4.7": 1_000_000,
  "anthropic/claude-sonnet-5": 1_000_000,
  "anthropic/claude-sonnet-4.6": 1_000_000,
  "openai/gpt-5.6-sol": 1_050_000,
  "openai/gpt-5.6-terra": 1_050_000,
  "openai/gpt-5.6-luna": 1_050_000,
  "google/gemini-2.5-flash": 1_048_576,
  "z-ai/glm-5.2": 1_048_576,

  // ── AI-SDK native OpenAI IDs ──────────────────────────────────────────────
  "gpt-5.6-sol": 1_050_000,
  "gpt-5.6-terra": 1_050_000,
  "gpt-5.6-luna": 400_000,

  // ── AI-SDK native Google IDs ──────────────────────────────────────────────
  "gemini-3.5-flash": 1_048_576,
  "gemini-3.1-pro-preview": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
};

/** Conservative safe default when a model is not in the table. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Return the known input-token context window for the given model ID.
 *
 * Uses an exact-match table first, then falls back to family-prefix heuristics,
 * then a conservative 128 K default.  Never throws — always returns a positive
 * integer.
 */
export function getContextWindowForModel(modelId: string): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;

  const exact = MODEL_CONTEXT_WINDOWS[modelId];
  if (exact !== undefined) return exact;

  // Family heuristics for unlisted model IDs
  const id = modelId.toLowerCase();

  // Anthropic Fable 5, Opus 4.x, Sonnet 5, and Sonnet 4.6 = 1M
  if (
    id === "claude-fable-5" ||
    id.includes("claude-fable-5") ||
    id.startsWith("claude-opus-4") ||
    id.includes("claude-sonnet-5") ||
    id.includes("claude-sonnet-4-6") ||
    id.includes("claude-sonnet-4.6")
  )
    return 1_000_000;

  // All other Claude models — default 200K
  if (id.startsWith("claude-")) return 200_000;

  // GPT-5.x family — 1.05M
  if (id.startsWith("gpt-5") || id.startsWith("openai/gpt-5")) return 1_050_000;

  // Gemini 2.x / 3.x — 1M
  if (
    id.startsWith("gemini-2") ||
    id.startsWith("gemini-3") ||
    id.includes("/gemini-2") ||
    id.includes("/gemini-3")
  )
    return 1_048_576;

  // Z.ai GLM 5.x on OpenRouter — 1M context.
  if (id.startsWith("glm-5") || id.includes("/glm-5")) return 1_048_576;

  return DEFAULT_CONTEXT_WINDOW;
}

// ---------------------------------------------------------------------------
// Per-model max output token table (documented output-token ceilings)
//
// Sources (July 2026):
//  Anthropic  https://platform.claude.com/docs/en/docs/about-claude/models/overview
//             (Fable 5 / Opus 4.8 / Opus 4.7 / Sonnet 5 / Sonnet 4.6 = 128K;
//              Haiku 4.5 / Sonnet 4.5 / Opus 4.5 = 64K)
//  OpenAI     https://developers.openai.com/api/docs/models/gpt-5.6
//             (GPT-5.6 Sol / Terra / Luna = 40K)
//
// Family defaults (used when a model id isn't listed explicitly):
//  claude flagship (fable-5 / opus-4.6+ / sonnet-5 / sonnet-4.6) → 128_000
//  claude-* (Haiku 4.5, older/unknown Claude ids)                → 64_000
//  gpt-5*                                                        → 128_000 (safe fallback)
//  everything else                                               → 64_000
//    (safe conservative ceiling that matches the previous global clamp)
// ---------------------------------------------------------------------------

const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  // ── Anthropic / Claude (via Builder gateway or Anthropic direct) ──────────
  "claude-fable-5": 128_000,
  "claude-opus-4-8": 128_000,
  "claude-opus-4-7": 128_000,
  "claude-sonnet-5": 128_000,
  "claude-sonnet-4-6": 128_000,
  "claude-haiku-4-5": 64_000,
  "claude-haiku-4-5-20251001": 64_000,

  // ── Builder gateway OpenAI IDs (dot→dash) ────────────────────────────────
  "gpt-5-6-sol": 40_000,
  "gpt-5-6-terra": 40_000,
  "gpt-5-6-luna": 40_000,

  // ── OpenRouter model IDs ──────────────────────────────────────────────────
  "anthropic/claude-fable-5": 128_000,
  "anthropic/claude-opus-4.8": 128_000,
  "anthropic/claude-opus-4.7": 128_000,
  "anthropic/claude-sonnet-5": 128_000,
  "anthropic/claude-sonnet-4.6": 128_000,
  "openai/gpt-5.6-sol": 40_000,
  "openai/gpt-5.6-terra": 40_000,
  "openai/gpt-5.6-luna": 128_000,

  // ── AI-SDK native OpenAI IDs ──────────────────────────────────────────────
  "gpt-5.6-sol": 40_000,
  "gpt-5.6-terra": 40_000,
  "gpt-5.6-luna": 40_000,
};

/**
 * Conservative safe ceiling when a model is not in the table (matches the
 * previous global output-token clamp, and current Claude Haiku 4.5 limits).
 */
const DEFAULT_MAX_OUTPUT_TOKENS_CEILING = 64_000;

/**
 * Return the documented max output-token ceiling for the given model ID.
 *
 * Uses an exact-match table first, then falls back to family-prefix
 * heuristics, then a conservative 64 K default. Never throws — always returns
 * a positive integer.
 */
export function getMaxOutputTokensForModel(
  modelId: string | undefined,
): number {
  if (!modelId) return DEFAULT_MAX_OUTPUT_TOKENS_CEILING;

  const exact = MODEL_MAX_OUTPUT_TOKENS[modelId];
  if (exact !== undefined) return exact;

  // Family heuristics for unlisted model IDs
  const id = modelId.toLowerCase();

  // Anthropic Fable 5, Opus 4.6+, Sonnet 5, and Sonnet 4.6 = 128K output
  if (
    id.includes("claude-fable-5") ||
    id.includes("claude-opus-4-6") ||
    id.includes("claude-opus-4.6") ||
    id.includes("claude-opus-4-7") ||
    id.includes("claude-opus-4.7") ||
    id.includes("claude-opus-4-8") ||
    id.includes("claude-opus-4.8") ||
    id.includes("claude-sonnet-5") ||
    id.includes("claude-sonnet-4-6") ||
    id.includes("claude-sonnet-4.6")
  )
    return 128_000;

  // All other Claude models (Haiku 4.5, legacy) — 64K ceiling
  if (id.startsWith("claude-") || id.includes("/claude-")) {
    return DEFAULT_MAX_OUTPUT_TOKENS_CEILING;
  }

  // GPT-5.x family — 128K output
  if (id.startsWith("gpt-5") || id.startsWith("openai/gpt-5")) return 128_000;

  return DEFAULT_MAX_OUTPUT_TOKENS_CEILING;
}

const ENABLE_CLAUDE_SONNET_5 = true;

export const CLAUDE_SONNET_MODEL_ID = ENABLE_CLAUDE_SONNET_5
  ? "claude-sonnet-5"
  : "claude-sonnet-4-6";
export const CLAUDE_SONNET_MODEL_LABEL = ENABLE_CLAUDE_SONNET_5
  ? "Claude Sonnet 5"
  : "Claude Sonnet 4.6";

const OPENROUTER_CLAUDE_SONNET_MODEL_ID = ENABLE_CLAUDE_SONNET_5
  ? "anthropic/claude-sonnet-5"
  : "anthropic/claude-sonnet-4.6";

const ANTHROPIC_DEFAULT_MODEL_ID = CLAUDE_SONNET_MODEL_ID;

function builderGatewayModelId(model: string): string {
  return model.replace(/\./g, "-");
}

function openRouterModelId(provider: string, model: string): string {
  return `${provider}/${model}`;
}

const FRAMEWORK_DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";
const FRAMEWORK_DEFAULT_BUILDER_MODEL = ANTHROPIC_DEFAULT_MODEL_ID;
const FRAMEWORK_DEFAULT_BUILDER_OPENAI_MODEL = builderGatewayModelId(
  FRAMEWORK_DEFAULT_OPENAI_MODEL,
);
const FRAMEWORK_DEFAULT_OPENROUTER_MODEL = openRouterModelId(
  "openai",
  FRAMEWORK_DEFAULT_OPENAI_MODEL,
);

export const AGENT_MODEL_CONFIG = {
  builder: {
    defaultModel: FRAMEWORK_DEFAULT_BUILDER_MODEL,
    supportedModels: [
      "auto",
      "claude-opus-4-8",
      CLAUDE_SONNET_MODEL_ID,
      "claude-haiku-4-5",
      FRAMEWORK_DEFAULT_BUILDER_OPENAI_MODEL,
      "gpt-5-6-terra",
      "gpt-5-6-luna",
      "gemini-3-1-pro",
      "gemini-3-5-flash",
      // Flash-Lite is a transcription-only public id. Advertising it as an
      // agent-chat option routes through a Vertex preview model whose
      // availability can lapse while the id remains accepted, leaving chat
      // with a bare stop/error event that cannot recover.
    ],
  },
  anthropic: {
    defaultModel: ANTHROPIC_DEFAULT_MODEL_ID,
    supportedModels: [
      "claude-fable-5",
      "claude-opus-4-8",
      CLAUDE_SONNET_MODEL_ID,
      "claude-haiku-4-5-20251001",
    ],
  },
  aiSdk: {
    anthropic: {
      defaultModel: ANTHROPIC_DEFAULT_MODEL_ID,
      supportedModels: [
        "claude-fable-5",
        "claude-opus-4-8",
        CLAUDE_SONNET_MODEL_ID,
        "claude-haiku-4-5-20251001",
      ],
    },
    openai: {
      defaultModel: FRAMEWORK_DEFAULT_OPENAI_MODEL,
      supportedModels: [
        FRAMEWORK_DEFAULT_OPENAI_MODEL,
        "gpt-5.6-terra",
        "gpt-5.6-luna",
      ],
    },
    openrouter: {
      defaultModel: FRAMEWORK_DEFAULT_OPENROUTER_MODEL,
      supportedModels: [
        "anthropic/claude-fable-5",
        "anthropic/claude-opus-4.8",
        OPENROUTER_CLAUDE_SONNET_MODEL_ID,
        FRAMEWORK_DEFAULT_OPENROUTER_MODEL,
        "openai/gpt-5.6-terra",
        "openai/gpt-5.6-luna",
        // Current stable Gemini on OpenRouter (2.5 Flash is GA)
        "google/gemini-2.5-flash",
        "z-ai/glm-5.2",
      ],
    },
    google: {
      defaultModel: "gemini-3.5-flash",
      supportedModels: ["gemini-3.5-flash", "gemini-3.1-pro-preview"],
    },
    groq: {
      // llama-3.1-70b-versatile and mixtral-8x7b-32768 were decommissioned
      // (errors since Jan 2025 and Mar 2025 respectively). Replace with current
      // Groq production models.
      defaultModel: "llama-3.3-70b-versatile",
      supportedModels: [
        "llama-3.3-70b-versatile",
        "llama3-8b-8192",
        "llama-3.1-8b-instant",
      ],
    },
    mistral: {
      defaultModel: "mistral-large-latest",
      supportedModels: [
        "mistral-large-latest",
        "mistral-medium-latest",
        "mistral-small-latest",
      ],
    },
    cohere: {
      // command-r-plus (unversioned) is an alias that may lag; the stable
      // dated release is command-r-plus-08-2024.
      defaultModel: "command-r-plus-08-2024",
      supportedModels: [
        "command-r-plus-08-2024",
        "command-r-plus",
        "command-r",
      ],
    },
    ollama: {
      defaultModel: "llama3.1",
      supportedModels: ["llama3.1", "llama3.2", "mistral", "codestral"],
    },
  },
} as const;

export const BUILDER_MODEL_CONFIG = AGENT_MODEL_CONFIG.builder;
export const ANTHROPIC_MODEL_CONFIG = AGENT_MODEL_CONFIG.anthropic;
export const AI_SDK_MODEL_CONFIG = AGENT_MODEL_CONFIG.aiSdk;

export type AISDKProvider = keyof typeof AI_SDK_MODEL_CONFIG;

export const DEFAULT_MODEL = BUILDER_MODEL_CONFIG.defaultModel;
export const DEFAULT_OPENAI_MODEL = AI_SDK_MODEL_CONFIG.openai.defaultModel;
export const DEFAULT_ANTHROPIC_MODEL = ANTHROPIC_MODEL_CONFIG.defaultModel;
