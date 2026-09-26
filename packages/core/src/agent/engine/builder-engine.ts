
import {
  BUILDER_OAUTH_SCOPE,
  hasBuilderOAuthSession,
  markBuilderOAuthReconnectRequired,
  resolveBuilderOAuthRequestAccess,
} from "../../server/builder-oauth.js";
import { captureError } from "../../server/capture-error.js";
import {
  clearBuilderGatewayAuthFailure,
  isBuilderGatewayDeployConfigured,
  resolveBuilderGatewayCredentialsDetailed,
  getBuilderGatewayBaseUrl,
  recordBuilderGatewayAuthFailure,
  type BuilderGatewayLane,
} from "../../server/credential-provider.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { applyBuilderUtmTrackingParams } from "../../shared/builder-link-tracking.js";
import {
  allowsSamplingParams,
  normalizeReasoningEffortForModel,
  type ReasoningEffort,
} from "../../shared/reasoning-effort.js";
import { isInBackgroundFunctionRuntime } from "../durable-background.js";
import { BUILDER_MODEL_CONFIG } from "../model-config.js";
import { getBuilderGatewayRequestHeaders } from "./builder-gateway-headers.js";
import {
  gatewayVisitorFacingError,
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "./credential-errors.js";
import {
  classifyTerminalErrorCode,
  canonicalizeBuilderGatewayErrorCode,
  describeErrorWithCauses,
  extractRetryAfterMs,
  isBareProviderRejectionMessage,
  isBuilderGatewayInternalErrorMessage,
  isContextOverflowCode,
  isContextOverflowMessage,
  isCreditsLimitErrorCode,
  isProviderConnectionErrorMessage,
  PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
} from "./error-detail.js";
import { FIRST_STREAM_EVENT_TIMEOUT_MS } from "./first-event-timeout.js";
import { limitProviderTools } from "./limit-provider-tools.js";
import { resolveMaxOutputTokensForEngine } from "./output-tokens.js";
import {
  splitSystemPromptForCache,
  stablePrefixCacheControl,
} from "./prompt-cache.js";
import {
  createProviderToolNameMap,
  toEngineToolName,
  type ProviderToolNameMap,
} from "./tool-name.js";
import {
  createStreamedToolInputState,
  engineMessagesToBuilderGatewayAnthropic,
  engineToolsToAnthropic,
  finalizeStreamedToolInputs,
  observeStreamedToolInput,
} from "./translate-anthropic.js";
import type {
  AgentEngine,
  EngineCapabilities,
  EngineContentPart,
  EngineEvent,
  EngineRequestShape,
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

const DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS = 45_000;
const MAX_HOSTED_FOREGROUND_BUILDER_GATEWAY_TIMEOUT_MS = 45_000;
const MAX_BACKGROUND_BUILDER_GATEWAY_TIMEOUT_MS = 14 * 60_000;
const MAX_LOCAL_BUILDER_GATEWAY_TIMEOUT_MS =
  MAX_BACKGROUND_BUILDER_GATEWAY_TIMEOUT_MS;
const BUILDER_GATEWAY_NETWORK_ERROR_CODE = "builder_gateway_network_error";
export const BUILDER_MODEL_UNAUTHORIZED_ERROR_CODE =
  "builder_model_unauthorized";
/**
 * A truncated stream, not a rejected request: the client continues the partial
 * turn, so this is absent from `isRetryableError` on purpose.
 *
 * Every predicate that recognises `builder_gateway_network_error` must list this
 * too, or a truncated stream silently stops recovering: `isResumableEngineError`,
 * `isRecoverableContinuationError`, `shouldCaptureRunError`,
 * `isInternalContinuationError` and the client's `sse-event-processor`.
 */
export const BUILDER_GATEWAY_STREAM_ENDED_ERROR_CODE =
  "builder_gateway_stream_ended";

export const BUILDER_DEFAULT_MODEL = BUILDER_MODEL_CONFIG.defaultModel;

function mapReasoningEffort(budgetTokens: number): ReasoningEffort {
  if (budgetTokens < 2000) return "low";
  if (budgetTokens < 8000) return "medium";
  return "high";
}

async function buildUpgradeUrl(): Promise<string> {
  const url = new URL("https://builder.io/account/subscription");
  url.searchParams.set("signupSource", "agent-native");
  url.searchParams.set("agentNativeConnectSource", "gateway_quota_upgrade");
  url.searchParams.set("agentNativeFlow", "connect_llm");
  url.searchParams.set("framework", "agent-native");
  applyBuilderUtmTrackingParams(url.searchParams, {
    content: "gateway_quota_upgrade",
  });
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

export interface BuilderEngineCredentials {
  privateKey: string | null;
  publicKey: string | null;
  userId?: string | null;
  orgName?: string | null;
  lane?: BuilderGatewayLane | null;
}

function isBuilderCreditsLane(creds: BuilderEngineCredentials): boolean {
  if (!isBuilderGatewayDeployConfigured()) return false;
  return creds.lane ? creds.lane === "gateway-deploy" : true;
}

class BuilderEngine implements AgentEngine {
  readonly name = "builder";
  readonly label = "Builder.io Gateway";
  readonly defaultModel = BUILDER_DEFAULT_MODEL;
  readonly supportedModels = BUILDER_SUPPORTED_MODELS;
  readonly capabilities = BUILDER_CAPABILITIES;

  constructor(
    private readonly configuredCredentials?: BuilderEngineCredentials,
  ) {}

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    const creds =
      this.configuredCredentials ??
      (await resolveBuilderGatewayCredentialsDetailed());
    const ownerEmail = getRequestUserEmail();
    const orgId = getRequestOrgId() ?? null;
    let oauthAccess: Awaited<
      ReturnType<typeof resolveBuilderOAuthRequestAccess>
    > = null;
    let hasStoredOAuth = false;
    if (ownerEmail) {
      hasStoredOAuth = await hasBuilderOAuthSession(ownerEmail, orgId);
      if (hasStoredOAuth) {
        try {
          oauthAccess = await resolveBuilderOAuthRequestAccess({
            ownerEmail,
            requiredScope: BUILDER_OAUTH_SCOPE,
            orgId,
          });
        } catch {
          // coercion-ok: unusable OAuth custody must not fall back to legacy keys.
          oauthAccess = null;
        }
      }
    }
    const authHeader = oauthAccess
      ? `Bearer ${oauthAccess.accessToken}`
      : !hasStoredOAuth && creds.privateKey
        ? `Bearer ${creds.privateKey}`
        : null;
    const spaceId = creds.publicKey;
    const builderUserId = oauthAccess ? undefined : creds.userId;
    const creditsLane = oauthAccess ? false : isBuilderCreditsLane(creds);
    if (!authHeader || (!oauthAccess && !spaceId)) {
      yield gatewayErrorStop(
        {
          error: LLM_MISSING_CREDENTIALS_MESSAGE,
          errorCode: LLM_MISSING_CREDENTIALS_ERROR_CODE,
        },
        creditsLane,
      );
      return;
    }

    const requestedModel = opts.model.trim();
    const model =
      requestedModel.length === 0 || requestedModel === "auto"
        ? BUILDER_DEFAULT_MODEL
        : requestedModel;
    const toolNameMap = createProviderToolNameMap(opts.tools, opts.messages);
    const providerTools = limitProviderTools(opts.tools);
    const messages = engineMessagesToBuilderGatewayAnthropic(
      opts.messages,
      toolNameMap,
    );
    const tools = engineToolsToAnthropic(providerTools, toolNameMap);
    const thinkingBudget =
      opts.providerOptions?.anthropic?.thinking?.budgetTokens;
    const reasoningEffort = normalizeReasoningEffortForModel(
      model,
      opts.reasoningEffort ??
        (typeof thinkingBudget === "number"
          ? mapReasoningEffort(thinkingBudget)
          : undefined),
    );

    const cacheEnabled =
      opts.providerOptions?.anthropic?.cacheControl !== false;

    const { stable, volatile } = splitSystemPromptForCache(
      opts.systemPrompt ?? "",
    );
    const systemValue: unknown = opts.systemPrompt
      ? cacheEnabled
        ? [
            {
              type: "text",
              text: stable,
              cache_control: stablePrefixCacheControl(),
            },
            ...(volatile ? [{ type: "text", text: volatile }] : []),
          ]
        : stable + volatile
      : undefined;

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

    const samplingAllowed = allowsSamplingParams({
      model,
      thinkingEnabled: Boolean(reasoningEffort) && /claude/i.test(model),
    });

    const body: Record<string, unknown> = {
      model,
      messages: cachedMessages,
      ...(systemValue !== undefined ? { system: systemValue } : {}),
      ...(cachedTools.length > 0 ? { tools: cachedTools } : {}),
      max_tokens: resolveMaxOutputTokensForEngine(
        this.name,
        opts.maxOutputTokens,
        model,
      ),
      ...(samplingAllowed && typeof opts.temperature === "number"
        ? { temperature: opts.temperature }
        : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };

    const payload = JSON.stringify(body);
    const requestShape: EngineRequestShape = {
      model,
      payloadBytes: new TextEncoder().encode(payload).length,
      toolCount: cachedTools.length,
      messageCount: cachedMessages.length,
    };

    const gatewayBaseUrl = getBuilderGatewayBaseUrl();
    const gatewayUrl = new URL(
      "messages",
      gatewayBaseUrl.endsWith("/") ? gatewayBaseUrl : `${gatewayBaseUrl}/`,
    );
    if (spaceId && !oauthAccess) gatewayUrl.searchParams.set("apiKey", spaceId);
    const orgLabel = creds.orgName || "unknown-org";
    const tStart = Date.now();
    console.log(
      `[builder-engine] → POST ${gatewayUrl.origin}${gatewayUrl.pathname} model=${model} tools=${tools.length} effort=${reasoningEffort ?? "unset"} org=${orgLabel}`,
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
            ...(spaceId && !oauthAccess
              ? { "x-builder-api-key": spaceId }
              : {}),
            ...getBuilderGatewayRequestHeaders(),
            ...(builderUserId ? { "x-builder-user-id": builderUserId } : {}),
          },
          body: payload,
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
            model,
            gatewayUrl,
            timeoutMs: gatewayAbort.effectiveTimeoutMs(),
            timedOut,
            elapsedMs: Date.now() - tStart,
          });
        }
        yield createBuilderGatewayTimeoutStop(
          err,
          timedOut,
          gatewayAbort.effectiveTimeoutMs(),
          creditsLane,
          requestShape,
        );
        return;
      }

      console.log(
        `[builder-engine] ← ${response.status} ${response.statusText} in ${Date.now() - tStart}ms`,
      );

      if (!response.ok) {
        yield* emitHttpError(response, {
          creditsLane,
          requestShape,
          recordLegacyCredentialFailure: !oauthAccess,
          oauthScope: oauthAccess?.scope,
        });
        return;
      }

      if (!oauthAccess) {
        try {
          const legacyCreds =
            this.configuredCredentials ??
            (await resolveBuilderGatewayCredentialsDetailed());
          await clearBuilderGatewayAuthFailure({
            privateKey: legacyCreds.privateKey,
            publicKey: legacyCreds.publicKey,
          });
        } catch {
          // coercion-ok: clearing the legacy auth-failure marker is best-effort;
          // a stale marker only keeps the reconnect CTA until the next success.
        }
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        const rawText = await response.text().catch(() => "");
        const status = response.status || 502;
        const error = normalizeGatewayErrorText(rawText, status);
        yield gatewayErrorStop(
          {
            error,
            errorCode: `http_${status}`,
            statusCode: status,
            ...(isTransientGatewayFailure(error, status)
              ? { providerRetryable: true }
              : {}),
          },
          creditsLane,
          requestShape,
        );
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield gatewayErrorStop(
          {
            error: "Builder gateway response has no body",
            errorCode: "builder_gateway_error",
            statusCode: response.status,
          },
          creditsLane,
          requestShape,
        );
        return;
      }

      yield* parseJsonlStream(reader, model, {
        toolNameMap,
        creditsLane,
        abortSignal: gatewayAbort.signal,
        didGatewayTimeout: gatewayAbort.didTimeout,
        getGatewayTimeoutMs: gatewayAbort.effectiveTimeoutMs,
        onFirstEvent: gatewayAbort.markFirstEvent,
        gatewayUrl,
        requestStartedAt: tStart,
        requestShape,
        recordLegacyCredentialFailure: !oauthAccess,
        oauthScope: oauthAccess?.scope,
      });
    } finally {
      gatewayAbort.cleanup();
    }
  }
}

