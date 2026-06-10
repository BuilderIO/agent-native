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
import { AI_SDK_MODEL_CONFIG, type AISDKProvider } from "../model-config.js";
import { readDeployCredentialEnv } from "../../server/credential-provider.js";
import { normalizeReasoningEffortForModel } from "../../shared/reasoning-effort.js";
import { resolveMaxOutputTokensForEngine } from "./output-tokens.js";

export type { AISDKProvider } from "../model-config.js";

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

const PROVIDER_CAPABILITIES: Record<AISDKProvider, EngineCapabilities> = {
  anthropic: {
    thinking: true,
    promptCaching: true,
    vision: true,
    computerUse: false, // not exposed through AI SDK yet
    parallelToolCalls: true,
  },
  openai: {
    thinking: true,
    promptCaching: false,
    vision: true,
    computerUse: false,
    parallelToolCalls: true,
  },
  openrouter: {
    thinking: true,
    promptCaching: true,
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

const providerModelEntries = Object.entries(AI_SDK_MODEL_CONFIG) as Array<
  [AISDKProvider, (typeof AI_SDK_MODEL_CONFIG)[AISDKProvider]]
>;

const PROVIDER_DEFAULT_MODELS = Object.fromEntries(
  providerModelEntries.map(([provider, config]) => [
    provider,
    config.defaultModel,
  ]),
) as Record<AISDKProvider, string>;

const PROVIDER_SUPPORTED_MODELS = Object.fromEntries(
  providerModelEntries.map(([provider, config]) => [
    provider,
    config.supportedModels,
  ]),
) as unknown as Record<AISDKProvider, readonly string[]>;

const PROVIDER_ENV_VARS: Record<AISDKProvider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  ollama: [], // runs locally
};

const PROVIDER_PACKAGES: Record<AISDKProvider, string> = {
  anthropic: "@ai-sdk/anthropic",
  openai: "@ai-sdk/openai",
  openrouter: "@openrouter/ai-sdk-provider",
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
  openrouter: "createOpenRouter",
  google: "createGoogleGenerativeAI",
  groq: "createGroq",
  mistral: "createMistral",
  cohere: "createCohere",
  ollama: "createOllama",
};

function googleThinkingBudget(effort: string) {
  if (effort === "low") return 1024;
  // "medium" is a normalized effort for Gemini models; without this case it
  // fell through to the -1 ("dynamic/unlimited") fallback, so selecting
  // medium effort silently uncapped the thinking budget.
  if (effort === "medium") return 4096;
  if (effort === "high") return 8000;
  if (effort === "xhigh") return 16_000;
  if (effort === "max") return 32_000;
  return -1;
}

/**
 * Map a reasoning effort level to Gemini 3.x thinkingLevel string.
 * Gemini 3 models (gemini-3.*) reject thinkingBudget and require thinkingLevel
 * with values 'low' | 'medium' | 'high'. Gemini 3.0 only supports 'low'/'high';
 * Gemini 3.1+ adds 'medium'. We always emit 'medium' for medium effort since it
 * is accepted by 3.1+, and 3.0 is expected to be phased out quickly.
 */
function gemini3ThinkingLevel(effort: string): string {
  if (effort === "low") return "low";
  // medium/high/xhigh/max all map to the strongest available level for Gemini 3
  return "high";
}

// ---------------------------------------------------------------------------
// AISDKEngine implementation
// ---------------------------------------------------------------------------

/** Config accepted by every `ai-sdk:*` engine. */
export interface AISDKEngineConfig {
  /** Override the provider's default model (also becomes the engine's defaultModel). */
  model?: string;
  /** API key — falls back to the provider-specific env var if omitted. */
  apiKey?: string;
  /** Set false in request-scoped multi-tenant runs so provider packages cannot fall back to process.env. */
  allowEnvFallback?: boolean;
  /** Override the provider base URL (useful for proxies or OpenAI-compatible gateways). */
  baseUrl?: string;
  /** OpenRouter: `X-OpenRouter-Title` header for dashboard attribution. */
  appName?: string;
  /** OpenRouter: `HTTP-Referer` header for dashboard attribution. */
  appUrl?: string;
}

class AISDKEngine implements AgentEngine {
  readonly name: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly supportedModels: readonly string[];
  readonly capabilities: EngineCapabilities;

  private readonly provider: AISDKProvider;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly appName?: string;
  private readonly appUrl?: string;

  constructor(provider: AISDKProvider, config: AISDKEngineConfig) {
    this.provider = provider;
    this.name = `ai-sdk:${provider}`;
    this.label = `${capitalize(provider)} (AI SDK)`;
    this.defaultModel = config.model ?? PROVIDER_DEFAULT_MODELS[provider];
    this.supportedModels = PROVIDER_SUPPORTED_MODELS[provider];
    this.capabilities = PROVIDER_CAPABILITIES[provider];
    this.apiKey =
      config.apiKey ??
      (config.allowEnvFallback === false ? "" : getProviderApiKey(provider));
    this.baseUrl = config.baseUrl;
    this.appName = config.appName;
    this.appUrl = config.appUrl;
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
    const reasoningEffort = normalizeReasoningEffortForModel(
      opts.model,
      opts.reasoningEffort,
    );
    if (reasoningEffort) {
      if (this.provider === "anthropic") {
        providerOpts.anthropic = {
          ...((providerOpts.anthropic as object) ?? {}),
          thinking: (
            providerOpts.anthropic as { thinking?: unknown } | undefined
          )?.thinking ?? { type: "adaptive" },
          outputConfig: { effort: reasoningEffort },
        };
      } else if (this.provider === "openai") {
        providerOpts.openai = {
          ...((providerOpts.openai as object) ?? {}),
          reasoningEffort,
        };
      } else if (this.provider === "openrouter") {
        providerOpts.openrouter = {
          ...((providerOpts.openrouter as object) ?? {}),
          reasoning: { effort: reasoningEffort },
        };
      } else if (this.provider === "google") {
        // Gemini 3.x models reject thinkingBudget — they require thinkingLevel.
        // Gemini 2.5.x models use thinkingBudget (integer token count or -1).
        const isGemini3 = /^gemini-3/.test(opts.model);
        providerOpts.google = {
          ...((providerOpts.google as object) ?? {}),
          thinkingConfig: isGemini3
            ? { thinkingLevel: gemini3ThinkingLevel(reasoningEffort) }
            : { thinkingBudget: googleThinkingBudget(reasoningEffort) },
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
        maxOutputTokens: resolveMaxOutputTokensForEngine(
          this.name,
          opts.maxOutputTokens,
        ),
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
      // Surface structured fields from AI SDK's APICallError so
      // isRetryableError can check statusCode/providerRetryable directly
      // rather than keyword-matching the message string.
      const statusCode: number | undefined =
        typeof err?.statusCode === "number" ? err.statusCode : undefined;
      const providerRetryable: boolean | undefined =
        typeof err?.isRetryable === "boolean" ? err.isRetryable : undefined;
      yield {
        type: "stop",
        reason: "error",
        error: err?.message ?? String(err),
        ...(statusCode !== undefined ? { statusCode } : {}),
        ...(providerRetryable !== undefined ? { providerRetryable } : {}),
      };
      throw err;
    }
  }

  private async createProviderModel(model: string): Promise<any> {
    const pkg = PROVIDER_PACKAGES[this.provider];
    let providerModule: any;
    try {
      providerModule = await importProviderPackage(this.provider);
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
    if (this.apiKey !== undefined) config.apiKey = this.apiKey;
    if (this.baseUrl) config.baseURL = this.baseUrl;
    // Scoped to openrouter — other providers' factories may reject unknown keys.
    if (this.provider === "openrouter") {
      if (this.appName) config.appName = this.appName;
      if (this.appUrl) config.appUrl = this.appUrl;
    }

    const provider = createFn(config);
    // Let first-party OpenAI use the AI SDK's default Responses path so newer
    // GPT reasoning models get the API OpenAI recommends. If someone points
    // the OpenAI provider at an OpenAI-compatible gateway, keep using Chat
    // Completions because many gateway base URLs do not implement Responses.
    return this.provider === "openai" && this.baseUrl
      ? provider.chat(model)
      : provider(model);
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createAISDKEngine(
  provider: AISDKProvider,
  config: Record<string, unknown> = {},
): AgentEngine {
  return new AISDKEngine(provider, config as AISDKEngineConfig);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Static string-literal imports so bundlers (Nitro/Rollup/Vercel) can analyze
// and include provider packages. A variable-based `import(pkg)` gets skipped.
async function importProviderPackage(provider: AISDKProvider): Promise<any> {
  switch (provider) {
    case "anthropic":
      return import("@ai-sdk/anthropic");
    case "openai":
      return import("@ai-sdk/openai");
    case "openrouter":
      return import("@openrouter/ai-sdk-provider");
    case "google":
      return import("@ai-sdk/google");
    case "groq":
      return import("@ai-sdk/groq");
    case "mistral":
      return import("@ai-sdk/mistral");
    case "cohere":
      return import("@ai-sdk/cohere");
    case "ollama":
      return import("ai-sdk-ollama");
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getProviderApiKey(provider: AISDKProvider): string | undefined {
  const envVars = PROVIDER_ENV_VARS[provider];
  for (const v of envVars) {
    const value = readDeployCredentialEnv(v);
    if (value) return value;
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
