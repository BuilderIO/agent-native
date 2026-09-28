import { ssrfSafeFetch } from "../../extensions/url-safety.js";
import {
  clearProviderCredentialAuthFailure,
  readDeployCredentialEnv,
  recordProviderCredentialAuthFailure,
} from "../../server/credential-provider.js";
import {
  allowsSamplingParams,
  anthropicManualThinkingBudget,
  normalizeReasoningEffortForModel,
  supportsClaudeAdaptiveThinking,
} from "../../shared/reasoning-effort.js";
import { isNodeRuntime } from "../../shared/runtime.js";
import { AI_SDK_MODEL_CONFIG, type AISDKProvider } from "../model-config.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "./credential-errors.js";
import {
  classifyProviderError,
  describeErrorWithCauses,
} from "./error-detail.js";
import { createFirstEventAbortController } from "./first-event-timeout.js";
import { limitProviderTools } from "./limit-provider-tools.js";
import { isCustomOpenAiBaseUrl } from "./openai-compatible-endpoint.js";
import {
  clampThinkingBudgetTokens,
  resolveMaxOutputTokensForEngine,
} from "./output-tokens.js";
import { createProviderToolNameMap } from "./tool-name.js";
import {
  engineToolsToAISDK,
  engineMessagesToAISDK,
  aiSdkPartToEngineEvents,
  aiSdkStepToAssistantContent,
} from "./translate-ai-sdk.js";
import {
  createStreamedToolInputState,
  finalizeStreamedToolInputs,
  observeStreamedToolInput,
} from "./translate-anthropic.js";
import type {
  AgentEngine,
  EngineCapabilities,
  EngineStreamOptions,
  EngineEvent,
  EngineContentPart,
} from "./types.js";

export type { AISDKProvider } from "../model-config.js";

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
  if (effort === "medium") return 4096;
  if (effort === "high") return 8000;
  if (effort === "xhigh") return 16_000;
  if (effort === "max") return 32_000;
  return -1;
}

function gemini3ThinkingLevel(effort: string): string {
  if (effort === "low") return "low";
  if (effort === "medium") return "medium";
  return "high";
}

export interface AISDKEngineConfig {
  name?: string;
  label?: string;
  model?: string;
  supportedModels?: readonly string[];
  capabilities?: EngineCapabilities;
  acceptsCustomModels?: boolean;
  requestFetch?: typeof fetch;
  forceResponses?: boolean;
  omitMaxOutputTokens?: boolean;
  skipCredentialFailureTracking?: boolean;
  apiKey?: string;
  allowEnvFallback?: boolean;
  baseUrl?: string;
  appName?: string;
  appUrl?: string;
}

