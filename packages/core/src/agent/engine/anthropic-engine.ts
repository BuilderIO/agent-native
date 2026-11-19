import type { ClientOptions } from "@anthropic-ai/sdk";

import {
  clearProviderCredentialAuthFailure,
  readDeployCredentialEnv,
  recordProviderCredentialAuthFailure,
} from "../../server/credential-provider.js";
import {
  allowsSamplingParams,
  anthropicManualThinkingBudget,
  claudeAdaptiveThinking,
  isUnsetReasoningEffort,
  normalizeReasoningEffortForModel,
  supportsClaudeAdaptiveThinking,
} from "../../shared/reasoning-effort.js";
import { ANTHROPIC_MODEL_CONFIG } from "../model-config.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "./credential-errors.js";
import {
  describeErrorWithCauses,
  isBareProviderRejectionMessage,
  PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
} from "./error-detail.js";
import { createFirstEventAbortController } from "./first-event-timeout.js";
import { limitProviderTools } from "./limit-provider-tools.js";
import { ANTHROPIC_API_ORIGIN } from "./openai-compatible-endpoint.js";
import {
  clampThinkingBudgetTokens,
  resolveMaxOutputTokensForEngine,
} from "./output-tokens.js";
import { toPrivateCompletionError } from "./private-completion-error.js";
import {
  splitSystemPromptForCache,
  stablePrefixCacheControl,
} from "./prompt-cache.js";
import { ProviderAuthenticationError } from "./provider-auth-error.js";
import { createProviderToolNameMap } from "./tool-name.js";
import {
  engineToolsToAnthropic,
  engineMessagesToAnthropic,
  anthropicContentToEngine,
  anthropicChunkToEngineEvents,
  createAnthropicChunkStreamState,
  createStreamedToolInputState,
  finalizeStreamedToolInputs,
  observeStreamedToolInput,
} from "./translate-anthropic.js";
import { startModelDispatch } from "./types.js";
import type {
  AgentEngine,
  EngineCapabilities,
  EngineStreamOptions,
  EngineEvent,
} from "./types.js";

/**
 * Per-invocation silent logger for the private path. The Anthropic SDK reads
 * `ANTHROPIC_LOG` and defaults its logger to `globalThis.console`, either of
 * which can echo provider-controlled request/response bodies. Passing an
 * explicit no-op logger with `logLevel: "off"` keeps every SDK log call inert
 * without mutating the environment or the global console.
 */
const PRIVATE_NOOP_LOGGER: NonNullable<ClientOptions["logger"]> = {
  error() {},
  warn() {},
  info() {},
  debug() {},
};

/**
 * Reads `status`/`statusCode` without trusting a hostile accessor: a getter
 * that throws is swallowed so the private boundary is never escaped by the
 * error it is trying to classify.
 */
function readPrivateStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["status", "statusCode"] as const) {
    let value: unknown;
    try {
      value = (error as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (typeof value === "number") return value;
  }
  return undefined;
}

export const ANTHROPIC_CAPABILITIES: EngineCapabilities = {
  thinking: true,
  promptCaching: true,
  vision: true,
  computerUse: true,
  parallelToolCalls: true,
};

export const ANTHROPIC_SUPPORTED_MODELS =
  ANTHROPIC_MODEL_CONFIG.supportedModels;
export const ANTHROPIC_DEFAULT_MODEL = ANTHROPIC_MODEL_CONFIG.defaultModel;

class AnthropicEngine implements AgentEngine {
  readonly name = "anthropic";
  readonly label = "Claude (Anthropic SDK)";
  readonly defaultModel = ANTHROPIC_DEFAULT_MODEL;
  readonly supportedModels = ANTHROPIC_SUPPORTED_MODELS;
  readonly acceptsCustomModels = true;
  readonly capabilities = ANTHROPIC_CAPABILITIES;
  readonly supportsPrivateContent = true;

  private readonly apiKey: string;
  private readonly baseURL: string | undefined;

  constructor(apiKey: string, baseURL: string | undefined) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    if (opts.privateContent === true) {
      yield* this.streamPrivate(opts);
      return;
    }
    yield* this.streamInternal(opts);
  }

  /**
   * Private boundary for direct `stream` callers. Everything after the opt-in
   * (SDK import/construction, request translation, dispatch, and iteration)
   * is retyped to a fixed-copy error; the canonical 401 helper is retained
   * because it is already a sanitized boundary.
   */
  private async *streamPrivate(
    opts: EngineStreamOptions,
  ): AsyncIterable<EngineEvent> {
    try {
      for await (const event of this.streamInternal(opts)) {
        if (event.type === "tool-call-error") {
          const failure = toPrivateCompletionError(undefined, "anthropic");
          yield failure.stopEvent();
          throw failure;
        }
        yield event;
      }
    } catch (error) {
      let authenticationError = false;
      try {
        authenticationError = error instanceof ProviderAuthenticationError;
      } catch {
        // A hostile prototype must not escape the private boundary.
      }
      if (authenticationError) {
        throw new ProviderAuthenticationError(
          "anthropic",
          readPrivateStatusCode(error),
        );
      }
      throw toPrivateCompletionError(error, "anthropic");
    }
  }

  private async *streamInternal(
    opts: EngineStreamOptions,
  ): AsyncIterable<EngineEvent> {
    const privateContent = opts.privateContent === true;
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    // An undefined baseURL lets the SDK read ANTHROPIC_BASE_URL itself.
    const client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      maxRetries: 1,
      ...(privateContent
        ? { logLevel: "off" as const, logger: PRIVATE_NOOP_LOGGER }
        : {}),
    });

    const toolNameMap = createProviderToolNameMap(opts.tools, opts.messages);
    const tools = engineToolsToAnthropic(
      limitProviderTools(opts.tools),
      toolNameMap,
    );
    const messages = engineMessagesToAnthropic(opts.messages, toolNameMap);
    const anthropicOpts = opts.providerOptions?.anthropic;

    const resolvedMaxOutputTokens = resolveMaxOutputTokensForEngine(
      this.name,
      opts.maxOutputTokens,
      opts.model,
    );

    const extra: Record<string, unknown> = {};
    if (anthropicOpts?.thinking) {
      extra.thinking = {
        type: anthropicOpts.thinking.type,
        budget_tokens:
          anthropicOpts.thinking.type === "enabled" &&
          typeof anthropicOpts.thinking.budgetTokens === "number"
            ? clampThinkingBudgetTokens(
                anthropicOpts.thinking.budgetTokens,
                resolvedMaxOutputTokens,
              )
            : anthropicOpts.thinking.budgetTokens,
      };
    }
    const reasoningEffort = normalizeReasoningEffortForModel(
      opts.model,
      opts.reasoningEffort,
    );
    if (
      !extra.thinking &&
      !reasoningEffort &&
      isUnsetReasoningEffort(opts.reasoningEffort) &&
      supportsClaudeAdaptiveThinking(opts.model)
    ) {
      // No effort chosen: keep adaptive thinking on and send no effort, so
      // the model's own default level applies.
      extra.thinking = claudeAdaptiveThinking(opts.model);
    }
    if (reasoningEffort && !extra.thinking) {
      if (supportsClaudeAdaptiveThinking(opts.model)) {
        extra.thinking = claudeAdaptiveThinking(opts.model);
        extra.output_config = { effort: reasoningEffort };
      } else {
        const budgetTokens = clampThinkingBudgetTokens(
          anthropicManualThinkingBudget(reasoningEffort),
          resolvedMaxOutputTokens,
        );
        if (budgetTokens !== undefined) {
          extra.thinking = { type: "enabled", budget_tokens: budgetTokens };
        }
      }
    }

    const samplingAllowed = allowsSamplingParams({
      model: opts.model,
      thinkingEnabled: Boolean(extra.thinking),
    });
    if (samplingAllowed && anthropicOpts?.topK !== undefined) {
      extra.top_k = anthropicOpts.topK;
    }

    const cacheEnabled = anthropicOpts?.cacheControl !== false;
    const { stable, volatile } = splitSystemPromptForCache(opts.systemPrompt);
    const systemBlocks: any[] = [{ type: "text", text: stable }];
    if (cacheEnabled) {
      systemBlocks[0].cache_control = stablePrefixCacheControl();
    }
    if (volatile) systemBlocks.push({ type: "text", text: volatile });

    let cachedTools = tools;
    if (cacheEnabled && tools.length > 0) {
      cachedTools = [...tools];
      const last = { ...cachedTools[cachedTools.length - 1] } as any;
      last.cache_control = stablePrefixCacheControl();
      cachedTools[cachedTools.length - 1] = last;
    }

    let cachedMessages = messages;
    if (cacheEnabled && messages.length > 0) {
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if ((messages[i] as any).role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx >= 0) {
        cachedMessages = [...messages];
        const lastMsg = { ...cachedMessages[lastUserIdx] } as any;
        if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
          const content = [...lastMsg.content];
          const lastBlock = { ...content[content.length - 1] } as any;
          lastBlock.cache_control = { type: "ephemeral" };
          content[content.length - 1] = lastBlock;
          lastMsg.content = content;
          cachedMessages[lastUserIdx] = lastMsg;
        }
      }
    }

    const requestParams: any = {
      model: opts.model,
      max_tokens: resolvedMaxOutputTokens,
      system: systemBlocks,
      tools: cachedTools.length > 0 ? cachedTools : undefined,
      messages: cachedMessages,
      ...(samplingAllowed && opts.temperature !== undefined
        ? { temperature: opts.temperature }
        : {}),
      ...extra,
    };

    if (!requestParams.tools) delete requestParams.tools;

    const firstEventAbort = createFirstEventAbortController(opts.abortSignal);
    // Set inside the dispatch callback, which control-flow narrowing cannot see.
    let providerDispatched = false as boolean;

    const chunkState = createAnthropicChunkStreamState();
    const toolInputs = createStreamedToolInputState();

    try {
      const dispatch = await startModelDispatch(opts, () => {
        providerDispatched = true;
        return client.messages.stream(requestParams, {
          signal: firstEventAbort.signal,
        });
      });
      if (!dispatch.started) return;
      const apiStream = dispatch.value;
      for await (const chunk of apiStream) {
        firstEventAbort.markFirstEvent();
        const events = anthropicChunkToEngineEvents(
          chunk,
          chunkState,
          toolNameMap,
        );
        for (const event of events) {
          observeStreamedToolInput(toolInputs, event);
          yield event;
        }
      }

      const finalMessage = await apiStream.finalMessage();
      const assistantContent = anthropicContentToEngine(
        // The translator already drops unknown blocks. Filter them before its
        // ordinary diagnostic can interpolate a provider-controlled type.
        privateContent
          ? finalMessage.content.filter((block) =>
              ["text", "tool_use", "thinking", "redacted_thinking"].includes(
                block.type,
              ),
            )
          : finalMessage.content,
        toolNameMap,
      );

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

      if (finalMessage.usage) {
        const cacheReadTokens = finalMessage.usage.cache_read_input_tokens ?? 0;
        const cacheWriteTokens =
          finalMessage.usage.cache_creation_input_tokens ?? 0;
        yield {
          type: "usage",
          inputTokens:
            (finalMessage.usage.input_tokens ?? 0) +
            cacheReadTokens +
            cacheWriteTokens,
          outputTokens: finalMessage.usage.output_tokens ?? 0,
          cacheReadTokens,
          cacheWriteTokens,
        };
      }

      yield { type: "assistant-content", parts: assistantContent };
      await clearProviderCredentialAuthFailure({
        key: "ANTHROPIC_API_KEY",
        value: this.apiKey,
      });

      const stopReason = finalMessage.stop_reason ?? "end_turn";
      yield {
        type: "stop",
        reason:
          stopReason === "tool_use"
            ? "tool_use"
            : stopReason === "max_tokens"
              ? "max_tokens"
              : "end_turn",
      };
    } catch (err: any) {
      if (privateContent) {
        const privateStatus = readPrivateStatusCode(err);
        if (privateStatus === 401) {
          const failure = new ProviderAuthenticationError(
            "anthropic",
            privateStatus,
          );
          if (providerDispatched) {
            await recordProviderCredentialAuthFailure({
              key: "ANTHROPIC_API_KEY",
              value: this.apiKey,
              ...failure.details(),
            });
          }
          yield failure.stopEvent();
          throw failure;
        }
        // Never read the provider message or causes on the private path: the
        // safe status read above is the only field consulted before retyping.
        const privateError = toPrivateCompletionError(err, "anthropic");
        yield privateError.stopEvent();
        throw privateError;
      }
      const timedOut = firstEventAbort.didTimeout();
      const statusCode: number | undefined =
        typeof err?.status === "number"
          ? err.status
          : typeof err?.statusCode === "number"
            ? err.statusCode
            : undefined;
      if (statusCode === 401) {
        const failure = new ProviderAuthenticationError(
          "anthropic",
          statusCode,
        );
        if (providerDispatched) {
          await recordProviderCredentialAuthFailure({
            key: "ANTHROPIC_API_KEY",
            value: this.apiKey,
            ...failure.details(),
          });
        }
        yield failure.stopEvent();
        throw failure;
      }
      if (!providerDispatched) throw err;
      const rawMessage: string = err?.message ?? String(err);
      const errorMessage = timedOut
        ? `${firstEventAbort.timeoutMessage()}; the connection appears wedged.`
        : describeErrorWithCauses(err);
      const isConnectionError =
        !timedOut &&
        statusCode === undefined &&
        rawMessage.trim().toLowerCase() === "connection error.";
      const isBareForbidden =
        statusCode === 403 &&
        (isBareProviderRejectionMessage(rawMessage) ||
          isBareProviderRejectionMessage(errorMessage));
      yield {
        type: "stop",
        reason: "error",
        error: errorMessage,
        ...(statusCode !== undefined
          ? isBareForbidden
            ? {
                errorCode: PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
                statusCode,
                providerRetryable: true,
              }
            : { errorCode: `http_${statusCode}`, statusCode }
          : isConnectionError || timedOut
            ? {
                errorCode: "provider_network_error",
                providerRetryable: true,
              }
            : {}),
      };
      throw err;
    } finally {
      firstEventAbort.cleanup();
    }
  }
}

