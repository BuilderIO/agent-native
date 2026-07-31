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
 * Last-resort error code for a terminal error that reached persistence with no
 * structured code. Persisting `"unknown"` is not a neutral default: the client
 * auto-recovers a fixed list of transport codes, so an unclassified transient
 * blip ends the user's chat while the identical failure carrying its real code
 * resumes. Over four days that gap was 28% of ALL production chat turns.
 *
 * Only transport/capacity failures map here — the ones where a fresh attempt on
 * a new connection is genuinely likely to succeed. Anything deterministic (a
 * bad key, an unsupported model parameter, a malformed request) must stay
 * unmapped: promoting those to "recoverable" buys a retry spiral, not a fix.
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
  return undefined;
}
