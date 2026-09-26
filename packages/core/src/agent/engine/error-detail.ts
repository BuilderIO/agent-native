import { parseRetryAfterMs } from "../../shared/retry-after.js";

const DEFAULT_MAX_CAUSE_LINKS = 4;
const MAX_CAUSE_LINK_CHARS = 200;

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export function describeErrorWithCauses(
  err: unknown,
  maxLinks: number = DEFAULT_MAX_CAUSE_LINKS,
): string {
  const head =
    err instanceof Error
      ? err.message
      : stringifyUnknown(err) || "Unknown error";
  const links: string[] = [];
  const seen = new Set<unknown>([err]);
  let cause: unknown = (err as { cause?: unknown } | null)?.cause;
  while (cause !== undefined && cause !== null && links.length < maxLinks) {
    if (seen.has(cause)) break;
    seen.add(cause);
    const code = (cause as { code?: unknown }).code;
    const message =
      cause instanceof Error ? cause.message : stringifyUnknown(cause);
    const text = (typeof code === "string" ? `${code} ${message}` : message)
      .trim()
      .slice(0, MAX_CAUSE_LINK_CHARS);
    if (text) links.push(text);
    cause = (cause as { cause?: unknown }).cause;
  }
  return links.length > 0 ? `${head} (cause: ${links.join(" <- ")})` : head;
}

export function isProviderConnectionErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("connection error") ||
    normalized.includes("cannot connect to api")
  );
}

export function isProviderConnectionError(err: unknown): boolean {
  return isProviderConnectionErrorMessage(describeErrorWithCauses(err));
}

export function isContextOverflowMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("context_length_exceeded") ||
    msg.includes("input_too_long") ||
    msg.includes("too many tokens") ||
    msg.includes("prompt is too long") ||
    msg.includes("reduce the length") ||
    msg.includes("input token count exceeds") ||
    msg.includes("request too large")
  );
}

export const BUILDER_GATEWAY_INTERNAL_ERROR_CODE =
  "builder_gateway_internal_error";

export const PROVIDER_TRANSIENT_REJECTION_ERROR_CODE =
  "provider_transient_rejection";

export const PROVIDER_RATE_LIMITED_ERROR_CODE = "provider_rate_limited";

export function isCreditsLimitErrorCode(errorCode?: string): boolean {
  const code = errorCode?.trim().toLowerCase();
  return code === "http_402" || code?.startsWith("credits-limit") === true;
}

export function isBareProviderRejectionMessage(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed === "" ||
    /^forbidden$/i.test(trimmed) ||
    /^403 status code(?: \(no body\))?$/i.test(trimmed) ||
    /^builder gateway returned 403$/i.test(trimmed)
  );
}

const BUILDER_GATEWAY_ERROR_ID_PATTERN = /\berror id:\s*([0-9a-f]+)\b/i;
const BUILDER_GATEWAY_ERROR_ID_MIN_CHARS = 8;
const BUILDER_GATEWAY_ERROR_PREFIX_PATTERN =
  /^sorry,\s+(?:we ran into an issue processing your request|this was caused by an internal error)\b/i;

export function isBuilderGatewayInternalErrorMessage(message: string): boolean {
  const match = BUILDER_GATEWAY_ERROR_ID_PATTERN.exec(message);
  return (
    BUILDER_GATEWAY_ERROR_PREFIX_PATTERN.test(message) &&
    match !== null &&
    match[1].length >= BUILDER_GATEWAY_ERROR_ID_MIN_CHARS
  );
}

export function canonicalizeBuilderGatewayErrorCode(
  code: string | undefined,
  message: string,
): string | undefined {
  return (code === undefined || code === "provider_internal_error") &&
    isBuilderGatewayInternalErrorMessage(message)
    ? BUILDER_GATEWAY_INTERNAL_ERROR_CODE
    : code;
}

export function isContextOverflowCode(code: string | undefined): boolean {
  const normalized = (code ?? "").toLowerCase();
  return (
    normalized.includes("context_length") ||
    normalized.includes("input_too_long")
  );
}

export interface ProviderErrorClassification {
  errorCode?: string;
  statusCode?: number;
  providerRetryable?: boolean;
  retryAfterMs?: number;
}

const MAX_RETRY_AFTER_MS = 60_000;

export function extractRetryAfterMs(err: unknown): number | undefined {
  const wrapped = err as { lastError?: unknown; cause?: unknown } | null;
  for (const source of [err, wrapped?.lastError, wrapped?.cause]) {
    const headers = (source as { responseHeaders?: unknown } | null)
      ?.responseHeaders;
    if (!headers || typeof headers !== "object") continue;
    const ms = parseRetryAfterMs(headers as Record<string, string>);
    if (ms !== null) {
      if (ms > MAX_RETRY_AFTER_MS) {
        console.warn(
          `[classifyProviderError] Retry-After ${ms}ms exceeds cap; using ${MAX_RETRY_AFTER_MS}ms`,
        );
      }
      return Math.min(ms, MAX_RETRY_AFTER_MS);
    }
  }
  return undefined;
}