export function createAnthropicEngine(
  config: Record<string, unknown> = {},
): AgentEngine {
  const allowEnvFallback = config.allowEnvFallback !== false;
  const apiKey =
    (config.apiKey as string | undefined) ??
    (allowEnvFallback ? readDeployCredentialEnv("ANTHROPIC_API_KEY") : "") ??
    "";
  if (!apiKey) {
    return {
      name: "anthropic",
      label: "Claude (Anthropic SDK)",
      defaultModel: ANTHROPIC_DEFAULT_MODEL,
      supportedModels: ANTHROPIC_SUPPORTED_MODELS,
      acceptsCustomModels: true,
      capabilities: ANTHROPIC_CAPABILITIES,
      async *stream() {
        yield {
          type: "stop" as const,
          reason: "error" as const,
          error: LLM_MISSING_CREDENTIALS_MESSAGE,
          errorCode: LLM_MISSING_CREDENTIALS_ERROR_CODE,
        };
      },
    };
  }
  // Only the deployment's own key may follow a deployment ANTHROPIC_BASE_URL;
  // hosts inject gateway URLs there that reject every other key.
  const deploymentKey = readDeployCredentialEnv("ANTHROPIC_API_KEY");
  return new AnthropicEngine(
    apiKey,
    deploymentKey && apiKey === deploymentKey
      ? undefined
      : ANTHROPIC_API_ORIGIN,
  );
}
