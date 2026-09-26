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
 * The agent transport is intentionally skipped because it carries the real
 * backend results; this interceptor is only a browser presentation transform.
 *
 * Scope intentionally narrow:
 *   - Only same-document `GET` requests are redacted. Mutation responses
 *     (POST/PUT/PATCH/DELETE) pass through untouched so a draft you just
 *     typed isn't echoed back as fake data mid-demo.
 *   - Only `application/json` 2xx bodies. Streams (`text/event-stream`),
 *     HTML, and binary are skipped by content-type.
 *   - Framework infra endpoints (poll and events) are skipped.
 *   - Any error during interception falls back to the original response.
 */
import { getBrowserDemoModeEnabled } from "./browser-state.js";
import { redactDemoData } from "./redact.js";

const SKIP_SUBSTRINGS = [
  "/_agent-native/poll",
  "/_agent-native/events",
  "/_agent-native/agent",
  "/_agent-native/runs",
];

// are still anonymized. NEVER remove the raw payload skips or broaden them to
const RAW_REPLAY_PAYLOAD_RE =
  /\/api\/session-replay\/recordings\/[^/?#]+\/(?:chunks(?:\/[^/?#]+)?|events)(?:[/?#]|$)/;
const RAW_AGENT_REPLAY_EVENTS_RE =
  /\/api\/session-replay\/agent-events\.json(?:[?#]|$)/;

export function shouldSkipDemoResponseRedaction(url: string): boolean {
  return (
    SKIP_SUBSTRINGS.some((substring) => url.includes(substring)) ||
    RAW_REPLAY_PAYLOAD_RE.test(url) ||
    RAW_AGENT_REPLAY_EVENTS_RE.test(url)
  );
}

let installed = false;

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

export function ensureDemoModeFetchInterceptor(): void {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;

  const base = window.fetch.bind(window);

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const res = await base(input, init);

    if (!getBrowserDemoModeEnabled()) return res;
    if (methodOf(input, init) !== "GET") return res;
    if (!res.ok) return res;

    try {
      const url = urlOf(input);
      if (shouldSkipDemoResponseRedaction(url)) return res;

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
      const redacted = redactDemoData(data, {
        redactNumbers: false,
        redactProtectedEmails: true,
      });

      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");

      return new Response(JSON.stringify(redacted), {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    } catch {
      return res;
    }
  };
}
