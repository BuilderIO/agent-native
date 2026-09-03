/**
 * Registers built-in agent engines (anthropic, ai-sdk:*) into the global registry.
 *
 * This module is imported once at server startup via the agent-chat plugin.
 * Additional engines can be registered by calling registerAgentEngine() from
 * any server plugin after startup.
 */

import { AppConfigurationError, getAppConfig } from "../../app-config/index.js";
import {
  createAISDKEngine,
  PROVIDER_CAPABILITIES,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_SUPPORTED_MODELS,
  PROVIDER_ENV_VARS,
  PROVIDER_PACKAGES,
  type AISDKProvider,
} from "./ai-sdk-engine.js";
import {
  createAnthropicEngine,
  ANTHROPIC_CAPABILITIES,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_SUPPORTED_MODELS,
} from "./anthropic-engine.js";
import {
  createBuilderEngine,
  BUILDER_CAPABILITIES,
  BUILDER_DEFAULT_MODEL,
  BUILDER_SUPPORTED_MODELS,
} from "./builder-engine.js";
import {
  registerAgentEngine,
  unregisterAgentEngine,
  type AgentEngineEntry,
} from "./registry.js";

const aiSdkProviders: AISDKProvider[] = [
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "groq",
  "mistral",
  "cohere",
  "ollama",
];

const providerLabels: Record<AISDKProvider, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Gemini",
  groq: "Groq",
  mistral: "Mistral",
  cohere: "Cohere",
  ollama: "Ollama",
};

const providerDescriptions: Record<AISDKProvider, string> = {
  anthropic:
    "Claude models through the Vercel AI SDK. Supports thinking and caching via AI SDK providerOptions.",
  openai: "OpenAI GPT models via the Vercel AI SDK. Requires OPENAI_API_KEY.",
  openrouter:
    "300+ models from Anthropic, OpenAI, Google, Z.ai, and more routed through a single endpoint. Use model IDs like 'anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol', or 'z-ai/glm-5.2'. Requires OPENROUTER_API_KEY.",
  google:
    "Google Gemini models via the Vercel AI SDK. Requires GOOGLE_GENERATIVE_AI_API_KEY.",
  groq: "Groq LPU inference via the Vercel AI SDK. Requires GROQ_API_KEY.",
  mistral: "Mistral models via the Vercel AI SDK. Requires MISTRAL_API_KEY.",
  cohere:
    "Cohere Command models via the Vercel AI SDK. Requires COHERE_API_KEY.",
  ollama: "Local Ollama models via the Vercel AI SDK. No API key required.",
};

/**
 * Every built-in engine, in registration order.
 *
 * Order is behavior, not presentation: `detectEngineFromEnv()` walks the
 * registry in insertion order, so Builder has to stay first for a customer who
 * configured Builder to keep getting it. A selection that reorders the names
 * therefore does not reorder registration.
 */