export function createProviderEndpointFetch(
  endpoint: string,
  allowedPrivateOrigins: readonly string[] = [],
): typeof fetch {
  return async (input, init) => {
    const endpointOrigin = new URL(endpoint).origin;
    const request = input instanceof Request ? new Request(input, init) : null;
    const url =
      request?.url ??
      (typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url);
    const targetOrigin = new URL(url).origin;
    if (targetOrigin !== endpointOrigin) {
      throw new Error(
        `SSRF blocked: provider request escaped its configured origin (${targetOrigin}).`,
      );
    }

    const requestInit = request
      ? ({
          ...(init ?? {}),
          method: request.method,
          headers: request.headers,
          body: request.body ?? undefined,
          signal: request.signal,
          cache: request.cache,
          credentials: request.credentials,
          integrity: request.integrity,
          keepalive: request.keepalive,
          mode: request.mode,
          redirect: request.redirect,
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy,
          ...(request.body ? { duplex: "half" as const } : {}),
        } as RequestInit)
      : init;

    const response = await ssrfSafeFetch(url, requestInit, {
      allowedPrivateOrigins,
      assertUrlAllowed(candidate) {
        if (new URL(candidate).origin !== endpointOrigin) {
          throw new Error(
            `SSRF blocked: provider endpoint redirected outside its configured origin (${candidate}).`,
          );
        }
      },
      followRedirects: false,
      requireDispatcher: isNodeRuntime(),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new Error(
        "SSRF blocked: provider endpoint redirects are disabled.",
      );
    }
    return response;
  };
}

class AISDKEngine implements AgentEngine {
  readonly name: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly supportedModels: readonly string[];
  readonly acceptsCustomModels: boolean;
  readonly preserveCustomModels: boolean;
  readonly capabilities: EngineCapabilities;

  private readonly provider: AISDKProvider;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly requiredEnvVars: readonly string[];
  private readonly appName?: string;
  private readonly appUrl?: string;
  private readonly requestFetch?: typeof fetch;
  private readonly forceResponses: boolean;
  private readonly omitMaxOutputTokens: boolean;
  private readonly skipCredentialFailureTracking: boolean;

  constructor(provider: AISDKProvider, config: AISDKEngineConfig) {
    this.provider = provider;
    this.name = config.name ?? `ai-sdk:${provider}`;
    this.label = config.label ?? `${capitalize(provider)} (AI SDK)`;
    this.defaultModel = config.model ?? PROVIDER_DEFAULT_MODELS[provider];
    this.supportedModels =
      config.supportedModels ?? PROVIDER_SUPPORTED_MODELS[provider];
    this.acceptsCustomModels = config.acceptsCustomModels ?? true;
    this.preserveCustomModels =
      config.acceptsCustomModels === false
        ? false
        : provider === "ollama" ||
          provider === "openrouter" ||
          (provider === "openai" && isCustomOpenAiBaseUrl(config.baseUrl));
    this.capabilities = config.capabilities ?? PROVIDER_CAPABILITIES[provider];
    this.apiKey =
      config.apiKey ??
      (config.allowEnvFallback === false ? "" : getProviderApiKey(provider));
    this.requiredEnvVars = PROVIDER_ENV_VARS[provider];
    this.baseUrl = config.baseUrl;
    this.appName = config.appName;
    this.appUrl = config.appUrl;
    this.requestFetch =
      config.requestFetch ??
      (this.baseUrl ? createProviderEndpointFetch(this.baseUrl) : undefined);
    this.forceResponses = config.forceResponses === true;
    this.omitMaxOutputTokens = config.omitMaxOutputTokens === true;
    this.skipCredentialFailureTracking =
      config.skipCredentialFailureTracking === true;
  }

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    // An absent key is not an anonymous request. Without this the provider
    // factory is constructed with no `apiKey`, the SDK omits the Authorization
    // header entirely, and the gateway's 401 comes back as
    // "Missing Authentication header" — which `classifyProviderError` codes
    // `http_401`, a transport failure naming the wrong cause. A scheduled job
    // then repeats that doomed unauthenticated request on every tick forever.
    // `builder-engine` and `anthropic-engine` already fail closed here; this
    // engine was the only one that did not.
    //
    // A LOCAL `baseUrl` is exempt: a self-hosted gateway on the same machine or
    // private network may legitimately accept unauthenticated requests. A public
    // one may not — every hosted provider requires a key, so exempting any
    // baseUrl at all reopened the same doomed unauthenticated request this
    // guard exists to stop, just for anyone pointing at a remote gateway.
    if (
      !this.apiKey &&
      !isLocalBaseUrl(this.baseUrl) &&
      this.requiredEnvVars.length > 0
    ) {
      yield {
        type: "stop",
        reason: "error",
        error: `${LLM_MISSING_CREDENTIALS_MESSAGE} (engine "${this.name}" has no ${this.requiredEnvVars.join(" or ")})`,
        errorCode: LLM_MISSING_CREDENTIALS_ERROR_CODE,
      };
      return;
    }

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

    const toolNameMap = createProviderToolNameMap(opts.tools, opts.messages);
    const providerTools = limitProviderTools(opts.tools);
    const aiSdkTools =
      providerTools.length > 0
        ? engineToolsToAISDK(providerTools, jsonSchema, toolNameMap)
        : undefined;
    const messages = engineMessagesToAISDK(opts.messages, {
      toolResultImages: this.capabilities.vision,
      toolNameMap,
    });

    const resolvedMaxOutputTokens = resolveMaxOutputTokensForEngine(
      this.name,
      opts.maxOutputTokens,
      opts.model,
    );

    const providerOpts: Record<string, unknown> = {};
    if (this.provider === "anthropic" && opts.providerOptions?.anthropic) {
      const anthropicOpts = opts.providerOptions.anthropic;
      if (anthropicOpts.thinking) {
        providerOpts.anthropic = {
          ...((providerOpts.anthropic as object) ?? {}),
          thinking: {
            type: "enabled",
            budgetTokens:
              typeof anthropicOpts.thinking.budgetTokens === "number"
                ? clampThinkingBudgetTokens(
                    anthropicOpts.thinking.budgetTokens,
                    resolvedMaxOutputTokens,
                  )
                : anthropicOpts.thinking.budgetTokens,
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
        const explicitThinking = (
          providerOpts.anthropic as { thinking?: unknown } | undefined
        )?.thinking;
        if (explicitThinking || supportsClaudeAdaptiveThinking(opts.model)) {
          providerOpts.anthropic = {
            ...((providerOpts.anthropic as object) ?? {}),
            thinking: explicitThinking ?? { type: "adaptive" },
            ...(explicitThinking
              ? {}
              : { outputConfig: { effort: reasoningEffort } }),
          };
        } else {
          const budgetTokens = clampThinkingBudgetTokens(
            anthropicManualThinkingBudget(reasoningEffort),
            resolvedMaxOutputTokens,
          );
          providerOpts.anthropic = {
            ...((providerOpts.anthropic as object) ?? {}),
            ...(budgetTokens === undefined
              ? {}
              : { thinking: { type: "enabled", budgetTokens } }),
          };
        }
      } else if (this.provider === "openai") {
        const forcedChatCompletionsWithTools =
          isCustomOpenAiBaseUrl(this.baseUrl) && aiSdkTools !== undefined;
        providerOpts.openai = {
          ...((providerOpts.openai as object) ?? {}),
          reasoningEffort: forcedChatCompletionsWithTools
            ? "none"
            : reasoningEffort,
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
        const thinkingBudget = googleThinkingBudget(reasoningEffort);
        providerOpts.google = {
          ...((providerOpts.google as object) ?? {}),
          thinkingConfig: isGemini3
            ? { thinkingLevel: gemini3ThinkingLevel(reasoningEffort) }
            : {
                thinkingBudget:
                  thinkingBudget > 0
                    ? clampThinkingBudgetTokens(
                        thinkingBudget,
                        resolvedMaxOutputTokens,
                      )
                    : thinkingBudget,
              },
        };
      }
    }

    const samplingAllowed = allowsSamplingParams({
      model: opts.model,
      thinkingEnabled:
        this.provider === "anthropic" &&
        Boolean(
          (providerOpts.anthropic as { thinking?: unknown } | undefined)
            ?.thinking,
        ),
    });

    let assistantContent: EngineContentPart[] = [];
    const firstEventAbort = createFirstEventAbortController(opts.abortSignal);
    const toolInputs = createStreamedToolInputState();

    try {
      const result = streamText({
        model: providerModel,
        system: opts.systemPrompt,
        messages,
        tools: aiSdkTools,
        ...(this.omitMaxOutputTokens
          ? {}
          : { maxOutputTokens: resolvedMaxOutputTokens }),
        maxRetries: 1,
        ...(samplingAllowed && opts.temperature !== undefined
          ? { temperature: opts.temperature }
          : {}),
        abortSignal: firstEventAbort.signal,
        onStepFinish: (step: any) => {
          assistantContent = aiSdkStepToAssistantContent(step, toolNameMap);
        },
        ...(Object.keys(providerOpts).length > 0
          ? { providerOptions: providerOpts }
          : {}),
      });

      let bufferedStop: EngineEvent | undefined;
      let sawFirstEvent = false;
      let credentialFailureRecorded = false;

      for await (const part of result.fullStream) {
        if (!sawFirstEvent && part?.type !== "start") {
          sawFirstEvent = true;
          firstEventAbort.markFirstEvent();
        }
        for (const event of aiSdkPartToEngineEvents(part, toolNameMap)) {
          observeStreamedToolInput(toolInputs, event);
          if (
            event.type === "stop" &&
            event.reason === "error" &&
            event.statusCode === 401 &&
            !this.skipCredentialFailureTracking
          ) {
            await recordProviderCredentialAuthFailure({
              key: PROVIDER_ENV_VARS[this.provider][0],
              value: this.apiKey,
              status: event.statusCode,
              code: event.errorCode ?? "http_401",
              message:
                event.error || "The model provider rejected the saved API key.",
            });
            credentialFailureRecorded = true;
          }
          if (event.type === "stop") {
            bufferedStop = event;
          } else {
            yield event;
          }
        }
      }

      if (firstEventAbort.didTimeout()) {
        throw new Error(
          `${firstEventAbort.timeoutMessage()}; the connection appears wedged.`,
        );
      }

      for (const part of assistantContent) {
        if (part.type === "tool-call") {
          observeStreamedToolInput(toolInputs, part);
        }
      }
      for (const recovered of finalizeStreamedToolInputs(
        toolInputs,
        assistantContent.flatMap((part) =>
          part.type === "tool-call" ? [part.id] : [],
        ),
      )) {
        if (recovered.type === "tool-call") {
          assistantContent.push({
            type: "tool-call",
            id: recovered.id,
            name: recovered.name,
            input: recovered.input,
          });
        }
        yield recovered;
      }

      yield { type: "assistant-content", parts: assistantContent };
      const stoppedWithError =
        bufferedStop?.type === "stop" && bufferedStop.reason === "error";
      if (
        !this.skipCredentialFailureTracking &&
        !credentialFailureRecorded &&
        !stoppedWithError
      ) {
        await clearProviderCredentialAuthFailure({
          key: PROVIDER_ENV_VARS[this.provider][0],
          value: this.apiKey,
        });
      }
      yield bufferedStop ?? { type: "stop", reason: "end_turn" };
    } catch (err: any) {
      const timedOut = firstEventAbort.didTimeout();
      const errorMessage = describeErrorWithCauses(err);
      const classification = classifyProviderError(err, timedOut);
      if (
        classification.statusCode === 401 &&
        !this.skipCredentialFailureTracking
      ) {
        await recordProviderCredentialAuthFailure({
          key: PROVIDER_ENV_VARS[this.provider][0],
          value: this.apiKey,
          status: classification.statusCode,
          code: "http_401",
          message: errorMessage,
        });
      }
      yield {
        type: "stop",
        reason: "error",
        error: errorMessage,
        ...classification,
      };
      throw err;
    } finally {
      firstEventAbort.cleanup();
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
    if (this.requestFetch) config.fetch = this.requestFetch;
    if (this.provider === "openrouter") {
      if (this.appName) config.appName = this.appName;
      if (this.appUrl) config.appUrl = this.appUrl;
    }

    const provider = createFn(config);
    return this.provider === "openai" &&
      !this.forceResponses &&
      isCustomOpenAiBaseUrl(this.baseUrl)
      ? provider.chat(model)
      : provider(model);
  }
}

export function createAISDKEngine(
  provider: AISDKProvider,
  config: Record<string, unknown> = {},
): AgentEngine {
  return new AISDKEngine(provider, config as AISDKEngineConfig);
}

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

/**
 * True only for a gateway on this machine or a private network — the case the
 * keyless exemption was written for. Anything routable on the public internet
 * (openrouter.ai, an api.* host, a cloud proxy) needs credentials, so treating
 * it as keyless just sends a request that cannot succeed.
 *
 * An unparseable value is NOT local: this gates a security-shaped decision, so
 * the ambiguous case has to take the safe branch and require a key.
 */
function isLocalBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
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

export {
  PROVIDER_CAPABILITIES,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_SUPPORTED_MODELS,
  PROVIDER_ENV_VARS,
  PROVIDER_PACKAGES,
};
