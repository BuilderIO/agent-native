/**
 * BuilderEngine — HTTP client for the Builder.io managed LLM gateway.
 *
 * The gateway accepts an Anthropic-shaped request body and streams events as
 * JSONL. This engine translates the framework's EngineStreamOptions into the
 * gateway request, parses the streamed events into EngineEvent items, and
 * maps gateway error responses (402 quota, 403 disabled, 401 auth, 429
 * concurrency) into structured stop events that carry an upgrade URL when
 * the chat UI needs to prompt the user to upgrade.
 *
 * Credentials come from BUILDER_PRIVATE_KEY (set via the Builder CLI-auth
 * onboarding flow). Base URL is overridable via BUILDER_GATEWAY_BASE_URL.
 */

import type {
  AgentEngine,
  EngineCapabilities,
  EngineContentPart,
  EngineEvent,
  EngineStreamOptions,
} from "./types.js";
import {
  engineMessagesToAnthropic,
  engineToolsToAnthropic,
} from "./translate-anthropic.js";
import {
  getBuilderAuthHeader,
  getBuilderGatewayBaseUrl,
} from "../../server/credential-provider.js";

export const BUILDER_CAPABILITIES: EngineCapabilities = {
  thinking: true,
  promptCaching: true,
  vision: true,
  computerUse: false,
  parallelToolCalls: true,
};

export const BUILDER_SUPPORTED_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-5-4",
  "gpt-5-4-mini",
  "gpt-5-1-codex-mini",
  "gemini-3-1-pro",
  "gemini-3-0-flash",
  "grok-code-fast",
  "qwen3-coder",
  "kimi-k2-5",
  "deepseek-v3-1",
  "z-ai-glm-4-5",
] as const;

export const BUILDER_DEFAULT_MODEL = "claude-sonnet-4-6";

function mapReasoningEffort(budgetTokens: number): "low" | "medium" | "high" {
  if (budgetTokens < 2000) return "low";
  if (budgetTokens < 8000) return "medium";
  return "high";
}

/**
 * Build the URL the chat UI should link to when a user hits a quota error.
 * Deep-links to the connected org's billing page when BUILDER_ORG_NAME is
 * known, else falls back to the generic account billing page.
 */
function buildUpgradeUrl(): string {
  const orgName = process.env.BUILDER_ORG_NAME;
  if (orgName) {
    return `https://builder.io/app/organizations/${encodeURIComponent(orgName)}/billing`;
  }
  return "https://builder.io/account/billing";
}

interface GatewayErrorBody {
  code?: string;
  message?: string;
  usageInfo?: {
    plan?: string;
    limitExceeded?: string;
    isEnterprise?: boolean;
  };
}

class BuilderEngine implements AgentEngine {
  readonly name = "builder";
  readonly label = "Builder.io Gateway";
  readonly defaultModel = BUILDER_DEFAULT_MODEL;
  readonly supportedModels = BUILDER_SUPPORTED_MODELS;
  readonly capabilities = BUILDER_CAPABILITIES;

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    const authHeader = getBuilderAuthHeader();
    if (!authHeader) {
      yield {
        type: "stop",
        reason: "error",
        error: "BUILDER_PRIVATE_KEY is not set",
        errorCode: "missing_credentials",
      };
      return;
    }

    const messages = engineMessagesToAnthropic(opts.messages);
    const tools = engineToolsToAnthropic(opts.tools);
    const thinkingBudget =
      opts.providerOptions?.anthropic?.thinking?.budgetTokens;

    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(opts.maxOutputTokens !== undefined
        ? { max_tokens: opts.maxOutputTokens }
        : {}),
      ...(typeof thinkingBudget === "number"
        ? { reasoning_effort: mapReasoningEffort(thinkingBudget) }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${getBuilderGatewayBaseUrl()}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(body),
        signal: opts.abortSignal,
      });
    } catch (err) {
      yield {
        type: "stop",
        reason: "error",
        error: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    if (!response.ok) {
      yield* emitHttpError(response);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield {
        type: "stop",
        reason: "error",
        error: "Builder gateway response has no body",
      };
      return;
    }

    yield* parseJsonlStream(reader);
  }
}

