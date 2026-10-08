const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-fable-5": 1_000_000,
  "claude-fable-5-1": 1_000_000,
  "claude-haiku-5-5": 1_000_000,
  "claude-opus-5-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "anthropic/claude-fable-5.1": 1_000_000,
  "anthropic/claude-haiku-5.5": 1_000_000,
  "deepseek-v4-pro": 1_048_576,
  "deepseek/deepseek-v4-pro": 1_048_576,

  "gpt-5-6-sol": 1_050_000,
  "gpt-5-6-terra": 1_050_000,
  "gpt-5-6-luna": 400_000,

  "gemini-3-1-pro": 1_048_576,
  "gemini-3-5-flash": 1_048_576,
  "gemini-3-1-flash-lite": 1_048_576,

  "anthropic/claude-fable-5": 1_000_000,
  "anthropic/claude-opus-5.5": 1_000_000,
  "anthropic/claude-opus-4.8": 1_000_000,
  "anthropic/claude-opus-4.7": 1_000_000,
  "anthropic/claude-sonnet-5": 1_000_000,
  "anthropic/claude-sonnet-5.5": 1_000_000,
  "anthropic/claude-sonnet-4.6": 1_000_000,
  "openai/gpt-5.6-sol": 1_050_000,
  "openai/gpt-5.6-terra": 1_050_000,
  "openai/gpt-5.6-luna": 1_050_000,
  "openai/gpt-6.1-sol": 1_050_000,
  "openai/gpt-6-sol": 1_050_000,
  "openai/gpt-6-luna": 1_050_000,
  "openai/gpt-5.5": 1_050_000,
  "openai/gpt-5.4": 1_050_000,
  "openai/gpt-5.4-mini": 400_000,
  "openai/gpt-5.1-codex-mini": 400_000,
  "google/gemini-2.5-flash": 1_048_576,
  "google/gemini-3.5-flash-lite": 1_048_576,
  "google/gemini-3.1-flash-lite": 1_048_576,
  "google/gemini-3.1-pro-preview": 1_048_576,
  "z-ai/glm-5.2": 1_048_576,

  "gpt-6-sol": 1_050_000,
  "gpt-6.1-sol": 1_050_000,
  "gpt-6-luna": 1_050_000,
  "gpt-5.6-sol": 1_050_000,
  "gpt-5.6-terra": 1_050_000,
  "gpt-5.6-luna": 400_000,
  "gpt-5.5": 1_050_000,
  "gpt-5.4": 1_050_000,
  "gpt-5.4-mini": 400_000,
  "gpt-5.1-codex-mini": 400_000,
  "gpt-5-4-mini": 400_000,
  "gpt-5-1-codex-mini": 400_000,

  "gemini-3.5-flash": 1_048_576,
  "gemini-3.5-flash-lite": 1_048_576,
  "gemini-3.1-flash-lite": 1_048_576,
  "gemini-3.1-pro-preview": 1_048_576,
  "gemini-3-5-flash-lite": 1_048_576,
  "gemini-3-8-flash": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
};

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

  const id = modelId.toLowerCase();

  if (
    id === "claude-fable-5" ||
    id.includes("claude-fable-5") ||
    id.includes("claude-haiku-5") ||
    id.startsWith("claude-opus-4") ||
    id.startsWith("claude-opus-5") ||
    id.includes("claude-sonnet-5") ||
    id.includes("claude-sonnet-4-6") ||
    id.includes("claude-sonnet-4.6")
  )
    return 1_000_000;

  if (id.startsWith("claude-")) return 200_000;

  if (/^(?:openai\/)?gpt-[56]/.test(id)) return 1_050_000;

  if (
    id.startsWith("gemini-2") ||
    id.startsWith("gemini-3") ||
    id.includes("/gemini-2") ||
    id.includes("/gemini-3")
  )
    return 1_048_576;

  if (id.startsWith("glm-5") || id.includes("/glm-5")) return 1_048_576;

  return DEFAULT_CONTEXT_WINDOW;
}

