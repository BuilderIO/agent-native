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
 * Credentials come from BUILDER_PRIVATE_KEY + BUILDER_PUBLIC_KEY (set via the
 * Builder CLI-auth onboarding flow). Base URL is overridable via
 * BUILDER_GATEWAY_BASE_URL.
 */

import { captureError } from "../../server/capture-error.js";
import {
  clearBuilderCredentialAuthFailure,
  resolveBuilderCredentials,
  getBuilderGatewayBaseUrl,
  recordBuilderCredentialAuthFailure,
} from "../../server/credential-provider.js";
import {
  normalizeReasoningEffortForModel,
  type ReasoningEffort,
} from "../../shared/reasoning-effort.js";
import { isInBackgroundFunctionRuntime } from "../durable-background.js";
import { BUILDER_MODEL_CONFIG } from "../model-config.js";
import { getBuilderGatewayRequestHeaders } from "./builder-gateway-headers.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "./credential-errors.js";
import { resolveMaxOutputTokensForEngine } from "./output-tokens.js";
import {
  engineMessagesToBuilderGatewayAnthropic,
  engineToolsToAnthropic,
} from "./translate-anthropic.js";
import type {
  AgentEngine,
  EngineCapabilities,
  EngineContentPart,
  EngineEvent,
  EngineStreamOptions,
} from "./types.js";

export const BUILDER_CAPABILITIES: EngineCapabilities = {
  thinking: true,
  promptCaching: true,
  vision: true,
  computerUse: false,
  parallelToolCalls: true,
};

export const BUILDER_SUPPORTED_MODELS = BUILDER_MODEL_CONFIG.supportedModels;

// Keep the foreground hosted gateway timeout below the synchronous serverless
// wall so the agent loop can append a continuation and persist terminal state
// before the host hard-kills the invocation.
const DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS = 45_000;
const MAX_HOSTED_FOREGROUND_BUILDER_GATEWAY_TIMEOUT_MS = 45_000;
/**
 * Netlify background functions have a 15-minute wall. Keep the Builder gateway
 * ceiling below that, but above the run-manager's 13-minute soft-timeout so
 * durable background runs checkpoint before this timer wins.
 */
const MAX_BACKGROUND_BUILDER_GATEWAY_TIMEOUT_MS = 14 * 60_000;
/** Local and non-hosted runtimes have no synchronous serverless wall. */
const MAX_LOCAL_BUILDER_GATEWAY_TIMEOUT_MS =
  MAX_BACKGROUND_BUILDER_GATEWAY_TIMEOUT_MS;
const BUILDER_GATEWAY_NETWORK_ERROR_CODE = "builder_gateway_network_error";

export const BUILDER_DEFAULT_MODEL = BUILDER_MODEL_CONFIG.defaultModel;

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
 *
 * We can't deep-link to a per-org billing page from `BUILDER_ORG_NAME` because
 * that field is the org's display name (e.g. "Nicholas kipchumba Space"), not
 * a URL-safe slug or id. URL-encoding the display name produces segments like
 * `/app/organizations/Nicholas%20kipchumba%20Space/billing` which Builder's
 * router treats as unknown and silently bounces to `/app/projects`. The
 * Builder CLI-auth callback doesn't expose the org slug/id today, so we route
 * to the org-agnostic subscription page. Agent Native attribution lets Builder
 * skip generic onboarding for new users who land there from an upgrade CTA.
 */
