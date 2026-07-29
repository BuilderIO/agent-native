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
 *
 * Classification (`isConnectionError`, `isRetryableError`) must keep matching
 * on the bare `err.message` — this is for the RECORDED detail only.
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
