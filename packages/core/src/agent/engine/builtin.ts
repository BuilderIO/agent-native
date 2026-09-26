
import { AppConfigurationError, getAppConfig } from "../../app-config/index.js";
import {
  CHATGPT_SUBSCRIPTION_DEFAULT_MODEL,
  CHATGPT_SUBSCRIPTION_ENGINE_NAME,
  CHATGPT_SUBSCRIPTION_MODELS,
} from "../chatgpt-subscription-contract.js";
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
import { createChatGPTSubscriptionEngine } from "./chatgpt-subscription-engine.js";
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

function builtinEngineEntries(): AgentEngineEntry[] {
  return [
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

    {
      name: "anthropic",
      label: "Claude",
      description:
        "Anthropic's SDK — best-in-class Claude models with full feature support (thinking, prompt caching, vision, computer use).",
      capabilities: ANTHROPIC_CAPABILITIES,
      defaultModel: ANTHROPIC_DEFAULT_MODEL,
      supportedModels: ANTHROPIC_SUPPORTED_MODELS,
      acceptsCustomModels: true,
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: (config) => createAnthropicEngine(config),
    },

    ...aiSdkProviders.map((provider) => ({
      name: `ai-sdk:${provider}`,
      label: providerLabels[provider],
      description: providerDescriptions[provider],
      installPackage: `ai ${PROVIDER_PACKAGES[provider]}`,
      capabilities: PROVIDER_CAPABILITIES[provider],
      defaultModel: PROVIDER_DEFAULT_MODELS[provider],
      supportedModels: PROVIDER_SUPPORTED_MODELS[provider],
      acceptsCustomModels: true,
      requiredEnvVars: PROVIDER_ENV_VARS[provider],
      create: (config: Record<string, unknown>) =>
        createAISDKEngine(provider, config),
    })),
    {
      name: CHATGPT_SUBSCRIPTION_ENGINE_NAME,
      label: "ChatGPT subscription",
      description:
        "Experimental Codex access through a user's ChatGPT subscription. Enable the matching lab first.",
      capabilities: PROVIDER_CAPABILITIES.openai,
      defaultModel: CHATGPT_SUBSCRIPTION_DEFAULT_MODEL,
      supportedModels: CHATGPT_SUBSCRIPTION_MODELS,
      acceptsCustomModels: false,
      requiredEnvVars: [],
      create: (config: Record<string, unknown>) =>
        createChatGPTSubscriptionEngine(config),
    },
  ];
}

export const BUILT_IN_ENGINE_NAMES: readonly string[] = [
  "builder",
  "anthropic",
  ...aiSdkProviders.map((provider) => `ai-sdk:${provider}`),
  CHATGPT_SUBSCRIPTION_ENGINE_NAME,
];

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

let _appliedSelection: string | undefined;

export function registerBuiltinEngines(): void {
  const selected = resolveBuiltInEngineSelection();
  const signature = BUILT_IN_ENGINE_NAMES.filter((name) =>
    selected.has(name),
  ).join(",");
  if (_appliedSelection === signature) return;

  for (const name of BUILT_IN_ENGINE_NAMES) unregisterAgentEngine(name);
  for (const entry of builtinEngineEntries()) {
    if (selected.has(entry.name)) registerAgentEngine(entry);
  }
  _appliedSelection = signature;
}