async function* emitHttpError(response: Response): AsyncIterable<EngineEvent> {
  const status = response.status;
  let errBody: GatewayErrorBody = {};
  try {
    errBody = (await response.json()) as GatewayErrorBody;
  } catch {
    try {
      errBody.message = await response.text();
    } catch {
      // Ignore — errBody stays empty
    }
  }
  const code = errBody.code ?? `http_${status}`;
  const message = errBody.message ?? `Builder gateway returned ${status}`;

  if (code.startsWith("credits-limit")) {
    yield {
      type: "stop",
      reason: "error",
      error: message,
      errorCode: code,
      upgradeUrl: buildUpgradeUrl(),
    };
    return;
  }
  if (code === "gateway_not_enabled") {
    yield {
      type: "stop",
      reason: "error",
      error: message,
      errorCode: code,
    };
    return;
  }
  if (status === 401 || code === "unauthorized") {
    yield {
      type: "stop",
      reason: "error",
      error:
        message ||
        "Builder authentication failed. Reconnect Builder via Settings → LLM.",
      errorCode: "unauthorized",
    };
    return;
  }
  if (status === 403) {
    yield {
      type: "stop",
      reason: "error",
      error: message,
      errorCode: code,
    };
    return;
  }
  if (status === 429 || code === "too_many_concurrent_requests") {
    // Include "too many requests" in the message so production-agent's
    // isRetryableError picks it up and retries the turn.
    yield {
      type: "stop",
      reason: "error",
      error: `${message} (too many requests)`,
      errorCode: code,
    };
    return;
  }
  yield {
    type: "stop",
    reason: "error",
    error: message,
    errorCode: code,
  };
}

async function* parseJsonlStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<EngineEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  const parts: EngineContentPart[] = [];
  let pendingText = "";
  let pendingThinking: { text: string; signature?: string } | null = null;

  const flushPending = () => {
    if (pendingText) {
      parts.push({ type: "text", text: pendingText });
      pendingText = "";
    }
    if (pendingThinking) {
      parts.push({
        type: "thinking",
        text: pendingThinking.text,
        ...(pendingThinking.signature !== undefined
          ? { signature: pendingThinking.signature }
          : {}),
      });
      pendingThinking = null;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");
        if (!line) continue;

        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          yield {
            type: "stop",
            reason: "error",
            error: `Builder gateway emitted invalid JSONL: ${line}`,
          };
          return;
        }

        switch (event.type) {
          case "text-delta": {
            const text = event.text ?? "";
            pendingText += text;
            yield { type: "text-delta", text };
            break;
          }

          case "thinking-delta": {
            const text = event.text ?? "";
            if (!pendingThinking) pendingThinking = { text: "" };
            pendingThinking.text += text;
            if (event.signature) pendingThinking.signature = event.signature;
            yield {
              type: "thinking-delta",
              text,
              ...(event.signature ? { signature: event.signature } : {}),
            };
            break;
          }

          case "tool-call-delta":
            // Engine contract has no equivalent; drop. The authoritative
            // `tool-call` event follows with the fully-parsed input.
            break;

          case "tool-call": {
            flushPending();
            parts.push({
              type: "tool-call",
              id: event.id,
              name: event.name,
              input: event.input,
            });
            yield {
              type: "tool-call",
              id: event.id,
              name: event.name,
              input: event.input,
            };
            break;
          }

          case "usage": {
            const cacheWrite =
              (event.cacheCreatedTokens ?? 0) +
              (event.cacheCreated1hTokens ?? 0);
            yield {
              type: "usage",
              inputTokens: event.inputTokens ?? 0,
              outputTokens: event.outputTokens ?? 0,
              ...(event.cacheInputTokens !== undefined
                ? { cacheReadTokens: event.cacheInputTokens }
                : {}),
              ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
            };
            break;
          }

          case "stop": {
            flushPending();
            yield { type: "assistant-content", parts };

            const reason = event.reason ?? "end_turn";
            if (reason === "rate_limited") {
              // Include "rate_limit" in the message so production-agent's
              // isRetryableError picks it up and retries.
              yield {
                type: "stop",
                reason: "error",
                error: `rate_limit exceeded: ${event.error ?? "upstream provider rate limited"}`,
                errorCode: "rate_limited",
              };
            } else if (reason === "error") {
              yield {
                type: "stop",
                reason: "error",
                error: event.error ?? "Gateway error",
              };
            } else if (
              reason === "end_turn" ||
              reason === "tool_use" ||
              reason === "max_tokens" ||
              reason === "stop_sequence"
            ) {
              yield { type: "stop", reason };
            } else {
              yield {
                type: "stop",
                reason: "error",
                error: `Unknown stop reason: ${reason}`,
              };
            }
            return;
          }

          default:
            // Unknown event type — ignore for forward compat.
            break;
        }
      }
    }

    // Stream ended without a stop event — synthesize one so callers don't hang.
    flushPending();
    yield { type: "assistant-content", parts };
    yield {
      type: "stop",
      reason: "error",
      error: "Builder gateway stream ended without a stop event",
    };
  } catch (err) {
    yield {
      type: "stop",
      reason: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Release the reader on every exit path — early returns (invalid JSONL,
    // stop event) and generator abandonment both leave the underlying
    // Response body locked otherwise. cancel() also closes the socket.
    try {
      await reader.cancel();
    } catch {
      // Already cancelled or closed
    }
  }
}

export function createBuilderEngine(
  _config: Record<string, unknown> = {},
): AgentEngine {
  return new BuilderEngine();
}