async function buildUpgradeUrl(): Promise<string> {
  const url = new URL("https://builder.io/account/subscription");
  url.searchParams.set("signupSource", "agent-native");
  url.searchParams.set("agentNativeConnectSource", "gateway_quota_upgrade");
  url.searchParams.set("agentNativeFlow", "connect_llm");
  url.searchParams.set("framework", "agent-native");
  return url.toString();
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
    const creds = await resolveBuilderCredentials();
    const authHeader = creds.privateKey ? `Bearer ${creds.privateKey}` : null;
    const spaceId = creds.publicKey;
    const builderUserId = creds.userId;
    if (!authHeader || !spaceId) {
      yield {
        type: "stop",
        reason: "error",
        error: LLM_MISSING_CREDENTIALS_MESSAGE,
        errorCode: LLM_MISSING_CREDENTIALS_ERROR_CODE,
      };
      return;
    }

    const messages = engineMessagesToBuilderGatewayAnthropic(opts.messages);
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

    // Apply prompt caching to system + tools (stable prefix) and to the last
    // user message (moving cache breakpoint so growing history gets cached
    // across tool-loop iterations at ~90% off input cost).
    // Templates can opt out by setting providerOptions.anthropic.cacheControl=false.
    const cacheEnabled =
      opts.providerOptions?.anthropic?.cacheControl !== false;

    // System: wrap in array with cache_control when caching is on.
    const systemValue: unknown = opts.systemPrompt
      ? cacheEnabled
        ? [
            {
              type: "text",
              text: opts.systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ]
        : opts.systemPrompt
      : undefined;

    // Tools: add cache_control to the last tool definition.
    let cachedTools = tools;
    if (cacheEnabled && tools.length > 0) {
      cachedTools = [...tools];
      const last = { ...cachedTools[cachedTools.length - 1] } as any;
      last.cache_control = { type: "ephemeral" };
      cachedTools[cachedTools.length - 1] = last;
    }

    // Messages: add a moving cache breakpoint on the last user message's last
    // content block so the entire conversation prefix is cached.
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

    const body: Record<string, unknown> = {
      model: opts.model,
      messages: cachedMessages,
      ...(systemValue !== undefined ? { system: systemValue } : {}),
      ...(cachedTools.length > 0 ? { tools: cachedTools } : {}),
      max_tokens: resolveMaxOutputTokensForEngine(
        this.name,
        opts.maxOutputTokens,
        opts.model,
      ),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };

    const gatewayBaseUrl = getBuilderGatewayBaseUrl();
    const gatewayUrl = new URL(
      "messages",
      gatewayBaseUrl.endsWith("/") ? gatewayBaseUrl : `${gatewayBaseUrl}/`,
    );
    gatewayUrl.searchParams.set("apiKey", spaceId);
    const orgLabel = creds.orgName || "unknown-org";
    const tStart = Date.now();
    console.log(
      `[builder-engine] → POST ${gatewayUrl.origin}${gatewayUrl.pathname} model=${opts.model} tools=${tools.length} org=${orgLabel}`,
    );

    const gatewayTimeoutMs = getBuilderGatewayTimeoutMs();
    const gatewayAbort = createGatewayAbortSignal(
      opts.abortSignal,
      gatewayTimeoutMs,
    );
    try {
      let response: Response;
      try {
        response = await fetch(gatewayUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            "x-builder-api-key": spaceId,
            ...getBuilderGatewayRequestHeaders(),
            ...(builderUserId ? { "x-builder-user-id": builderUserId } : {}),
          },
          body: JSON.stringify(body),
          signal: gatewayAbort.signal,
        });
      } catch (err) {
        const timedOut = gatewayAbort.didTimeout();
        if (gatewayAbort.didTimeout()) {
          console.warn(
            `[builder-engine] gateway timed out after ${Date.now() - tStart}ms`,
          );
        }
        if (timedOut || isBuilderGatewayNetworkError(err)) {
          captureBuilderGatewayTransportError(err, {
            phase: "request",
            model: opts.model,
            gatewayUrl,
            timeoutMs: gatewayTimeoutMs,
            timedOut,
            elapsedMs: Date.now() - tStart,
          });
        }
        yield createBuilderGatewayTimeoutStop(err, timedOut, gatewayTimeoutMs);
        return;
      }

      console.log(
        `[builder-engine] ← ${response.status} ${response.statusText} in ${Date.now() - tStart}ms`,
      );

      if (!response.ok) {
        yield* emitHttpError(response);
        return;
      }

      // A successful gateway call proves the connected credentials are valid
      // again. Clear any prior auth-failure marker so status / chat-card
      // surfaces stop flagging the connection as broken. This is the only
      // self-healing path for workspace/env-managed credentials, which never
      // flow through writeBuilderCredentials.
      try {
        const creds = await resolveBuilderCredentials();
        await clearBuilderCredentialAuthFailure({
          privateKey: creds.privateKey,
          publicKey: creds.publicKey,
        });
      } catch {
        // Marker clearing is best-effort; a stale marker just means the user
        // sees "reconnect Builder" until the next successful call clears it.
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

      yield* parseJsonlStream(reader, opts.model, {
        abortSignal: gatewayAbort.signal,
        didGatewayTimeout: gatewayAbort.didTimeout,
        gatewayTimeoutMs,
        gatewayUrl,
        requestStartedAt: tStart,
      });
    } finally {
      gatewayAbort.cleanup();
    }
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
    await recordBuilderCredentialAuthFailure({ status, code, message });
    yield {
      type: "stop",
      reason: "error",
      error: "Builder authentication failed. Reconnect Builder via Settings.",
      errorCode: "builder_auth_error",
    };
    return;
  }
  if (status === 403 && isBuilderCredentialAuthError(message)) {
    await recordBuilderCredentialAuthFailure({ status, code, message });
    yield {
      type: "stop",
      reason: "error",
      error: "Builder authentication failed. Reconnect Builder via Settings.",
      errorCode: "builder_auth_error",
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
  if (code === "rate_limit_exceeded") {
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
    // isRetryableError picks up transient concurrency throttles and retries
    // the turn. Daily gateway caps use `rate_limit_exceeded` above and must
    // not loop.
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
  abortSignal?: AbortSignal,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await readStreamChunk(reader, abortSignal);
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
  // Flush any bytes the streaming decoder buffered for an incomplete multibyte
  // sequence at the end of the stream; otherwise a trailing multibyte char in
  // the final chunk is silently dropped from the last line.
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) yield tail;
}

async function* parseJsonlStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  model: string,
  captureContext: {
    abortSignal?: AbortSignal;
    didGatewayTimeout?: () => boolean;
    gatewayTimeoutMs?: number;
    gatewayUrl?: URL;
    requestStartedAt?: number;
  } = {},
): AsyncIterable<EngineEvent> {
  const gatewayTimeoutMs =
    captureContext.gatewayTimeoutMs ?? DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS;
  const parts: EngineContentPart[] = [];
  let pendingText = "";
  let pendingThinking: { text: string; signature?: string } | null = null;

  const flushPendingText = () => {
    if (pendingText) {
      parts.push({ type: "text", text: pendingText });
      pendingText = "";
    }
  };

  const flushPendingThinking = () => {
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

  const flushPending = () => {
    flushPendingText();
    flushPendingThinking();
  };

  try {
    for await (const line of readJsonlLines(
      reader,
      captureContext.abortSignal,
    )) {
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
          flushPendingThinking();
          pendingText += text;
          yield { type: "text-delta", text };
          break;
        }

        case "thinking-delta":
        case "reasoning-delta": {
          const text = event.text ?? "";
          flushPendingText();
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
          yield {
            type: "tool-input-delta",
            id: event.id,
            name: event.name,
            text:
              typeof event.argsTextDelta === "string"
                ? event.argsTextDelta
                : typeof event.delta === "string"
                  ? event.delta
                  : "",
          };
          break;

        case "heartbeat":
          yield { type: "gateway-heartbeat" };
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
          } else if (reason === "invalid_request") {
            // errorCode has no retry-trigger keywords, so isRetryableError
            // won't loop on broken history.
            const errMsg =
              event.error ||
              event.message ||
              "Builder gateway rejected the request as malformed.";
            const errCode =
              typeof event.errorCode === "string"
                ? event.errorCode
                : typeof event.code === "string"
                  ? event.code
                  : "invalid_request";
            console.warn(
              `[builder-engine] stop reason=invalid_request model=${model} code=${errCode} error=${errMsg}`,
            );
            yield {
              type: "stop",
              reason: "error",
              error: errMsg,
              errorCode: errCode,
            };
          } else if (reason === "error") {
            // Surface every diagnostic the gateway gave us so the user (and
            // our logs) get more than a bare "Gateway error". The gateway
            // sometimes emits an error stop event with no message — most
            // commonly when the upstream provider rejects the model for
            // this account (Opus quotas have hit this in practice).
            const explicitErrMsg = event.error || event.message || event.detail;
            const errMsg =
              explicitErrMsg ??
              `Gateway error (no detail; raw event: ${JSON.stringify(event)})`;
            const gatewayErrCode = event.errorCode ?? event.code;
            const isCredentialAuthError =
              Boolean(explicitErrMsg) &&
              isBuilderCredentialAuthError(String(errMsg));
            // Anthropic's bare "Connection error." often arrives here with no
            // gateway code. Tag it as a network error so in-run retries and
            // run-level resume treat it as transient instead of terminal.
            const isProviderConnectionError =
              typeof explicitErrMsg === "string" &&
              isProviderConnectionErrorMessage(String(explicitErrMsg));
            const errCode = isCredentialAuthError
              ? "builder_auth_error"
              : isProviderConnectionError
                ? BUILDER_GATEWAY_NETWORK_ERROR_CODE
                : (gatewayErrCode ??
                  (!explicitErrMsg ? "builder_gateway_error" : undefined));
            console.error(
              `[builder-engine] stop reason=error model=${model} code=${errCode ?? "(none)"} error=${errMsg}`,
            );
            if (isCredentialAuthError) {
              await recordBuilderCredentialAuthFailure({
                code:
                  typeof gatewayErrCode === "string" ? gatewayErrCode : errCode,
                message: String(errMsg),
              });
            }
            // No-detail gateway errors are opaque to the chat client — the
            // only way to debug them is from the gateway side. Capture rich
            // tags here (model, gatewayOrigin, requestId) so the gateway
            // team can search Sentry by requestId or filter by model. The
            // downstream run-manager will also capture the EngineError once
            // it's thrown, but without these tags.
            if (!explicitErrMsg) {
              captureBuilderGatewayNoDetailError({
                requestId:
                  typeof event.requestId === "string"
                    ? event.requestId
                    : undefined,
                model,
                gatewayUrl: captureContext.gatewayUrl,
                rawEvent: event,
              });
            }
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
    const timedOut = captureContext.didGatewayTimeout?.() ?? false;
    if (timedOut || isBuilderGatewayNetworkError(err)) {
      captureBuilderGatewayTransportError(err, {
        phase: "stream",
        model,
        gatewayUrl: captureContext.gatewayUrl,
        timeoutMs: gatewayTimeoutMs,
        timedOut,
        elapsedMs:
          typeof captureContext.requestStartedAt === "number"
            ? Date.now() - captureContext.requestStartedAt
            : undefined,
      });
    }
    yield createBuilderGatewayTimeoutStop(err, timedOut, gatewayTimeoutMs);
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

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!abortSignal) return reader.read();
  if (abortSignal.aborted) {
    return Promise.reject(abortSignal.reason ?? new Error("Stream aborted"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(abortSignal.reason ?? new Error("Stream aborted"));
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => {
        abortSignal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
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

function resolveMaxBuilderGatewayTimeoutMs(): number {
  if (isInBackgroundFunctionRuntime()) {
    return MAX_BACKGROUND_BUILDER_GATEWAY_TIMEOUT_MS;
  }

  if (!isHostedBuilderRuntime()) {
    return MAX_LOCAL_BUILDER_GATEWAY_TIMEOUT_MS;
  }

  try {
    const base = getBuilderGatewayBaseUrl();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(base)) {
      return MAX_LOCAL_BUILDER_GATEWAY_TIMEOUT_MS;
    }
  } catch {
    // ignore malformed override
  }
  return MAX_HOSTED_FOREGROUND_BUILDER_GATEWAY_TIMEOUT_MS;
}

function isHostedBuilderRuntime(): boolean {
  if (
    process.env.NETLIFY &&
    process.env.NETLIFY !== "false" &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  if (
    process.env.AWS_LAMBDA_FUNCTION_NAME &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  return Boolean(
    process.env.CF_PAGES ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.K_SERVICE,
  );
}

function getBuilderGatewayTimeoutMs(): number {
  const raw = process.env.AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS;
  const maxMs = resolveMaxBuilderGatewayTimeoutMs();
  if (!raw) return maxMs;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return maxMs;
  }
  return Math.min(parsed, maxMs);
}

function createGatewayAbortSignal(
  parentSignal: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal.reason);
    }
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) {
      controller.abort(new Error("Builder gateway request timed out"));
    }
  }, timeoutMs);

  if (parentSignal.aborted) abortFromParent();
  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

function isBuilderCredentialAuthError(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  const referencesAccessToken =
    lowerMessage.includes("personal access token") ||
    lowerMessage.includes("access token");
  const rejectedToken =
    lowerMessage.includes("invalid") ||
    lowerMessage.includes("inactive") ||
    lowerMessage.includes("expired") ||
    lowerMessage.includes("revoked");
  return (
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("private key") ||
    lowerMessage.includes("invalid token") ||
    lowerMessage.includes("invalid_token") ||
    lowerMessage.includes("token invalid") ||
    (referencesAccessToken && rejectedToken)
  );
}

function normalizeBuilderGatewayFetchError(
  err: unknown,
  timedOut: boolean,
  timeoutMs: number,
): string {
  if (timedOut) {
    return `Builder gateway timed out after ${formatTimeoutMs(
      timeoutMs,
    )} before the hosting function limit. Please retry; if this keeps happening, reduce the prompt size or try again when the gateway is less busy.`;
  }
  const message = errorMessage(err);
  if (isBuilderGatewayNetworkError(err)) {
    return `Builder gateway network error: ${message}`;
  }
  return message;
}

function createBuilderGatewayTimeoutStop(
  err: unknown,
  timedOut: boolean,
  timeoutMs: number,
): EngineEvent {
  const networkError = !timedOut && isBuilderGatewayNetworkError(err);
  return {
    type: "stop",
    reason: "error",
    error: normalizeBuilderGatewayFetchError(err, timedOut, timeoutMs),
    ...(timedOut
      ? { errorCode: "builder_gateway_timeout" }
      : networkError
        ? { errorCode: BUILDER_GATEWAY_NETWORK_ERROR_CODE }
        : {}),
  };
}

function formatTimeoutMs(timeoutMs: number): string {
  if (timeoutMs < 1000) return `${timeoutMs}ms`;
  return `${Math.round(timeoutMs / 1000)}s`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function errorSearchText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.name, err.message);
    const maybe = err as Error & {
      code?: unknown;
      cause?: unknown;
    };
    if (typeof maybe.code === "string") parts.push(maybe.code);
    if (maybe.cause) parts.push(errorSearchText(maybe.cause));
  } else {
    parts.push(String(err));
  }
  return parts.join(" ").toLowerCase();
}

function isBuilderGatewayNetworkError(err: unknown): boolean {
  const text = errorSearchText(err);
  return (
    text.includes("socket hang up") ||
    text.includes("econnreset") ||
    text.includes("enetreset") ||
    text.includes("econnaborted") ||
    text.includes("fetch failed") ||
    text.includes("network error") ||
    // Anthropic SDK's APIConnectionError default ("Connection error.") is
    // often forwarded by the Builder gateway as a stop event with no code.
    text.includes("connection error") ||
    text.includes("connection reset") ||
    text.includes("connection closed") ||
    text.includes("stream closed") ||
    text.includes("terminated")
  );
}

function isProviderConnectionErrorMessage(message: string): boolean {
  return message.trim().toLowerCase() === "connection error.";
}

function captureBuilderGatewayTransportError(
  err: unknown,
  context: {
    phase: "request" | "stream";
    model: string;
    gatewayUrl?: URL;
    timeoutMs: number;
    timedOut: boolean;
    elapsedMs?: number;
  },
): void {
  captureError(err, {
    route: "/_agent-native/agent-chat",
    tags: {
      source: "builder-engine",
      phase: context.phase,
      model: context.model,
      timedOut: context.timedOut ? "true" : "false",
      errorCode: context.timedOut
        ? "builder_gateway_timeout"
        : BUILDER_GATEWAY_NETWORK_ERROR_CODE,
    },
    extra: {
      gatewayOrigin: context.gatewayUrl?.origin,
      gatewayPath: context.gatewayUrl?.pathname,
      timeoutMs: context.timeoutMs,
      elapsedMs: context.elapsedMs,
    },
    contexts: {
      builderGateway: {
        phase: context.phase,
        model: context.model,
        gatewayOrigin: context.gatewayUrl?.origin,
        gatewayPath: context.gatewayUrl?.pathname,
        timeoutMs: context.timeoutMs,
        timedOut: context.timedOut,
        elapsedMs: context.elapsedMs,
      },
    },
  });
}

/**
 * Capture a Builder-gateway no-detail stop event to Sentry with the request
 * context the run-manager doesn't have. The gateway emits
 * `{type:"stop",reason:"error",requestId:"..."}` with no diagnostic — the
 * only way to debug it is from the gateway side, so we surface model,
 * gatewayOrigin, and requestId as searchable tags.
 */
function captureBuilderGatewayNoDetailError(context: {
  requestId?: string;
  model: string;
  gatewayUrl?: URL;
  rawEvent: unknown;
}): void {
  const err = new Error(
    context.requestId
      ? `Builder gateway stop reason=error with no detail (requestId=${context.requestId})`
      : "Builder gateway stop reason=error with no detail",
  );
  err.name = "BuilderGatewayNoDetailError";
  captureError(err, {
    route: "/_agent-native/agent-chat",
    tags: {
      source: "builder-engine",
      phase: "stream",
      model: context.model,
      errorCode: "builder_gateway_error",
      ...(context.requestId ? { gatewayRequestId: context.requestId } : {}),
    },
    extra: {
      gatewayOrigin: context.gatewayUrl?.origin,
      gatewayPath: context.gatewayUrl?.pathname,
      rawEvent: context.rawEvent,
    },
    contexts: {
      builderGateway: {
        phase: "stream",
        model: context.model,
        gatewayOrigin: context.gatewayUrl?.origin,
        gatewayPath: context.gatewayUrl?.pathname,
        requestId: context.requestId,
        errorCode: "builder_gateway_error",
      },
    },
  });
}
