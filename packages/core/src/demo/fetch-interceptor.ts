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
import { agentNativePath } from "../client/api-path.js";

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
];

let installed = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let demoEnabled = false;
let originalFetch: typeof fetch | null = null;

// Resolves once the first demo-status check completes (success OR failure).
// The redaction DECISION awaits this so the very first data response — which
// may come back before the status poll — is still classified correctly and
// never cached un-redacted. The network request itself is never delayed: the
// data fetch and the tiny status fetch race in parallel.
let firstStatusDone = false;
let resolveStatusReady: () => void;
const statusReady = new Promise<void>((r) => {
  resolveStatusReady = r;
});

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
    const res = await f(STATUS_PATH, { credentials: "include" });
    if (!res.ok) return;
    const json = (await res.json()) as {
      enabled?: boolean;
      forced?: boolean;
    } | null;
    demoEnabled = json?.enabled === true || json?.forced === true;
  } catch {
    // Status endpoint unreachable — leave the last known value.
  } finally {
    if (!firstStatusDone) {
      firstStatusDone = true;
      resolveStatusReady();
    }
  }
}

/**
 * Install the demo-mode fetch interceptor and start polling demo status.
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
    try {
      if (methodOf(input, init) !== "GET") return res;
      if (!res.ok) return res;

      // Wait for the first status check so an early response isn't
      // misclassified (the request already happened in parallel above).
      if (!firstStatusDone) await statusReady;
      if (!demoEnabled) return res;

      const url = urlOf(input);
      if (SKIP_SUBSTRINGS.some((s) => url.includes(s))) return res;

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) return res;
      if (!contentType.includes("application/json")) return res;
      if (res.bodyUsed) return res;

      const data = await res.clone().json();
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
      // Never let redaction break a request — fall back to the real response.
      return res;
    }
  };

  void refreshDemoFlag();
  pollTimer = setInterval(() => void refreshDemoFlag(), 4_000);
  if (typeof pollTimer === "object" && "unref" in pollTimer) {
    try {
      (pollTimer as unknown as { unref: () => void }).unref();
    } catch {
      // unref unavailable in the browser — fine, interval is cheap.
    }
  }
}