const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "claude-fable-5": 128_000,
  "claude-fable-5-1": 128_000,
  "claude-haiku-5-5": 128_000,
  "claude-opus-5-5": 128_000,
  "claude-opus-4-8": 128_000,
  "claude-opus-4-7": 128_000,
  "claude-sonnet-5": 128_000,
  "claude-sonnet-5-5": 128_000,
  "claude-sonnet-4-6": 128_000,
  "claude-haiku-4-5": 64_000,
  "claude-haiku-4-5-20251001": 64_000,
  "anthropic/claude-fable-5.1": 128_000,
  "anthropic/claude-haiku-5.5": 128_000,
  "deepseek-v4-pro": 393_216,
  "deepseek/deepseek-v4-pro": 393_216,

  "gpt-5-6-sol": 40_000,
  "gpt-5-6-terra": 40_000,
  "gpt-5-6-luna": 40_000,

  "anthropic/claude-fable-5": 128_000,
  "anthropic/claude-opus-5.5": 128_000,
  "anthropic/claude-opus-4.8": 128_000,
  "anthropic/claude-opus-4.7": 128_000,
  "anthropic/claude-sonnet-5": 128_000,
  "anthropic/claude-sonnet-5.5": 128_000,
  "anthropic/claude-sonnet-4.6": 128_000,
  "openai/gpt-5.6-sol": 40_000,
  "openai/gpt-5.6-terra": 40_000,
  "openai/gpt-5.6-luna": 128_000,
  "openai/gpt-6.1-sol": 128_000,
  "openai/gpt-6-sol": 128_000,
  "openai/gpt-6-luna": 128_000,
  "openai/gpt-5.5": 128_000,
  "openai/gpt-5.4": 128_000,
  "openai/gpt-5.4-mini": 128_000,
  "openai/gpt-5.1-codex-mini": 40_000,

  "gpt-6-sol": 128_000,
  "gpt-6.1-sol": 128_000,
  "gpt-6-luna": 128_000,
  "gpt-5.6-sol": 40_000,
  "gpt-5.6-terra": 40_000,
  "gpt-5.6-luna": 40_000,
  "gpt-5.5": 128_000,
  "gpt-5.4": 128_000,
  "gpt-5.4-mini": 128_000,
  "gpt-5.1-codex-mini": 40_000,
  "gpt-5-5": 128_000,
  "gpt-5-4": 128_000,
  "gpt-5-4-mini": 128_000,
  "gpt-5-1-codex-mini": 40_000,
};

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

  const id = modelId.toLowerCase();

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

  if (id.startsWith("claude-") || id.includes("/claude-")) {
    return DEFAULT_MAX_OUTPUT_TOKENS_CEILING;
  }

  if (/^(?:openai\/)?gpt-[56]/.test(id)) return 128_000;

  return DEFAULT_MAX_OUTPUT_TOKENS_CEILING;
}

export const CLAUDE_SONNET_MODEL_ID = "claude-sonnet-5-5";
export const CLAUDE_SONNET_MODEL_LABEL = "Claude Sonnet 5.5";

export const BUILDER_CLAUDE_SONNET_MODEL_ID = CLAUDE_SONNET_MODEL_ID;
export const BUILDER_CLAUDE_SONNET_MODEL_LABEL = CLAUDE_SONNET_MODEL_LABEL;
const OPENROUTER_CLAUDE_SONNET_MODEL_ID = "anthropic/claude-sonnet-5.5";

export const CURRENT_BUILDER_CLAUDE_MODEL_OPTIONS = [
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { value: CLAUDE_SONNET_MODEL_ID, label: CLAUDE_SONNET_MODEL_LABEL },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
] as const;

export function getClaudeModelOptionLabel(modelId: string): string {
  const currentModel = CURRENT_BUILDER_CLAUDE_MODEL_OPTIONS.find(
    (option) => option.value === modelId,
  );
  if (currentModel) return currentModel.label;

  const undatedModelId = modelId.replace(/-\d{8,}$/, "");
  const match = /^claude-(haiku|sonnet|opus|fable)-(\d+)(?:[-.](\d+))?$/i.exec(
    undatedModelId,
  );
  if (!match) return modelId;

  const family = match[1][0].toUpperCase() + match[1].slice(1);
  return `Claude ${family} ${match[2]}${match[3] ? `.${match[3]}` : ""}`;
}

export const BUILDER_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "claude-sonnet-4-6": "claude-sonnet-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-haiku-4-5": "claude-haiku-5-5",
  "claude-opus-4-7": "claude-opus-5-5",
  "claude-opus-4-8": "claude-opus-5-5",
  "claude-opus-5": "claude-opus-5-5",
  "gpt-5-6-sol": "gpt-6-1-sol",
  "gpt-5-6-luna": "gpt-6-luna",
  "gpt-6-sol": "gpt-6-1-sol",
  "gpt-6.1-sol": "gpt-6-1-sol",
  "gemini-3-5-flash": "gemini-3-8-flash",
  "gemini-3-6-flash": "gemini-3-8-flash",
  "gemini-3-7-flash": "gemini-3-8-flash",
};

const ANTHROPIC_DEFAULT_MODEL_ID = CLAUDE_SONNET_MODEL_ID;

function openRouterModelId(provider: string, model: string): string {
  return `${provider}/${model}`;
}

const FRAMEWORK_DEFAULT_OPENAI_MODEL = "gpt-6-luna";
const FRAMEWORK_DEFAULT_BUILDER_MODEL = "gpt-6-luna";
const FRAMEWORK_DEFAULT_OPENROUTER_MODEL = openRouterModelId(
  "openai",
  FRAMEWORK_DEFAULT_OPENAI_MODEL,
);

