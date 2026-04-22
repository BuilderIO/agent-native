/**
 * AISDKEngine — wraps the Vercel AI SDK (ai package) for multi-provider support.
 *
 * Supports Anthropic, OpenAI, Google Gemini, Groq, and any provider with an
 * @ai-sdk/* package. Provider is selected via the `provider` config option.
 *
 * When provider is "anthropic", Anthropic-native features (thinking, cacheControl)
 * are forwarded through the AI SDK's providerOptions mechanism — no fidelity loss
 * compared to the native AnthropicEngine.
 *
 * The ai package is an OPTIONAL peer dependency. This engine uses dynamic import()
 * so the core package remains installable without the AI SDK.
 */

import type {
  AgentEngine,
  EngineCapabilities,
  EngineStreamOptions,
  EngineEvent,
  EngineContentPart,
} from "./types.js";
import {
  engineToolsToAISDK,
  engineMessagesToAISDK,
  aiSdkPartToEngineEvents,
  aiSdkStepToAssistantContent,
} from "./translate-ai-sdk.js";

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

export type AISDKProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "mistral"
  | "cohere"
  | "ollama";

const PROVIDER_CAPABILITIES: Record<AISDKProvider, EngineCapabilities> = {
  anthropic: {
    thinking: true,
    promptCaching: true,
    vision: true,
    computerUse: false, // not exposed through AI SDK yet
    parallelToolCalls: true,
  },
  openai: {
    thinking: false,
    promptCaching: false,
    vision: true,
    computerUse: false,
    parallelToolCalls: true,
  },
  google: {
    thinking: true,
    promptCaching: false,
    vision: true,
    computerUse: false,
    parallelToolCalls: true,
  },
  groq: {
    thinking: false,
    promptCaching: false,
    vision: false,
    computerUse: false,
    parallelToolCalls: true,
  },
  mistral: {
    thinking: false,
    promptCaching: false,
    vision: false,
    computerUse: false,
    parallelToolCalls: true,
  },
  cohere: {
    thinking: false,
    promptCaching: false,
    vision: false,
    computerUse: false,
    parallelToolCalls: true,
  },
  ollama: {
    thinking: false,
    promptCaching: false,
    vision: false,
    computerUse: false,
    parallelToolCalls: false,
  },
};

const PROVIDER_DEFAULT_MODELS: Record<AISDKProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  cohere: "command-r-plus",
  ollama: "llama3.1",
};

const PROVIDER_SUPPORTED_MODELS: Record<AISDKProvider, readonly string[]> = {
  anthropic: [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5",
    "claude-sonnet-4-5",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o1",
    "o1-mini",
    "o3",
    "o3-mini",
  ],
  google: [
    "gemini-2.0-flash",
    "gemini-2.0-pro",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "mixtral-8x7b-32768",
  ],
  mistral: [
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
  ],
  cohere: ["command-r-plus", "command-r"],
  ollama: ["llama3.1", "llama3.2", "mistral", "codestral"],
};

const PROVIDER_ENV_VARS: Record<AISDKProvider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  ollama: [], // runs locally
};

const PROVIDER_PACKAGES: Record<AISDKProvider, string> = {
  anthropic: "@ai-sdk/anthropic",
  openai: "@ai-sdk/openai",
  google: "@ai-sdk/google",
  groq: "@ai-sdk/groq",
  mistral: "@ai-sdk/mistral",
  cohere: "@ai-sdk/cohere",
  ollama: "ai-sdk-ollama",
};

/** Factory export name per provider (not all follow `create<Provider>`). */
const PROVIDER_FACTORIES: Record<AISDKProvider, string> = {
  anthropic: "createAnthropic",
  openai: "createOpenAI",
  google: "createGoogleGenerativeAI",
  groq: "createGroq",
  mistral: "createMistral",
  cohere: "createCohere",
  ollama: "createOllama",
};

// ---------------------------------------------------------------------------
// AISDKEngine implementation
// ---------------------------------------------------------------------------

class AISDKEngine implements AgentEngine {
  readonly name: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly supportedModels: readonly string[];
  readonly capabilities: EngineCapabilities;

  private readonly provider: AISDKProvider;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;

  constructor(provider: AISDKProvider, config: Record<string, unknown>) {
    this.provider = provider;
    this.name = `ai-sdk:${provider}`;
    this.label = `${capitalize(provider)} (AI SDK)`;
    this.defaultModel =
      (config.model as string | undefined) ?? PROVIDER_DEFAULT_MODELS[provider];
    this.supportedModels = PROVIDER_SUPPORTED_MODELS[provider];
    this.capabilities = PROVIDER_CAPABILITIES[provider];
    this.apiKey =
      (config.apiKey as string | undefined) ?? getProviderApiKey(provider);
    this.baseUrl = config.baseUrl as string | undefined;
  }

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    let aiModule: any;
    try {
      aiModule = await import("ai");
    } catch {
      yield {
        type: "stop",
        reason: "error",
        error: `The "ai" package is not installed. Run: pnpm add ai ${PROVIDER_PACKAGES[this.provider]}`,
      };
      return;
    }

