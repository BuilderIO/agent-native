import { agentNativePath } from "../client/api-path.js";
/**
 * Client-side demo-mode redaction.
 *
 * Why client-side and not (only) at the server action boundary: templates
 * serve a lot of their UI data through their OWN custom Nitro `/api/*`
 * handlers (e.g. mail's `/api/emails`, `/api/threads/:id/messages`,
 * `/api/contacts`, `/api/apollo/person`), which never pass through the
 * framework action runtime. On this stack (Nitro v3 / h3 v2) there is no
 * single server hook that can safely rewrite every JSON body (the `response`
 * hook hands you an immutable Web `Response` and returns `void`). Patching the
 * browser's `fetch` is the one place that is BOTH universal (every template's
 * reads — actions and custom routes alike — go through it) AND low-risk: it
 * can only ever post-process JSON the app already parses for display, so it
 * physically cannot break auth, SSE streams, SSR HTML, or binary downloads.
 *
 * The agent is handled separately and in-process (its action tool results are
 * redacted in `production-agent.ts`), so it doesn't depend on this at all.
 *
 * Scope intentionally narrow:
 *   - Only same-document `GET` requests are redacted. Mutation responses
 *     (POST/PUT/PATCH/DELETE) pass through untouched so a draft you just
 *     typed isn't echoed back as fake data mid-demo.
 *   - Only `application/json` 2xx bodies. Streams (`text/event-stream`),
 *     HTML, and binary are skipped by content-type.
 *   - Framework infra endpoints (poll, events, the demo-status endpoint
 *     itself) are skipped — no PII and avoids self-recursion.
 *   - Any error during interception falls back to the original response.
 */
import { redactDemoData } from "./redact.js";

const STATUS_PATH = agentNativePath("/_agent-native/demo/status");
const SKIP_SUBSTRINGS = [
  "/_agent-native/demo/status",
  "/_agent-native/poll",
  "/_agent-native/events",
  // Never touch agent transport. The agent already gets in-process
  // redaction of its tool results; faking its own transcript adds no demo
  // value and must stay clear of the tool_use/tool_result protocol. Covers
  // "/_agent-native/agent" (stream) and "/_agent-native/agent-chat"
  // (thread history) and any sub-paths.
  "/_agent-native/agent",
  // Run-manager state read by the reconnect/recovery loop. Faking numeric
  // run state here would make recovery think it's not progressing and
  // exhaust its retries ("agent connection kept failing").
  "/_agent-native/runs",
];

let installed = false;
let demoEnabled = false;
let originalFetch: typeof fetch | null = null;
let refreshPromise: Promise<void> | null = null;

// Set once the first demo-status check completes. We DO NOT block requests on
// it — if status isn't known yet a response is simply passed through
// un-redacted (a brief first-paint window) rather than delaying transport.
// Injecting latency into early GETs previously risked the agent's streaming
// reconnect logic; transport safety wins over redacting the first paint.
let firstStatusDone = false;

/** Reject after `ms` so a misclassified streaming body can never hang. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("redact-timeout")), ms),
    ),
  ]);
}

function urlOf(input: RequestInfo | URL): string {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return (input as Request).url ?? "";
  } catch {
    return "";
  }
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const m =
    init?.method ??
    (typeof input !== "string" && !(input instanceof URL)
      ? (input as Request).method
      : undefined) ??
    "GET";
  return m.toUpperCase();
}

async function refreshDemoFlag(): Promise<void> {
  const f = originalFetch ?? fetch;
  try {
    const res = await f(STATUS_PATH, { credentials: "same-origin" });
    if (!res.ok) return;
    const json = (await res.json()) as {
      enabled?: boolean;
      forced?: boolean;
    } | null;
    demoEnabled = json?.enabled === true || json?.forced === true;
  } catch {
    // Status endpoint unreachable — leave the last known value.
  } finally {
    firstStatusDone = true;
  }
}

/** Refresh demo mode after the shared DB-sync stream reports a real change. */
export function refreshDemoModeFetchInterceptor(): Promise<void> {
  if (!installed) return Promise.resolve();
  if (!refreshPromise) {
    refreshPromise = refreshDemoFlag().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Install the demo-mode fetch interceptor and read demo status once. Later
 * changes are driven by the shared DB-sync transport instead of a separate
 * fixed polling loop.
 * Idempotent and browser-only — safe to call from any hook that runs in
 * every template root (we call it from `useDbSync`). A no-op until demo
 * mode is actually on.
 */
export function ensureDemoModeFetchInterceptor(): void {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;

  originalFetch = window.fetch.bind(window);
  const base = originalFetch;

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const res = await base(input, init);

    // Fast path: anything that isn't a demo-enabled, plain GET returns the
    // ORIGINAL response with zero body work and zero extra awaits — when
    // demo mode is off this wrapper is byte-for-byte native fetch, so it
    // cannot influence agent/run/stream transport.
    if (!demoEnabled || !firstStatusDone) return res;
    if (methodOf(input, init) !== "GET") return res;
    if (!res.ok) return res;

    try {
      const url = urlOf(input);
      if (SKIP_SUBSTRINGS.some((s) => url.includes(s))) return res;

      // Only buffered, finite JSON. SSE / streaming / chunked-forever bodies
      // never reach `redactDemoData`: streaming content-types are excluded,
      // and the JSON read is hard-timeout-bounded so a misclassified stream
      // degrades to "return the original response" instead of hanging the
      // request (which is what tripped the reconnect/recovery loop).
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return res;
      if (
        contentType.includes("event-stream") ||
        contentType.includes("ndjson") ||
        contentType.includes("stream")
      ) {
        return res;
      }
      if (res.bodyUsed) return res;

      const data = await withTimeout(res.clone().json(), 3_000);
      const redacted = redactDemoData(data);

      const headers = new Headers(res.headers);
      // Body is re-serialized — these would be wrong now.
      headers.delete("content-length");
      headers.delete("content-encoding");

      return new Response(JSON.stringify(redacted), {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    } catch {
      // Never let redaction break a request — fall back to the real
      // response (its body stream is untouched; we only ever read a clone).
      return res;
    }
  };

  void refreshDemoModeFetchInterceptor();
}