export const AGENT_MODEL_CONFIG = {
  builder: {
    defaultModel: FRAMEWORK_DEFAULT_BUILDER_MODEL,
    supportedModels: [
      "auto",
      "claude-haiku-5-5",
      BUILDER_CLAUDE_SONNET_MODEL_ID,
      "claude-opus-5-5",
      "gpt-5-4",
      "gpt-5-5",
      "gpt-5-4-mini",
      "gpt-5-1-codex-mini",
      "gpt-6-1-sol",
      "gpt-5-6-terra",
      "gpt-6-luna",
      "gemini-3-1-pro",
      "gemini-3-8-flash",
      "gemini-3-5-flash-lite",
      "gemini-3-1-flash-lite",
      "grok-code-fast",
      "qwen3-coder",
      "kimi-k2-5",
      "deepseek-v4-pro",
      "deepseek-v4-1-flash",
      "deepseek-v3-1",
      "z-ai-glm-4-5",
      "z-ai-glm-5-1",
      "z-ai-glm-5-3-flash",
    ],
  },
  anthropic: {
    defaultModel: ANTHROPIC_DEFAULT_MODEL_ID,
    supportedModels: [
      "claude-haiku-5-5",
      "claude-haiku-4-5-20251001",
      CLAUDE_SONNET_MODEL_ID,
      "claude-opus-5-5",
      "claude-opus-4-8",
      "claude-fable-5-1",
      "claude-fable-5",
    ],
  },
  aiSdk: {
    anthropic: {
      defaultModel: ANTHROPIC_DEFAULT_MODEL_ID,
      supportedModels: [
        "claude-haiku-5-5",
        "claude-haiku-4-5-20251001",
        CLAUDE_SONNET_MODEL_ID,
        "claude-opus-5-5",
        "claude-opus-4-8",
        "claude-fable-5-1",
        "claude-fable-5",
      ],
    },
    openai: {
      defaultModel: FRAMEWORK_DEFAULT_OPENAI_MODEL,
      supportedModels: [
        "gpt-6-luna",
        "gpt-6.1-sol",
        "gpt-5.6-terra",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.1-codex-mini",
      ],
    },
    openrouter: {
      defaultModel: FRAMEWORK_DEFAULT_OPENROUTER_MODEL,
      supportedModels: [
        "openai/gpt-6-luna",
        "openai/gpt-5.6-terra",
        "openai/gpt-6.1-sol",
        "openai/gpt-6-astra",
        "openai/gpt-6-astra-pro",
        "openai/gpt-5.5",
        "openai/gpt-5.4",
        "openai/gpt-5.4-mini",
        "openai/gpt-5.1-codex-mini",
        "anthropic/claude-haiku-5.5",
        OPENROUTER_CLAUDE_SONNET_MODEL_ID,
        "anthropic/claude-opus-5.5",
        "anthropic/claude-opus-4.8",
        "anthropic/claude-fable-5",
        "anthropic/claude-fable-5.1",
        "google/gemini-3.8-flash",
        "google/gemini-3.5-flash-lite",
        "google/gemini-3.1-flash-lite",
        "google/gemini-3.1-pro-preview",
        "x-ai/grok-4.7",
        "qwen/qwen3-coder",
        "moonshotai/kimi-k2.5",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4.1-flash",
        "deepseek/deepseek-chat-v3.1",
        "z-ai/glm-4.5",
        "z-ai/glm-5.1",
        "z-ai/glm-5.3-flash",
        "qwen/qwen3.8-max-0902",
        "meta/muse-spark-1.3",
        "inception/mercury-2.5",
        "z-ai/glm-5.2",
      ],
    },
    google: {
      defaultModel: "gemini-3.8-flash",
      supportedModels: [
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3.1-pro-preview",
      ],
    },
    groq: {
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

type ClaudeModelFamily = "haiku" | "sonnet" | "opus";

const RATE_LIMIT_FALLBACK_FAMILY: Record<ClaudeModelFamily, ClaudeModelFamily> =
  {
    haiku: "sonnet",
    sonnet: "haiku",
    opus: "sonnet",
  };

function claudeModelFamily(model: string): ClaudeModelFamily | undefined {
  const id = model.toLowerCase();
  if (id.includes("haiku")) return "haiku";
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("opus")) return "opus";
  return undefined;
}

export function resolveFallbackModel(
  model: string,
  supportedModels: readonly string[] | undefined,
): string | undefined {
  const family = claudeModelFamily(model);
  if (!family || !supportedModels) return undefined;
  const targetFamily = RATE_LIMIT_FALLBACK_FAMILY[family];
  return supportedModels.find(
    (id) => id !== model && claudeModelFamily(id) === targetFamily,
  );
}
