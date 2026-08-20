/**
 * HTTP helpers for the beta fleet sweep.
 *
 * Serverless beta hosts cold-start: the first request to an idle site has been
 * measured at 40s+ before the same host answers in under a second. Retries here
 * absorb that. What they must never do is absorb a *result* — a host that is
 * unreachable resolves to a distinct `unreachable` outcome, never to a
 * plausible-looking empty body or a 0 status, so a caller cannot mistake
 * "we never got an answer" for "the answer was no".
 */

export interface HttpOutcome {
  ok: boolean;
  status: number;
  body: string;
  headers: Record<string, string>;
  url: string;
  attempts: number;
  elapsedMs: number;
}

export type ProbeResult =
  | ({ kind: "responded" } & HttpOutcome)
  | {
      kind: "unreachable";
      url: string;
      attempts: number;
      elapsedMs: number;
      lastError: string;
    };

export interface ProbeOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Total attempts, including the first. Cold starts need at least 3. */
  attempts?: number;
  timeoutMs?: number;
  redirect?: RequestRedirect;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Issue a request, retrying only transport failures. A response — any response,
 * including 5xx — is an answer and is returned on the first attempt.
 */
export async function probe(
  url: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let lastError = "no attempt was made";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        redirect: options.redirect ?? "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        kind: "responded",
        ok: response.ok,
        status: response.status,
        body,
        headers,
        url,
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep(2_000 * attempt);
    }
  }

  return {
    kind: "unreachable",
    url,
    attempts,
    elapsedMs: Date.now() - startedAt,
    lastError,
  };
}

/**
 * `probe` for callers that treat unreachability as a failure of the host rather
 * than a condition to branch on. Throws with the transport error attached so a
 * report never shows a bare "expected 200, got undefined".
 */
export async function mustRespond(
  url: string,
  options: ProbeOptions = {},
): Promise<HttpOutcome> {
  const result = await probe(url, options);
  if (result.kind === "unreachable") {
    throw new Error(
      `${options.method ?? "GET"} ${url} never responded after ${result.attempts} attempt(s) in ${result.elapsedMs}ms. Last transport error: ${result.lastError}`,
    );
  }
  const { kind: _kind, ...outcome } = result;
  return outcome;
}

/**
 * Parse a JSON body, failing with the actual payload rather than `null`. A
 * beta host answering an HTML error page to a JSON endpoint is a real finding;
 * coercing it to an empty object would hide it.
 */
export function parseJson<T = unknown>(outcome: HttpOutcome, label: string): T {
  try {
    return JSON.parse(outcome.body) as T;
  } catch {
    throw new Error(
      `${label}: ${outcome.url} returned HTTP ${outcome.status} with a body that is not JSON (first 300 chars): ${outcome.body.slice(0, 300)}`,
    );
  }
}

/** Warm a host so a cold start does not surface as a test failure elsewhere. */
export async function warm(origin: string): Promise<void> {
  await probe(`${origin}/_agent-native/health`, {
    attempts: 4,
    timeoutMs: 60_000,
  });
}
