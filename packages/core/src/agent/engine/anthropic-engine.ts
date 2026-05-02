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
} from "./types.js";
import {
  engineToolsToAnthropic,
  engineMessagesToAnthropic,
  anthropicContentToEngine,
  anthropicChunkToEngineEvents,
} from "./translate-anthropic.js";
import { readDeployCredentialEnv } from "../../server/credential-provider.js";
import { normalizeReasoningEffortForModel } from "../../shared/reasoning-effort.js";

export const ANTHROPIC_CAPABILITIES: EngineCapabilities = {
  thinking: true,
  promptCaching: true,
  vision: true,
  computerUse: true,
  parallelToolCalls: true,
};

export const ANTHROPIC_SUPPORTED_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

// Single source of truth for the framework default lives in
// agent/default-model.ts. Engines, integrations, and the agent-chat plugin
// all read from the same constant, so bumping the default model is a
// one-line change.
import { DEFAULT_MODEL } from "../default-model.js";
export const ANTHROPIC_DEFAULT_MODEL = DEFAULT_MODEL;

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
    const reasoningEffort = normalizeReasoningEffortForModel(
      opts.model,
      opts.reasoningEffort,
    );
    if (reasoningEffort) {
      if (!extra.thinking) {
        extra.thinking = { type: "adaptive" };
      }
      extra.output_config = { effort: reasoningEffort };
    }

    // Apply prompt caching to the system prompt and tools by default.
    // Cache is pure upside: identical prefixes on subsequent turns get ~90%
    // off input cost and much faster time-to-first-token. If the prefix
    // changes turn-to-turn, it's a no-op. Templates can opt out by setting
    // providerOptions.anthropic.cacheControl = false.
    const cacheEnabled = anthropicOpts?.cacheControl !== false;
    const systemBlocks: any[] = [{ type: "text", text: opts.systemPrompt }];
    if (cacheEnabled) {
      systemBlocks[0].cache_control = { type: "ephemeral" };
    }

    // Apply cache_control to the last tool definition when caching is enabled.
    // Anthropic caches the prefix up to and including the last cached block.
    let cachedTools = tools;
    if (cacheEnabled && tools.length > 0) {
      cachedTools = [...tools];
      const last = { ...cachedTools[cachedTools.length - 1] } as any;
      last.cache_control = { type: "ephemeral" };
      cachedTools[cachedTools.length - 1] = last;
    }

    const requestParams: any = {
      model: opts.model,
      max_tokens: opts.maxOutputTokens ?? 32768,
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

      yield { type: "assistant-content", parts: assistantContent };

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
 * Create an AnthropicEngine instance.
 * Falls back to the deployment Anthropic key if no key is provided.
 */
export function createAnthropicEngine(
  config: Record<string, unknown> = {},
): AgentEngine {
  const apiKey =
    (config.apiKey as string | undefined) ??
    readDeployCredentialEnv("ANTHROPIC_API_KEY") ??
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