    const { streamText, jsonSchema } = aiModule;

    let providerModel: any;
    try {
      providerModel = await this.createProviderModel(opts.model);
    } catch (err: any) {
      yield {
        type: "stop",
        reason: "error",
        error: err?.message ?? String(err),
      };
      return;
    }

    const aiSdkTools =
      opts.tools.length > 0
        ? engineToolsToAISDK(opts.tools, jsonSchema)
        : undefined;
    const messages = engineMessagesToAISDK(opts.messages);

    // Build providerOptions for Anthropic-native features when using Anthropic provider
    const providerOpts: Record<string, unknown> = {};
    if (this.provider === "anthropic" && opts.providerOptions?.anthropic) {
      const anthropicOpts = opts.providerOptions.anthropic;
      if (anthropicOpts.thinking) {
        providerOpts.anthropic = {
          ...((providerOpts.anthropic as object) ?? {}),
          thinking: {
            type: "enabled",
            budgetTokens: anthropicOpts.thinking.budgetTokens,
          },
        };
      }
      if (anthropicOpts.cacheControl) {
        providerOpts.anthropic = {
          ...((providerOpts.anthropic as object) ?? {}),
          cacheControl: anthropicOpts.cacheControl,
        };
      }
    }

    let assistantContent: EngineContentPart[] = [];

    try {
      const result = streamText({
        model: providerModel,
        system: opts.systemPrompt,
        messages,
        tools: aiSdkTools,
        maxOutputTokens: opts.maxOutputTokens ?? 16384,
        ...(opts.temperature !== undefined
          ? { temperature: opts.temperature }
          : {}),
        abortSignal: opts.abortSignal,
        onStepFinish: (step: any) => {
          assistantContent = aiSdkStepToAssistantContent(step);
        },
        ...(Object.keys(providerOpts).length > 0
          ? { providerOptions: providerOpts }
          : {}),
      });

      // Buffer the terminal stop so assistant-content can be emitted just
      // before it, regardless of where `finish` arrives in the stream.
      let bufferedStop: EngineEvent | undefined;

      for await (const part of result.fullStream) {
        for (const event of aiSdkPartToEngineEvents(part)) {
          if (event.type === "stop") {
            bufferedStop = event;
          } else {
            yield event;
          }
        }
      }

      yield { type: "assistant-content", parts: assistantContent };
      yield bufferedStop ?? { type: "stop", reason: "end_turn" };
    } catch (err: any) {
      yield {
        type: "stop",
        reason: "error",
        error: err?.message ?? String(err),
      };
      throw err;
    }
  }

  private async createProviderModel(model: string): Promise<any> {
    const pkg = PROVIDER_PACKAGES[this.provider];
    let providerModule: any;
    try {
      providerModule = await import(/* @vite-ignore */ pkg);
    } catch {
      throw new Error(
        `Provider package "${pkg}" is not installed. Run: pnpm add ai ${pkg}`,
      );
    }

    const fnName = PROVIDER_FACTORIES[this.provider];
    const createFn = providerModule[fnName] ?? providerModule.default;
    if (typeof createFn !== "function") {
      throw new Error(`"${pkg}" does not export ${fnName} or default`);
    }

    const config: Record<string, unknown> = {};
    if (this.apiKey) config.apiKey = this.apiKey;
    if (this.baseUrl) config.baseURL = this.baseUrl;

    const provider = createFn(config);
    // @ai-sdk/openai@3 defaults to the Responses API; force Chat Completions
    // so OpenAI-compatible gateways (OpenRouter, Groq, Together, …) work too.
    return this.provider === "openai" ? provider.chat(model) : provider(model);
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createAISDKEngine(
  provider: AISDKProvider,
  config: Record<string, unknown> = {},
): AgentEngine {
  return new AISDKEngine(provider, config);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getProviderApiKey(provider: AISDKProvider): string | undefined {
  const envVars = PROVIDER_ENV_VARS[provider];
  for (const v of envVars) {
    if (process.env[v]) return process.env[v];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Exports for registry registration
// ---------------------------------------------------------------------------

export {
  PROVIDER_CAPABILITIES,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_SUPPORTED_MODELS,
  PROVIDER_ENV_VARS,
  PROVIDER_PACKAGES,
};