function builtinEngineEntries(): AgentEngineEntry[] {
  return [
    // ── Builder.io managed gateway ───────────────────────────────────────────
    // Registered first, so it wins whenever a customer configured Builder — the
    // legacy key pair included. Two credential shapes select it: a user's own
    // connection via that pair, or the deployment's Builder-credits token plus
    // space id, which is the only lane an anonymous visitor on a hosted site has.
    // Only the injected Builder-credits set is marked deployInjected, so it alone
    // steps aside for a provider key the customer set (see selectDetectedEngine);
    // users who prefer BYO everywhere can still set AGENT_ENGINE_PREFER_BYO_KEY.
    {
      name: "builder",
      label: "Builder.io Gateway",
      description:
        "Managed LLM access via Builder.io — Claude, GPT, Gemini, and more through a single connection.",
      capabilities: BUILDER_CAPABILITIES,
      defaultModel: BUILDER_DEFAULT_MODEL,
      supportedModels: BUILDER_SUPPORTED_MODELS,
      requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
      alternateRequiredEnvVars: [
        {
          envVars: ["BUILDER_GATEWAY_TOKEN", "BUILDER_GATEWAY_SPACE_ID"],
          deployInjected: true,
        },
      ],
      create: (config) => createBuilderEngine(config),
    },

    // ── Anthropic ────────────────────────────────────────────────────────────
    {
      name: "anthropic",
      label: "Claude",
      description:
        "Anthropic's SDK — best-in-class Claude models with full feature support (thinking, prompt caching, vision, computer use).",
      capabilities: ANTHROPIC_CAPABILITIES,
      defaultModel: ANTHROPIC_DEFAULT_MODEL,
      supportedModels: ANTHROPIC_SUPPORTED_MODELS,
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: (config) => createAnthropicEngine(config),
    },

    // ── Vercel AI SDK providers ──────────────────────────────────────────────
    ...aiSdkProviders.map((provider) => ({
      name: `ai-sdk:${provider}`,
      label: providerLabels[provider],
      description: providerDescriptions[provider],
      installPackage: `ai ${PROVIDER_PACKAGES[provider]}`,
      capabilities: PROVIDER_CAPABILITIES[provider],
      defaultModel: PROVIDER_DEFAULT_MODELS[provider],
      supportedModels: PROVIDER_SUPPORTED_MODELS[provider],
      requiredEnvVars: PROVIDER_ENV_VARS[provider],
      create: (config: Record<string, unknown>) =>
        createAISDKEngine(provider, config),
    })),
  ];
}

/** Names of every built-in engine, in registration order. */
export const BUILT_IN_ENGINE_NAMES: readonly string[] = [
  "builder",
  "anthropic",
  ...aiSdkProviders.map((provider) => `ai-sdk:${provider}`),
];

/**
 * The built-ins this deployment asked for, as a set.
 *
 * An unset `agent.builtInEngines` means every built-in, which is what every
 * deployment before this field had. A name that is not a built-in is a
 * configuration error rather than a silently ignored entry: the whole point of
 * the field is to narrow what the agent can reach, and a typo that quietly
 * widened it back would be invisible.
 */
export function resolveBuiltInEngineSelection(): Set<string> {
  const configured = getAppConfig().agent.builtInEngines;
  if (!configured) return new Set(BUILT_IN_ENGINE_NAMES);

  const unknown = configured.filter(
    (name) => !BUILT_IN_ENGINE_NAMES.includes(name),
  );
  if (unknown.length > 0) {
    throw new AppConfigurationError(
      `agent.builtInEngines names unknown built-in engine(s): ${unknown.join(", ")}. ` +
        `Available: ${BUILT_IN_ENGINE_NAMES.join(", ")}.`,
    );
  }
  return new Set(configured);
}

/**
 * The selection the registry currently reflects, so the common repeat call
 * costs one comparison. It is a signature rather than a boolean because
 * `defineAppConfig()` can land after a module-level `registerBuiltinEngines()`
 * has already run — see `unregisterAgentEngine`.
 */
let _appliedSelection: string | undefined;

/**
 * Register the built-in engines this deployment selected. Safe to call multiple
 * times, and re-reconciles if `agent.builtInEngines` resolves differently than
 * it did on the previous call.
 */
export function registerBuiltinEngines(): void {
  const selected = resolveBuiltInEngineSelection();
  const signature = BUILT_IN_ENGINE_NAMES.filter((name) =>
    selected.has(name),
  ).join(",");
  if (_appliedSelection === signature) return;

  // Rebuild rather than patch: registration order is `detectEngineFromEnv()`'s
  // priority order, and adding a previously-deselected engine back would
  // otherwise put it at the end of the Map instead of its declared position.
  for (const name of BUILT_IN_ENGINE_NAMES) unregisterAgentEngine(name);
  for (const entry of builtinEngineEntries()) {
    if (selected.has(entry.name)) registerAgentEngine(entry);
  }
  _appliedSelection = signature;
}
