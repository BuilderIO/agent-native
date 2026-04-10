/**
 * AnthropicEngine — wraps @anthropic-ai/sdk for use as an AgentEngine.
 *
 * This is the default, best-in-class engine. It supports all Anthropic-native
 * features: extended thinking, prompt caching, vision, computer use, and
 * parallel tool calls.
 *
 * All providerOptions.anthropic fields are forwarded directly to the SDK.
 */

import type {
  AgentEngine,
  EngineCapabilities,
  EngineStreamOptions,
  EngineEvent,
  EngineContentPart,
} from "./types.js";
import {
  engineToolsToAnthropic,
  engineMessagesToAnthropic,
  anthropicContentToEngine,
  anthropicChunkToEngineEvents,
} from "./translate-anthropic.js";

export const ANTHROPIC_CAPABILITIES: EngineCapabilities = {
  thinking: true,
  promptCaching: true,
  vision: true,
  computerUse: true,
  parallelToolCalls: true,
};

export const ANTHROPIC_SUPPORTED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
] as const;

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

class AnthropicEngine implements AgentEngine {
  readonly name = "anthropic";
  readonly label = "Claude (Anthropic SDK)";
  readonly defaultModel = ANTHROPIC_DEFAULT_MODEL;
  readonly supportedModels = ANTHROPIC_SUPPORTED_MODELS;
  readonly capabilities = ANTHROPIC_CAPABILITIES;

  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: this.apiKey });

    const tools = engineToolsToAnthropic(opts.tools);
    const messages = engineMessagesToAnthropic(opts.messages);
    const anthropicOpts = opts.providerOptions?.anthropic;

    // Build extra body params for Anthropic-native features
    const extra: Record<string, unknown> = {};
    if (anthropicOpts?.thinking) {
      extra.thinking = {
        type: anthropicOpts.thinking.type,
        budget_tokens: anthropicOpts.thinking.budgetTokens,
      };
    }
    if (anthropicOpts?.topK !== undefined) {
      extra.top_k = anthropicOpts.topK;
    }

    // Apply prompt caching to the system prompt if requested.
    // We pass the system prompt as a structured array so we can add cache_control.
    const systemBlocks: any[] = [{ type: "text", text: opts.systemPrompt }];
    if (anthropicOpts?.cacheControl) {
      systemBlocks[0].cache_control = { type: "ephemeral" };
    }

    // Apply cache_control to the last tool definition when caching is enabled.
    // Anthropic caches the prefix up to and including the last cached block.
    let cachedTools = tools;
    if (anthropicOpts?.cacheControl && tools.length > 0) {
      cachedTools = [...tools];
      const last = { ...cachedTools[cachedTools.length - 1] } as any;
      last.cache_control = { type: "ephemeral" };
      cachedTools[cachedTools.length - 1] = last;
    }

    const requestParams: any = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16384,
      system: systemBlocks,
      tools: cachedTools.length > 0 ? cachedTools : undefined,
      messages,
      ...(opts.temperature !== undefined
        ? { temperature: opts.temperature }
        : {}),
      ...extra,
    };

    // Remove undefined tools to avoid Anthropic API validation errors
    if (!requestParams.tools) delete requestParams.tools;

    const apiStream = client.messages.stream(requestParams, {
      signal: opts.abortSignal,
    });

    let thinkingText = "";
    let thinkingSignature = "";

    try {
      for await (const chunk of apiStream) {
        const events = anthropicChunkToEngineEvents(chunk);
        for (const event of events) {
          if (event.type === "thinking-delta") {
            thinkingText += event.text;
            if (event.signature) thinkingSignature = event.signature;
          }
          yield event;
        }
      }

      const finalMessage = await apiStream.finalMessage();
      const assistantContent = anthropicContentToEngine(finalMessage.content);

      // Emit usage
      if (finalMessage.usage) {
        yield {
          type: "usage",
          inputTokens: finalMessage.usage.input_tokens ?? 0,
          outputTokens: finalMessage.usage.output_tokens ?? 0,
          cacheReadTokens:
            (finalMessage.usage as any).cache_read_input_tokens ?? 0,
          cacheWriteTokens:
            (finalMessage.usage as any).cache_creation_input_tokens ?? 0,
        };
      }

      // Emit stop reason
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

      // Store the final assistant content for the caller via a side channel.
      // runAgentLoop reads this via the assistantContentRef passed in opts.
      // We attach it as a non-enumerable symbol property.
      (opts as any)[ASSISTANT_CONTENT_KEY] = assistantContent;
    } catch (err: any) {
      yield {
        type: "stop",
        reason: "error",
        error: err?.message ?? String(err),
      };
      throw err;
    }
  }
}

/**
 * Symbol used by AnthropicEngine to return the final assistant content blocks
 * back to runAgentLoop without changing the EngineEvent stream shape.
 */
export const ASSISTANT_CONTENT_KEY = Symbol("assistantContent");

/**
 * Create an AnthropicEngine instance.
 * Falls back to ANTHROPIC_API_KEY env var if no key is provided.
 */
export function createAnthropicEngine(
  config: Record<string, unknown> = {},
): AgentEngine {
  const apiKey =
    (config.apiKey as string | undefined) ??
    process.env.ANTHROPIC_API_KEY ??
    "";
  if (!apiKey) {
    // Return a "missing key" engine that immediately errors
    return {
      name: "anthropic",
      label: "Claude (Anthropic SDK)",
      defaultModel: ANTHROPIC_DEFAULT_MODEL,
      supportedModels: ANTHROPIC_SUPPORTED_MODELS,
      capabilities: ANTHROPIC_CAPABILITIES,
      async *stream() {
        yield {
          type: "stop" as const,
          reason: "error" as const,
          error: "ANTHROPIC_API_KEY is not set",
        };
      },
    };
  }
  return new AnthropicEngine(apiKey);
}