export function classifyProviderError(
  err: unknown,
  timedOut = false,
): ProviderErrorClassification {
  const wrapped = err as { lastError?: unknown } | null;
  const providerError = (
    wrapped?.lastError instanceof Error ? wrapped.lastError : err
  ) as {
    statusCode?: unknown;
    isRetryable?: unknown;
    message?: unknown;
  } | null;

  const statusCode =
    typeof providerError?.statusCode === "number"
      ? providerError.statusCode
      : undefined;

  const described = describeErrorWithCauses(err);
  const isConnectionError =
    !timedOut &&
    statusCode === undefined &&
    (isProviderConnectionErrorMessage(described) ||
      isProviderConnectionErrorMessage(
        typeof providerError?.message === "string"
          ? providerError.message
          : stringifyUnknown(providerError),
      ));

  const isBareRejection =
    statusCode === 403 &&
    providerError?.isRetryable !== false &&
    (isBareProviderRejectionMessage(described) ||
      isBareProviderRejectionMessage(
        typeof providerError?.message === "string"
          ? providerError.message
          : stringifyUnknown(providerError),
      ));

  const providerRetryable =
    typeof providerError?.isRetryable === "boolean"
      ? providerError.isRetryable
      : isConnectionError || isBareRejection || timedOut
        ? true
        : undefined;

  const retryAfterMs = extractRetryAfterMs(err);

  return {
    // Tag every known status as `http_<status>` (not just 401) so a rate limit
    // surfaces as `http_429`: the structured statusCode drives turn-level
    // retries, but run-level continuation keys off the errorCode. A bare 403
    // is the one status that gets a different code instead of `http_403`,
    // because that code is the client's credential-rejected signal.
    ...(statusCode !== undefined
      ? isBareRejection
        ? {
            errorCode: PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
            statusCode,
          }
        : { errorCode: `http_${statusCode}`, statusCode }
      : isConnectionError || timedOut
        ? { errorCode: "provider_network_error" }
        : (() => {
            const code = classifyTerminalErrorCode(described);
            return code ? { errorCode: code } : {};
          })()),
    ...(providerRetryable !== undefined ? { providerRetryable } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

/**
 * Last-resort error code for a terminal error that reached persistence with no
 * structured code. Persisting `"unknown"` is not a neutral default: the client
 * auto-recovers a fixed list of transport codes, so an unclassified transient
 * blip ends the user's chat while the identical failure carrying its real code
 * resumes. Over four days that gap was 28% of ALL production chat turns.
 *
 * The invariant is NOT "only transport failures may be named". It is: a code
 * returned here must be absent from the client's recoverable list unless a
 * fresh attempt genuinely helps. Naming a deterministic failure is what stops
 * it from reaching the user as raw provider text and hiding inside `unknown`;
 * naming it *recoverable* is what buys a retry spiral. Those are different
 * decisions, and `error-detail.spec.ts` asserts the deterministic codes below
 * stay non-recoverable.
 */
export function classifyTerminalErrorCode(
  message: string | undefined,
): string | undefined {
  if (!message) return undefined;
  const msg = message.toLowerCase();
  if (isProviderConnectionErrorMessage(msg)) return "provider_network_error";
  if (msg.includes("overloaded") || /\b529\b/.test(msg)) {
    return "overloaded_error";
  }
  if (msg.includes("too many requests") || /\b429\b/.test(msg)) {
    return "http_429";
  }
  if (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("too much time has passed without sending any data")
  ) {
    return "timeout";
  }
  if (msg.includes("stream ended without a stop event")) {
    return "builder_gateway_network_error";
  }
  if (
    msg.includes("reasoning_effort are not supported") ||
    msg.includes("reasoning_effort to 'none'") ||
    (msg.includes("reasoning_effort") &&
      (msg.includes("tools") || msg.includes("function")))
  ) {
    return "provider_config_error";
  }
  if (msg.includes("missing authentication header") || msg === "unauthorized") {
    return "authentication_error";
  }
  if (
    /(?:err_)?ssl|tlsv?\d|tls handshake|ssl routines|econnreset|econnrefused|und_err_socket|socket hang up/i.test(
      message,
    )
  ) {
    return "provider_network_error";
  }
  if (isBuilderGatewayInternalErrorMessage(message)) {
    return BUILDER_GATEWAY_INTERNAL_ERROR_CODE;
  }
  return undefined;
}