interface GatewayErrorStopDetails {
  error: string;
  errorCode?: string;
  upgradeUrl?: string;
  statusCode?: number;
  providerRetryable?: boolean;
  retryAfterMs?: number;
}

const RETRYABLE_GATEWAY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

const TRANSIENT_UPSTREAM_PATTERN =
  /overloaded|rate_limit|rate limit reached|too many requests|\b429\b|\b529\b|\b502\b|\b503\b|\b504\b|resource_exhausted|quota exceeded|socket hang up|connection reset|temporarily unavailable|timeout/i;

function isTransientGatewayFailure(
  rawMessage: string,
  status?: number,
): boolean {
  if (status !== undefined && RETRYABLE_GATEWAY_STATUSES.has(status)) {
    return true;
  }
  if (isBuilderGatewayInternalErrorMessage(rawMessage)) return true;
  return TRANSIENT_UPSTREAM_PATTERN.test(rawMessage);
}

function gatewayErrorStop(
  details: GatewayErrorStopDetails,
  creditsLane: boolean | undefined,
  requestShape?: EngineRequestShape,
): EngineEvent {
  const { error, errorCode, upgradeUrl, ...retry } = details;
  return {
    type: "stop",
    reason: "error",
    ...(creditsLane
      ? {
          ...gatewayVisitorFacingError(errorCode),
          ...(isCreditsLimitErrorCode(errorCode) && upgradeUrl
            ? { upgradeUrl }
            : {}),
        }
      : {
          error,
          ...(errorCode ? { errorCode } : {}),
          ...(upgradeUrl ? { upgradeUrl } : {}),
        }),
    ...(isContextOverflowMessage(error) || isContextOverflowCode(errorCode)
      ? { contextOverflow: true }
      : {}),
    ...(requestShape ? { requestShape } : {}),
    ...retry,
  };
}

