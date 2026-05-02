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
  resolveBuilderAuthHeader,
  resolveBuilderCredential,
  getBuilderGatewayBaseUrl,
} from "../../server/credential-provider.js";
import {
  normalizeReasoningEffortForModel,
  type ReasoningEffort,
} from "../../shared/reasoning-effort.js";

export const BUILDER_CAPABILITIES: EngineCapabilities = {
  thinking: true,
  // TODO: flip to true once we forward `cache_control` blocks through to
  // the gateway request body. Today the engine builds the Anthropic-shaped
  // body without cache_control markers, and Anthropic caching is opt-in
  // (not automatic), so claiming `promptCaching: true` would overpromise.
  promptCaching: false,
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
  "gemini-3-1-flash-lite",
  "grok-code-fast",
  "qwen3-coder",
  "kimi-k2-5",
  "deepseek-v3-1",
  "z-ai-glm-4-5",
  "z-ai-glm-5-1",
] as const;

// Inherits from agent/default-model.ts — single source of truth so a
// new model release is a one-line bump.
import { DEFAULT_MODEL } from "../default-model.js";
export const BUILDER_DEFAULT_MODEL = DEFAULT_MODEL;

/**
 * Bucket an Anthropic `thinking.budgetTokens` value into the gateway's
 * legacy three-level `reasoning_effort` enum.
 *
 * The thresholds are chosen to align with typical Anthropic extended-thinking
 * budgets we see in the wild:
 *   • < 2000  → short one-step reasoning ("low")
 *   • 2000–8000 → multi-step thinking ("medium")
 *   • ≥ 8000  → deep planning / long chains ("high")
 *
 * 8000 is Anthropic's documented default in our framework (see
 * engine/types.ts:195), so callers that don't explicitly set
 * `budgetTokens` map to "high" via the default. If the gateway later
 * exposes more granular knobs or different thresholds, revisit this map.
 */
function mapReasoningEffort(budgetTokens: number): ReasoningEffort {
  if (budgetTokens < 2000) return "low";
  if (budgetTokens < 8000) return "medium";
  return "high";
}

/**
 * Build the URL the chat UI should link to when a user hits a quota error.
 * Deep-links to the connected org's billing page when BUILDER_ORG_NAME is
 * known, else falls back to the generic account billing page.
 */
async function buildUpgradeUrl(): Promise<string> {
  const orgName = await resolveBuilderCredential("BUILDER_ORG_NAME");
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
    const authHeader = await resolveBuilderAuthHeader();
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
    const explicitReasoningEffort = normalizeReasoningEffortForModel(
      opts.model,
      opts.reasoningEffort,
    );
    const reasoningEffort =
      explicitReasoningEffort ??
      (typeof thinkingBudget === "number"
        ? mapReasoningEffort(thinkingBudget)
        : undefined);

    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(opts.maxOutputTokens !== undefined
        ? { max_tokens: opts.maxOutputTokens }
        : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };

    const gatewayBaseUrl = getBuilderGatewayBaseUrl();
    const orgLabel =
      (await resolveBuilderCredential("BUILDER_ORG_NAME")) || "unknown-org";
    const tStart = Date.now();
    console.log(
      `[builder-engine] → POST ${gatewayBaseUrl}/messages model=${opts.model} tools=${tools.length} org=${orgLabel}`,
    );

    let response: Response;
    try {
      response = await fetch(`${gatewayBaseUrl}/messages`, {
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

    console.log(
      `[builder-engine] ← ${response.status} ${response.statusText} in ${Date.now() - tStart}ms`,
    );

    if (!response.ok) {
      yield* emitHttpError(response);
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const rawText = await response.text().catch(() => "");
      yield {
        type: "stop",
        reason: "error",
        error: normalizeGatewayErrorText(rawText, response.status || 502),
        errorCode: `http_${response.status || 502}`,
      };
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

    yield* parseJsonlStream(reader, opts.model);
  }
}

async function* emitHttpError(response: Response): AsyncIterable<EngineEvent> {
  const status = response.status;
  // Read the body once as text and then try to parse — calling `.json()`
  // and then `.text()` as a fallback fails because the body stream is
  // already consumed (TypeError: Body has already been read), so we'd
  // silently lose non-JSON error payloads like HTML proxy 502s.
  let errBody: GatewayErrorBody = {};
  const rawText = await response.text().catch(() => "");
  if (rawText) {
    try {
      errBody = JSON.parse(rawText) as GatewayErrorBody;
    } catch {
      errBody.message = normalizeGatewayErrorText(rawText, status);
    }
  }
  const code = errBody.code ?? `http_${status}`;
  const message = errBody.message ?? `Builder gateway returned ${status}`;

  // Belt-and-suspenders: 402 without a structured `credits-limit` code
  // (e.g. bare proxy response) still means quota → show upgrade CTA.
  if (code.startsWith("credits-limit") || status === 402) {
    yield {
      type: "stop",
      reason: "error",
      error: message,
      errorCode: code,
      upgradeUrl: await buildUpgradeUrl(),
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

// Yields one non-empty JSONL line at a time. Flushes any trailing content
// after the stream ends so a final event without a newline terminator
// isn't silently dropped — some gateway proxies close the connection on
// a complete line and the client must still process it.
async function* readJsonlLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      newlineIdx = buffer.indexOf("\n");
      if (line) yield line;
    }
  }
  const tail = buffer.trim();
  if (tail) yield tail;
}

async function* parseJsonlStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  model: string,
): AsyncIterable<EngineEvent> {
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
    for await (const line of readJsonlLines(reader)) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        const normalized = normalizeGatewayErrorText(line, 502);
        yield {
          type: "stop",
          reason: "error",
          error: `Builder gateway returned invalid JSONL: ${normalized.slice(
            0,
            240,
          )}`,
          errorCode: "http_502",
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
            (event.cacheCreatedTokens ?? 0) + (event.cacheCreated1hTokens ?? 0);
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
            // Surface every diagnostic the gateway gave us so the user (and
            // our logs) get more than a bare "Gateway error". The gateway
            // sometimes emits an error stop event with no message — most
            // commonly when the upstream provider rejects the model for
            // this account (Opus quotas have hit this in practice).
            const errMsg =
              event.error ??
              event.message ??
              event.detail ??
              `Gateway error (no detail; raw event: ${JSON.stringify(event)})`;
            const errCode = event.errorCode ?? event.code;
            console.error(
              `[builder-engine] stop reason=error model=${model} code=${errCode ?? "(none)"} error=${errMsg}`,
            );
            yield {
              type: "stop",
              reason: "error",
              error: errMsg,
              ...(errCode ? { errorCode: errCode } : {}),
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

function normalizeGatewayErrorText(raw: string, status: number): string {
  const text = raw.trim();
  const looksHtml = /<html[\s>]|<body[\s>]|<head[\s>]/i.test(text);
  const readable = looksHtml ? htmlToText(text) : text;
  if (/inactivity timeout/i.test(readable)) {
    return `Builder gateway returned ${status}: Inactivity Timeout. The upstream connection was idle too long before sending data.`;
  }
  if (looksHtml) {
    return `Builder gateway returned ${status}: ${readable.slice(0, 240)}`;
  }
  return readable;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createBuilderEngine(
  _config: Record<string, unknown> = {},
): AgentEngine {
  return new BuilderEngine();
}
