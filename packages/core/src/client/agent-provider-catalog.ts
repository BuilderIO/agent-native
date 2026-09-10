import {
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_META,
} from "../agent/engine/provider-env-vars.js";
import {
  AI_SDK_MODEL_CONFIG,
  ANTHROPIC_MODEL_CONFIG,
  type AISDKProvider,
} from "../agent/model-config.js";

export type AgentProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "google"
  | "groq"
  | "mistral"
  | "cohere"
  | "ollama";

export interface AgentProviderOption {
  id: AgentProviderId;
  engine: string;
  label: string;
  description: string;
  key?: string;
  endpointKey?: string;
  placeholder?: string;
  defaultModel: string;
  supportedModels: readonly string[];
  docsUrl?: string;
  supportsCustomModel?: boolean;
  supportsEndpoint?: boolean;
  endpointPlaceholder?: string;
  kind: "cloud" | "gateway" | "local";
}

const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Google Gemini",
  groq: "Groq",
  mistral: "Mistral",
  cohere: "Cohere",
  ollama: "Ollama",
};

const PROVIDER_DESCRIPTIONS: Record<AgentProviderId, string> = {
  anthropic: "Claude models with your own API key.",
  openai: "GPT models and OpenAI-compatible gateways.",
  openrouter: "One key for hundreds of hosted models.",
  google: "Gemini models with a Google AI key.",
  groq: "Fast inference for open models.",
  mistral: "Mistral models through the Mistral API.",
  cohere: "Command models through the Cohere API.",
  ollama: "Run local models from Ollama on your machine.",
};

const PROVIDER_DOCS: Partial<Record<AgentProviderId, string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys",
  google: "https://aistudio.google.com/apikey",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys/",
  cohere: "https://dashboard.cohere.com/api-keys",
};

const PROVIDER_ORDER: readonly AgentProviderId[] = [
  "openrouter",
  "ollama",
  "anthropic",
  "openai",
  "google",
  "groq",
  "mistral",
  "cohere",
];

function modelConfig(provider: AgentProviderId) {
  if (provider === "anthropic") return ANTHROPIC_MODEL_CONFIG;
  return AI_SDK_MODEL_CONFIG[provider as AISDKProvider];
}

export const AGENT_PROVIDER_CATALOG: readonly AgentProviderOption[] =
  PROVIDER_ORDER.map((id) => {
    const config = modelConfig(id);
    const envMeta = PROVIDER_ENV_META[id];
    const isOllama = id === "ollama";

    return {
      id,
      engine: id === "anthropic" ? "anthropic" : `ai-sdk:${id}`,
      label: PROVIDER_LABELS[id],
      description: PROVIDER_DESCRIPTIONS[id],
      ...(envMeta
        ? { key: envMeta.envVar, placeholder: envMeta.placeholder }
        : {}),
      ...(id === "openai"
        ? { endpointKey: OPENAI_BASE_URL_ENV_VAR }
        : isOllama
          ? { endpointKey: OLLAMA_BASE_URL_ENV_VAR }
          : {}),
      defaultModel: config.defaultModel,
      supportedModels: config.supportedModels,
      ...(PROVIDER_DOCS[id] ? { docsUrl: PROVIDER_DOCS[id] } : {}),
      ...(id === "openrouter" || isOllama ? { supportsCustomModel: true } : {}),
      ...(id === "openai" || isOllama
        ? {
            supportsEndpoint: true,
            endpointPlaceholder: isOllama
              ? "http://localhost:11434"
              : "https://gateway.example/v1",
          }
        : {}),
      kind: isOllama
        ? ("local" as const)
        : id === "openrouter"
          ? ("gateway" as const)
          : ("cloud" as const),
    } satisfies AgentProviderOption;
  });

export function getAgentProviderOption(
  provider: AgentProviderId,
): AgentProviderOption {
  const option = AGENT_PROVIDER_CATALOG.find((item) => item.id === provider);
  if (!option) throw new Error(`Unknown AI provider: ${provider}`);
  return option;
}

export function providerIdForEngine(engine: string): AgentProviderId | null {
  if (engine === "anthropic" || engine === "ai-sdk:anthropic") {
    return "anthropic";
  }
  if (engine.startsWith("ai-sdk:")) {
    const provider = engine.slice("ai-sdk:".length);
    if (
      AGENT_PROVIDER_CATALOG.some(
        (option) => option.id === (provider as AgentProviderId),
      )
    ) {
      return provider as AgentProviderId;
    }
  }
  return null;
}