async function recordAuthFailureForCurrentLane(opts: {
  recordLegacyCredentialFailure?: boolean;
  oauthScope?: "user" | "org";
  status?: number;
  code?: string;
  message?: string;
}): Promise<void> {
  if (opts.recordLegacyCredentialFailure !== false) {
    await recordBuilderGatewayAuthFailure({
      status: opts.status,
      code: opts.code,
      message: opts.message,
    });
    return;
  }
  const ownerEmail = getRequestUserEmail();
  if (ownerEmail) {
    if (opts.oauthScope === "org") {
      await markBuilderOAuthReconnectRequired(
        ownerEmail,
        "org",
        getRequestOrgId(),
      );
    } else if (opts.oauthScope === "user") {
      await markBuilderOAuthReconnectRequired(ownerEmail, "user");
    } else {
      await markBuilderOAuthReconnectRequired(ownerEmail);
    }
  }
}

async function* emitHttpError(
  response: Response,
  opts: {
    creditsLane: boolean;
    requestShape?: EngineRequestShape;
    recordLegacyCredentialFailure?: boolean;
    oauthScope?: "user" | "org";
  },
): AsyncIterable<EngineEvent> {
  const status = response.status;
  let errBody: GatewayErrorBody = {};
  const rawText = await response.text().catch(() => "");
  if (rawText) {
    try {
      errBody = JSON.parse(rawText) as GatewayErrorBody;
    } catch {
      errBody.message = normalizeGatewayErrorText(rawText, status);
    }
  }
  const message = errBody.message ?? `Builder gateway returned ${status}`;
  const code =
    canonicalizeBuilderGatewayErrorCode(errBody.code, message) ??
    `http_${status}`;
  const retryAfterMs = extractRetryAfterMs({
    responseHeaders: Object.fromEntries(response.headers.entries()),
  });
  const stop = (details: GatewayErrorStopDetails): EngineEvent =>
    gatewayErrorStop(
      retryAfterMs !== undefined && details.retryAfterMs === undefined
        ? { ...details, retryAfterMs }
        : details,
      opts.creditsLane,
      opts.requestShape,
    );

  const quotaErrorCode =
    status === 402 && !isCreditsLimitErrorCode(code) ? "http_402" : code;
  if (isCreditsLimitErrorCode(code) || status === 402) {
    yield stop({
      error: message,
      errorCode: quotaErrorCode,
      upgradeUrl: await buildUpgradeUrl(),
    });
    return;
  }
  if (code === "gateway_not_enabled") {
    yield stop({ error: message, errorCode: code });
    return;
  }
  if (status === 401 || code === "unauthorized") {
    await recordAuthFailureForCurrentLane({
      recordLegacyCredentialFailure: opts.recordLegacyCredentialFailure,
      oauthScope: opts.oauthScope,
      status,
      code,
      message,
    });
    yield stop({
      error:
        "Builder authentication failed. Reconnect Builder (free tier available) via Settings.",
      errorCode: "builder_auth_error",
    });
    return;
  }
  if (
    status === 403 &&
    ((opts.recordLegacyCredentialFailure === false &&
      code === "http_403" &&
      /^(?:forbidden|builder gateway returned 403)$/i.test(message.trim())) ||
      isBuilderCredentialAuthError(message))
  ) {
    await recordAuthFailureForCurrentLane({
      recordLegacyCredentialFailure: opts.recordLegacyCredentialFailure,
      oauthScope: opts.oauthScope,
      status,
      code,
      message,
    });
    yield stop({
      error:
        "Builder authentication failed. Reconnect Builder (free tier available) via Settings.",
      errorCode: "builder_auth_error",
    });
    return;
  }
  if (status === 403) {
    if (code === "http_403" && isBareProviderRejectionMessage(message)) {
      yield stop({
        error:
          "The AI provider temporarily refused this request (HTTP 403 with no reason). Retrying.",
        errorCode: PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
        statusCode: 403,
        providerRetryable: true,
      });
      return;
    }
    yield stop({ error: message, errorCode: code });
    return;
  }
  if (code === "rate_limit_exceeded") {
    yield stop({ error: message, errorCode: code });
    return;
  }
  if (status === 429 || code === "too_many_concurrent_requests") {
    yield stop({
      error: message,
      errorCode: code,
      statusCode: status,
      providerRetryable: true,
    });
    return;
  }
  yield stop({
    error: message,
    errorCode: code,
    statusCode: status,
    ...(isTransientGatewayFailure(message, status)
      ? { providerRetryable: true }
      : {}),
  });
}

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
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) yield tail;
}

