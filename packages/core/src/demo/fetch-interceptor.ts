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
  // Never touch agent transport. The agent receives real tool results; faking
  // its own transcript adds no demo value and must stay clear of the
  // tool_use/tool_result protocol. Covers
  // "/_agent-native/agent" (stream) and "/_agent-native/agent-chat"
  // (thread history) and any sub-paths.
  "/_agent-native/agent",
  // Run-manager state read by the reconnect/recovery loop. Faking numeric
  // run state here would make recovery think it's not progressing and
  // exhaust its retries ("agent connection kept failing").
  "/_agent-native/runs",
];

// Raw rrweb payloads are playback data, not ordinary app UI records. Skipping
// these is not just a perf optimization that avoids walking/cloning huge
// DOM/event trees on the main thread: demo number
// redaction previously ran over this exact raw replay JSON and faked any
// integer >= 1000 it found — Meta/ViewportResize widths, pointer x/y
// coordinates, and numeric values inside `_cssText` and SVG attributes. That
// was the root cause of the 2026-07 "ultra-wide replay" bugs (stages
// rendered thousands of pixels wide, frozen/teleporting cursors, giant
// icons) even though every stored recording was always geometrically sane —
// the corruption happened at *view* time, not at capture/storage time. Small
// list/summary/manifest responses stay eligible so rendered visitor identities
// are still anonymized. NEVER remove the raw payload skips or broaden them to
// metadata endpoints that the UI renders directly.
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

/**
 * Install the browser-local demo-mode fetch interceptor.
 * Idempotent and browser-only — safe to call from any hook that runs in
 * every template root (we call it from `useDbSync`).
 */
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

    // Fast path: anything that isn't a browser-local-demo, plain GET returns the
    // ORIGINAL response with zero body work and zero extra awaits — when
    // demo mode is off this wrapper is byte-for-byte native fetch, so it
    // cannot influence agent/run/stream transport.
    if (!getBrowserDemoModeEnabled()) return res;
    if (methodOf(input, init) !== "GET") return res;
    if (!res.ok) return res;

    try {
      const url = urlOf(input);
      if (shouldSkipDemoResponseRedaction(url)) return res;

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
      // Frontend reads only need identity privacy. Dashboard charts apply
      // their purpose-built demo trend transform at render time, so mutating
      // every numeric field in every JSON response is unnecessary work.
      const redacted = redactDemoData(data, {
        redactNumbers: false,
        redactProtectedEmails: true,
      });

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
}
