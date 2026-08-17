/**
 * Compose an error's message with its `cause` chain.
 *
 * Provider SDKs collapse the real failure into a generic wrapper message —
 * the Anthropic SDK reports every transport failure as exactly
 * "Connection error." and undici reports "fetch failed" — and keep the actual
 * reason (ECONNRESET, UND_ERR_SOCKET, TLS failure, request too large) only on
 * `.cause`. Recording `err.message` alone makes every one of them
 * indistinguishable after the fact, which is how a whole class of production
 * failures becomes undiagnosable.
 */
const DEFAULT_MAX_CAUSE_LINKS = 4;
const MAX_CAUSE_LINK_CHARS = 200;

export function describeErrorWithCauses(
  err: unknown,
  maxLinks: number = DEFAULT_MAX_CAUSE_LINKS,
): string {
  const head =
    err instanceof Error ? err.message : String(err ?? "Unknown error");
  const links: string[] = [];
  const seen = new Set<unknown>([err]);
  let cause: unknown = (err as { cause?: unknown } | null)?.cause;
  while (cause !== undefined && cause !== null && links.length < maxLinks) {
    if (seen.has(cause)) break;
    seen.add(cause);
    const code = (cause as { code?: unknown }).code;
    const message = cause instanceof Error ? cause.message : String(cause);
    const text = (typeof code === "string" ? `${code} ${message}` : message)
      .trim()
      .slice(0, MAX_CAUSE_LINK_CHARS);
    if (text) links.push(text);
    cause = (cause as { cause?: unknown }).cause;
  }
  return links.length > 0 ? `${head} (cause: ${links.join(" <- ")})` : head;
}

/**
 * The single provider-transport-failure classifier. Every layer that decides
 * "is this a network blip?" — engine error codes, run-level retry, Sentry
 * suppression — must call THIS, on `describeErrorWithCauses(err)` rather than
 * on a bare `err.message`.
 *
 * Four divergent copies of this predicate existed, and they disagreed on
 * exactly the string production actually throws. The AI SDK's `RetryError`
 * reports `"Failed after 2 attempts. Last error: Cannot connect to API: …"`,
 * so a copy anchored with `startsWith` scored it as unclassified while a copy
 * using `includes` scored it as retryable. The result was a split brain: the
 * agent loop retried the turn, but the run persisted `error_code = 'unknown'`,
 * which the client does not list as auto-recoverable — so a transient TLS
 * reset ended the user's chat with a dead error instead of resuming. That one
 * mismatch accounted for ~150 failed production runs in a week.
 *
 * Substring matching is deliberate: the real message is always a provider SDK
 * wrapper around the transport error, never bare, and the wrapper prefix
 * differs per SDK and per version.
 */
export function isProviderConnectionErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("connection error") ||
    normalized.includes("cannot connect to api")
  );
}

/** `isProviderConnectionErrorMessage` over an error's full cause chain. */
export function isProviderConnectionError(err: unknown): boolean {
  return isProviderConnectionErrorMessage(describeErrorWithCauses(err));
}

/**
 * The single context-window-overflow classifier, shared by the layer that reads
 * a provider's raw reply and the layer that decides to trim and retry.
 *
 * It lives here, beside the transport classifier, because the Builder gateway
 * reports an overflow as an ordinary 400 `invalid_request_error` whose prose is
 * the only carrier — and on a Builder-credits deployment that prose is replaced
 * by one visitor line before any agent-level predicate sees it. The engine
 * therefore runs this against the RAW reply and hands the verdict on as a
 * structural field; `isContextTooLongError` (production-agent) keeps calling it
 * for every other engine, which still delivers its own message intact.
 */
export function isContextOverflowMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("context_length_exceeded") ||
    msg.includes("input_too_long") ||
    msg.includes("too many tokens") ||
    msg.includes("prompt is too long") ||
    msg.includes("reduce the length") ||
    // Gemini phrasing
    msg.includes("input token count exceeds") ||
    msg.includes("request too large")
  );
}

/** The overflow codes a provider or gateway may report instead of prose. */
export function isContextOverflowCode(code: string | undefined): boolean {
  const normalized = (code ?? "").toLowerCase();
  return (
    normalized.includes("context_length") ||
    normalized.includes("input_too_long")
  );
}

/** Classification fields an AI SDK provider failure carries. */
export interface ProviderErrorClassification {
  errorCode?: string;
  statusCode?: number;
  providerRetryable?: boolean;
}

/**
 * Classify a provider error from the AI SDK, whichever way it surfaced.
 *
 * `streamText` does not throw for a failed provider request — it emits an
 * `error` part on `fullStream` — so there are two arrival paths, and only the
 * thrown one used to be classified. The stream-part path discarded
 * `statusCode`, `errorCode`, and `isRetryable` entirely, which is why every
 * provider HTTP failure on an ai-sdk engine landed as `unknown`: a 429 was only
 * retried if its prose happened to contain "rate_limit", and a
 * 100%-reproducible config 400 was indistinguishable from any other unclassified
 * failure, so it had no signature to alert on. Both call sites go through here.
 *
 * `timedOut` is the caller's own first-event deadline, which only the streaming
 * path can know.
 */
export function classifyProviderError(
  err: unknown,
  timedOut = false,
): ProviderErrorClassification {
  // The AI SDK wraps exhausted retries in RetryError and keeps the final
  // APICallError on `lastError`.
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

  // Classify on the cause chain of the ORIGINAL error, not the unwrapped one:
  // when RetryError does not expose `lastError` as an Error the unwrap falls
  // back to the wrapper, whose message ("Failed after 2 attempts. Last error:
  // …") only *embeds* the transport failure. Matching the wrapper is the point.
  const described = describeErrorWithCauses(err);
  const isConnectionError =
    !timedOut &&
    statusCode === undefined &&
    (isProviderConnectionErrorMessage(described) ||
      isProviderConnectionErrorMessage(
        typeof providerError?.message === "string"
          ? providerError.message
          : String(providerError),
      ));

  const providerRetryable =
    typeof providerError?.isRetryable === "boolean"
      ? providerError.isRetryable
      : isConnectionError || timedOut
        ? true
        : undefined;

  return {
    // Tag every known status as `http_<status>` (not just 401) so a rate limit
    // surfaces as `http_429`: the structured statusCode drives turn-level
    // retries, but run-level continuation keys off the errorCode.
    ...(statusCode !== undefined
      ? { errorCode: `http_${statusCode}`, statusCode }
      : isConnectionError || timedOut
        ? { errorCode: "provider_network_error" }
        : // Nothing structured — fall back to reading the message, so a
          // stream-part 529/timeout is not silently unclassified.
          (() => {
            const code = classifyTerminalErrorCode(described);
            return code ? { errorCode: code } : {};
          })()),
    ...(providerRetryable !== undefined ? { providerRetryable } : {}),
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
  // Word-bounded: request ids and hashes routinely contain a bare "529".
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
  // Deterministic below this line — named so they stop landing in `unknown`,
  // never retried. Both were measured against the 13 prod app DBs over
  // 2026-07-24..31: 27 turns/week and 14 turns/week respectively, each with
  // exactly 1.00 runs/turn, i.e. the chat died on the first attempt showing
  // the raw provider sentence.
  //
  // The request side already avoids emitting reasoning_effort alongside tools
  // (see ai-sdk-engine.ts). This classifies the failure for the paths that
  // still reach the provider — another gateway, a stale deploy — so it reads
  // as a configuration problem rather than a mystery.
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
  return undefined;
}