async function* parseJsonlStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  model: string,
  captureContext: {
    toolNameMap?: ProviderToolNameMap;
    abortSignal?: AbortSignal;
    didGatewayTimeout?: () => boolean;
    getGatewayTimeoutMs?: () => number;
    onFirstEvent?: () => void;
    gatewayUrl?: URL;
    requestStartedAt?: number;
    creditsLane?: boolean;
    requestShape?: EngineRequestShape;
    recordLegacyCredentialFailure?: boolean;
    oauthScope?: "user" | "org";
  } = {},
): AsyncIterable<EngineEvent> {
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

  const toolInputs = createStreamedToolInputState();

  const recoverUndeliveredToolCalls = (): EngineEvent[] => {
    const events = finalizeStreamedToolInputs(toolInputs);
    for (const event of events) {
      if (event.type === "tool-call") {
        parts.push({
          type: "tool-call",
          id: event.id,
          name: event.name,
          input: event.input,
        });
      }
    }
    return events;
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
        yield gatewayErrorStop(
          {
            error: `Builder gateway returned invalid JSONL: ${normalized.slice(
              0,
              240,
            )}`,
            errorCode: "http_502",
            statusCode: 502,
            providerRetryable: true,
          },
          captureContext.creditsLane,
          captureContext.requestShape,
        );
        return;
      }

      if (event?.type !== "heartbeat") {
        captureContext.onFirstEvent?.();
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

        case "tool-call-delta": {
          const delta: EngineEvent = {
            type: "tool-input-delta",
            id: event.id,
            name:
              typeof event.name === "string"
                ? toEngineToolName(event.name, captureContext.toolNameMap)
                : event.name,
            text:
              typeof event.argsTextDelta === "string"
                ? event.argsTextDelta
                : typeof event.delta === "string"
                  ? event.delta
                  : "",
          };
          observeStreamedToolInput(toolInputs, delta);
          yield delta;
          break;
        }

        case "heartbeat":
          yield { type: "gateway-heartbeat" };
          break;

        case "tool-call": {
          flushPending();
          const call = {
            type: "tool-call" as const,
            id: event.id,
            name:
              typeof event.name === "string"
                ? toEngineToolName(event.name, captureContext.toolNameMap)
                : event.name,
            input: event.input,
          };
          parts.push(call);
          observeStreamedToolInput(toolInputs, call);
          yield { ...call };
          break;
        }

        case "usage": {
          const cacheWrite =
            (event.cacheCreatedTokens ?? 0) + (event.cacheCreated1hTokens ?? 0);
          if (
            event.creditsUsed !== undefined &&
            (!Number.isFinite(event.creditsUsed) || event.creditsUsed < 0)
          ) {
            yield gatewayErrorStop(
              {
                error: "Builder gateway returned invalid credit usage",
                errorCode: "builder_gateway_error",
              },
              captureContext.creditsLane,
              captureContext.requestShape,
            );
            return;
          }
          yield {
            type: "usage",
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
            ...(event.cacheInputTokens !== undefined
              ? { cacheReadTokens: event.cacheInputTokens }
              : {}),
            ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
            ...(event.creditsUsed !== undefined
              ? { builderCreditsUsed: event.creditsUsed }
              : {}),
          };
          break;
        }

        case "stop": {
          flushPending();
          yield* recoverUndeliveredToolCalls();
          yield { type: "assistant-content", parts };

          const reason = event.reason ?? "end_turn";
          const stop = (details: GatewayErrorStopDetails): EngineEvent =>
            gatewayErrorStop(
              details,
              captureContext.creditsLane,
              captureContext.requestShape,
            );
          if (reason === "rate_limited") {
            yield stop({
              error: `rate_limit exceeded: ${event.error ?? "upstream provider rate limited"}`,
              errorCode: "rate_limited",
              providerRetryable: true,
            });
          } else if (reason === "invalid_request") {
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
            yield stop({
              error: errMsg,
              errorCode: errCode,
              ...(isCreditsLimitErrorCode(errCode)
                ? { upgradeUrl: await buildUpgradeUrl() }
                : {}),
            });
          } else if (reason === "error") {
            const explicitErrMsg = event.error || event.message || event.detail;
            const errMsg =
              explicitErrMsg ??
              `Gateway error (no detail; raw event: ${JSON.stringify(event)})`;
            const gatewayRequestId =
              typeof event.requestId === "string" ? event.requestId : undefined;
            const gatewayErrCode = canonicalizeBuilderGatewayErrorCode(
              event.errorCode ?? event.code,
              String(errMsg),
            );
            const isCredentialAuthError =
              Boolean(explicitErrMsg) &&
              isBuilderCredentialAuthErrorInStream(String(errMsg));
            const isModelAuthError =
              Boolean(explicitErrMsg) &&
              !isCredentialAuthError &&
              isBuilderCredentialAuthError(String(errMsg));
            const isProviderConnectionError =
              typeof explicitErrMsg === "string" &&
              isProviderConnectionErrorMessage(String(explicitErrMsg));
            const isBareRejection =
              (gatewayErrCode === undefined || gatewayErrCode === "http_403") &&
              Boolean(explicitErrMsg) &&
              isBareProviderRejectionMessage(String(errMsg));
            const errCode = isCredentialAuthError
              ? "builder_auth_error"
              : isModelAuthError
                ? BUILDER_MODEL_UNAUTHORIZED_ERROR_CODE
                : isProviderConnectionError
                  ? BUILDER_GATEWAY_NETWORK_ERROR_CODE
                  : isBareRejection
                    ? PROVIDER_TRANSIENT_REJECTION_ERROR_CODE
                    : (gatewayErrCode ??
                      (!explicitErrMsg
                        ? "builder_gateway_error"
                        :
                          classifyTerminalErrorCode(String(errMsg))));
            console.error(
              `[builder-engine] stop reason=error model=${model} code=${errCode ?? "(none)"} requestId=${gatewayRequestId ?? "(none)"} error=${errMsg}`,
            );
            if (isCredentialAuthError) {
              await recordAuthFailureForCurrentLane({
                recordLegacyCredentialFailure:
                  captureContext.recordLegacyCredentialFailure,
                oauthScope: captureContext.oauthScope,
                code:
                  typeof gatewayErrCode === "string" ? gatewayErrCode : errCode,
                message: String(errMsg),
              });
            }
            if (!explicitErrMsg) {
              captureBuilderGatewayNoDetailError({
                requestId: gatewayRequestId,
                model,
                gatewayUrl: captureContext.gatewayUrl,
                rawEvent: event,
              });
            }
            yield stop({
              error: isBareRejection
                ? "The AI provider temporarily refused this request (HTTP 403 with no reason). Retrying."
                : String(errMsg),
              ...(errCode ? { errorCode: errCode } : {}),
              ...(isCreditsLimitErrorCode(errCode)
                ? { upgradeUrl: await buildUpgradeUrl() }
                : {}),
              ...(isBareRejection ? { statusCode: 403 } : {}),
              ...(isBareRejection || isTransientGatewayFailure(String(errMsg))
                ? { providerRetryable: true }
                : {}),
              ...(gatewayRequestId ? { requestId: gatewayRequestId } : {}),
            });
          } else if (
            reason === "end_turn" ||
            reason === "tool_use" ||
            reason === "max_tokens" ||
            reason === "stop_sequence"
          ) {
            yield { type: "stop", reason };
          } else {
            yield stop({ error: `Unknown stop reason: ${reason}` });
          }
          return;
        }

        default:
          break;
      }
    }

    flushPending();
    yield* recoverUndeliveredToolCalls();
    yield { type: "assistant-content", parts };
    yield gatewayErrorStop(
      {
        error: "Builder gateway stream ended without a stop event",
        errorCode: BUILDER_GATEWAY_STREAM_ENDED_ERROR_CODE,
      },
      captureContext.creditsLane,
      captureContext.requestShape,
    );
  } catch (err) {
    const timedOut = captureContext.didGatewayTimeout?.() ?? false;
    const gatewayTimeoutMs =
      captureContext.getGatewayTimeoutMs?.() ??
      DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS;
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
    yield createBuilderGatewayTimeoutStop(
      err,
      timedOut,
      gatewayTimeoutMs,
      captureContext.creditsLane,
      captureContext.requestShape,
    );
  } finally {
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
  config: Record<string, unknown> = {},
): AgentEngine {
  const configuredCredentials =
    config.credentials && typeof config.credentials === "object"
      ? (config.credentials as BuilderEngineCredentials)
      : undefined;
  return new BuilderEngine(configuredCredentials);
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
  totalTimeoutMs: number,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  effectiveTimeoutMs: () => number;
  markFirstEvent: () => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  let firstEventSeen = false;
  const startedAt = Date.now();

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal.reason);
    }
  };

  const fireTimeout = () => {
    timedOut = true;
    if (!controller.signal.aborted) {
      controller.abort(new Error("Builder gateway request timed out"));
    }
  };

  const firstEventDeadlineMs = Math.min(
    totalTimeoutMs,
    FIRST_STREAM_EVENT_TIMEOUT_MS,
  );
  let timeout = setTimeout(fireTimeout, firstEventDeadlineMs);

  if (parentSignal.aborted) abortFromParent();
  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    effectiveTimeoutMs: () =>
      firstEventSeen ? totalTimeoutMs : firstEventDeadlineMs,
    markFirstEvent: () => {
      if (firstEventSeen || timedOut) return;
      firstEventSeen = true;
      if (firstEventDeadlineMs >= totalTimeoutMs) return;
      clearTimeout(timeout);
      const remainingMs = Math.max(
        0,
        totalTimeoutMs - (Date.now() - startedAt),
      );
      timeout = setTimeout(fireTimeout, remainingMs);
    },
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

