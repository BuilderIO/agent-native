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
import {
  clampThinkingBudgetTokens,
  resolveMaxOutputTokensForEngine,
} from "./output-tokens.js";
import {
  splitSystemPromptForCache,
  stablePrefixCacheControl,
} from "./prompt-cache.js";
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
import type {
  AgentEngine,
  EngineCapabilities,
  EngineStreamOptions,
  EngineEvent,
} from "./types.js";

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

  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: this.apiKey, maxRetries: 1 });

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
    if (reasoningEffort && !extra.thinking) {
      if (supportsClaudeAdaptiveThinking(opts.model)) {
        extra.thinking = { type: "adaptive" };
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
    const apiStream = client.messages.stream(requestParams, {
      signal: firstEventAbort.signal,
    });

    const chunkState = createAnthropicChunkStreamState();
    const toolInputs = createStreamedToolInputState();

    try {
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
        finalMessage.content,
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
      const timedOut = firstEventAbort.didTimeout();
      const statusCode: number | undefined =
        typeof err?.status === "number"
          ? err.status
          : typeof err?.statusCode === "number"
            ? err.statusCode
            : undefined;
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
      if (statusCode === 401) {
        await recordProviderCredentialAuthFailure({
          key: "ANTHROPIC_API_KEY",
          value: this.apiKey,
          status: statusCode,
          code: "http_401",
          message: errorMessage,
        });
      }
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
  return new AnthropicEngine(apiKey);
}