function isBuilderCredentialAuthErrorInStream(message: string): boolean {
  if (!isBuilderCredentialAuthError(message)) return false;
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("private key") ||
    lowerMessage.includes("access token") ||
    lowerMessage.includes("invalid token") ||
    lowerMessage.includes("invalid_token") ||
    lowerMessage.includes("token invalid")
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
  creditsLane: boolean | undefined,
  requestShape?: EngineRequestShape,
): EngineEvent {
  const error = normalizeBuilderGatewayFetchError(err, timedOut, timeoutMs);
  if (timedOut) {
    return gatewayErrorStop(
      { error, errorCode: "builder_gateway_timeout" },
      creditsLane,
      requestShape,
    );
  }
  if (isBuilderGatewayNetworkError(err)) {
    return gatewayErrorStop(
      {
        error,
        errorCode: BUILDER_GATEWAY_NETWORK_ERROR_CODE,
        providerRetryable: true,
      },
      creditsLane,
      requestShape,
    );
  }
  const errorCode = classifyTerminalErrorCode(error);
  return gatewayErrorStop(
    {
      error,
      ...(errorCode ? { errorCode } : {}),
      ...(isTransientGatewayFailure(error) ? { providerRetryable: true } : {}),
    },
    creditsLane,
    requestShape,
  );
}

function formatTimeoutMs(timeoutMs: number): string {
  if (timeoutMs < 1000) return `${timeoutMs}ms`;
  return `${Math.round(timeoutMs / 1000)}s`;
}

function errorMessage(err: unknown): string {
  return describeErrorWithCauses(err);
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
    text.includes("connection error") ||
    text.includes("connection reset") ||
    text.includes("connection closed") ||
    text.includes("stream closed") ||
    text.includes("terminated")
  );
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
