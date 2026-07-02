import { isLocalDatabase } from "../db/client.js";
import { signInternalToken } from "../integrations/internal-token.js";
/**
 * Shared self-dispatch helper for the framework's serverless background-work
 * pattern: enqueue a unit of work to SQL, then fire a fresh HTTP POST back to
 * this same deployment so the work runs in its own function invocation (with
 * its own full timeout budget) instead of riding on the request that created
 * it.
 *
 * This is the single mechanism that makes background work portable across every
 * host Nitro deploys to:
 *   - Netlify Lambda / Vercel Functions / AWS Lambda — the dispatched request
 *     hits a fresh function with its own budget; no `waitUntil` needed.
 *   - Cloudflare Workers — same (and `waitUntil` still works as a belt-and-
 *     suspenders fallback where the in-process path is used).
 *   - Self-hosted / long-lived Node — the dispatch comes back as another
 *     request to the same process; each handler still runs to completion.
 *
 * Originally inlined in both `a2a/handlers.ts` (`resolveSelfBaseUrl` +
 * `fireProcessTaskDispatch`) and `integrations/webhook-handler.ts`
 * (`resolveBaseUrl` + the dispatch in `enqueueAndDispatch`). Extracted here so
 * A2A, integration webhooks, and Agent Teams sub-agents share one tested
 * implementation.
 */
import {
  getConfiguredAppBasePath,
  withConfiguredAppBasePath,
} from "./app-base-path.js";

/**
 * On serverless, returning from the dispatching handler before the outbound
 * TCP handshake starts can freeze the function with the dispatch request stuck
 * in the queue. Racing the fetch against a short timer gives the request a
 * chance to leave the box at the cost of a little added latency on the
 * dispatching call. Mirrors the 250ms used by the A2A/webhook paths.
 */
export const DEFAULT_DISPATCH_SETTLE_MS = 250;

function readHeader(event: any, name: string): string | undefined {
  try {
    const headers = event?.node?.req?.headers ?? event?.headers;
    if (!headers) return undefined;
    if (typeof headers.get === "function") {
      return headers.get(name) ?? undefined;
    }
    const map = headers as Record<string, string | undefined>;
    return map[name] ?? map[String(name).toLowerCase()];
  } catch {
    return undefined;
  }
}

/**
 * Resolve the base URL to fire a self-dispatch request at. Prefers explicit env
 * vars (most reliable on serverless, where inbound host headers can be the
 * platform's internal hostname), falling back to the inbound request headers
 * and finally localhost in dev.
 *
 * Throws in production / shared deployments when no env var is set — a silent
 * fallback to a bad host there would drop background work invisibly.
 */
export function resolveSelfDispatchBaseUrl(event?: any): string {
  const fromEnv =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  if (fromEnv) return withConfiguredAppBasePath(String(fromEnv));

  if (process.env.NODE_ENV === "production" || !isLocalDatabase()) {
    throw new Error(
      "Self-dispatch requires APP_URL, URL, DEPLOY_URL, or BETTER_AUTH_URL in " +
        "production/shared deployments so background work can reach this " +
        "deployment's own URL.",
    );
  }

  const proto = readHeader(event, "x-forwarded-proto") || "http";
  const host =
    readHeader(event, "host") || `localhost:${process.env.PORT || 3000}`;
  return withConfiguredAppBasePath(`${proto}://${host}`);
}

export interface FireInternalDispatchOptions {
  /** Base URL of this deployment. Defaults to `resolveSelfDispatchBaseUrl(event)`. */
  baseUrl?: string;
  /** Request event used to derive the base URL when `baseUrl` is omitted. */
  event?: any;
  /** Framework route path to POST to (e.g. "/_agent-native/agent-teams/_process-run"). */
  path: string;
  /** Task/run id the processor will claim. Used to sign the HMAC token and as the default body. */
  taskId: string;
  /** Extra fields merged into the JSON body alongside `{ taskId }`. */
  body?: Record<string, unknown>;
  /** Max ms to wait for the outbound request to leave the box. Default 250ms. */
  settleMs?: number;
}

async function dispatchResponseError(
  path: string,
  res: Response,
): Promise<Error> {
  let body = "";
  try {
    body = (await res.text()).trim();
  } catch {
    body = "";
  }
  const detail = body ? `: ${body.slice(0, 300)}` : "";
  return new Error(
    `Self-dispatch to ${path} returned HTTP ${res.status} ${res.statusText}${detail}`,
  );
}

/**
 * Fire a fresh, HMAC-signed POST to a processor route on this same deployment.
 * Fire-and-forget: the dispatch is NOT awaited to completion (the processed run
 * may take minutes); it is only raced against a short settle timer so the
 * request reliably leaves a serverless box before it freezes.
 *
 * When `A2A_SECRET` is unset (local dev), the request is sent unsigned — the
 * processor accepts unsigned dispatches in dev and relies on the SQL atomic
 * claim for double-processing protection, mirroring the A2A/webhook flow.
 */
/**
 * For host-root dispatch targets (`/.netlify/functions/*`), strip the configured
 * app base path suffix from the resolved base url so the request reaches the
 * function at the host root rather than under the workspace app base path. For
 * every other (framework-route) path the base-path-prefixed base url is returned
 * unchanged, preserving the existing self-dispatch behavior.
 */
function rootBaseUrlForPath(baseUrl: string, path: string): string {
  if (!path.startsWith("/.netlify/")) return baseUrl;
  const basePath = getConfiguredAppBasePath();
  if (!basePath) return baseUrl;
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith(basePath)) {
    return trimmed.slice(0, trimmed.length - basePath.length);
  }
  return trimmed;
}

export async function fireInternalDispatch(
  options: FireInternalDispatchOptions,
): Promise<void> {
  const baseUrl = options.baseUrl ?? resolveSelfDispatchBaseUrl(options.event);
  // Netlify function default urls (`/.netlify/functions/<name>`) live at the
  // HOST ROOT, not under the workspace app base path. `resolveSelfDispatchBaseUrl`
  // appends the configured base path (e.g. `https://host/starter`) so framework
  // routes land on the right app; for a host-root function url we must dispatch
  // to `https://host/.netlify/functions/<name>` instead. Strip the base path
  // suffix from the resolved base url for `/.netlify/*` dispatch targets only.
  const url = `${rootBaseUrlForPath(baseUrl, options.path)}${options.path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(options.taskId)}`;
  } catch (err) {
    // Distinguish the documented "no A2A_SECRET in dev" path from a real
    // signing failure, so a malformed secret doesn't fail invisibly.
    if (err instanceof Error && !/A2A_SECRET/i.test(err.message)) {
      console.error(
        `[self-dispatch] signInternalToken failed unexpectedly for ${options.taskId}:`,
        err,
      );
    }
  }

  const dispatchPromise = fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ taskId: options.taskId, ...(options.body ?? {}) }),
  }).then(async (res) => {
    if (!res.ok) {
      throw await dispatchResponseError(options.path, res);
    }
  });
  dispatchPromise.catch((err) => {
    // Include the resolved base URL: a self-dispatch failure is almost always
    // about *which* host we POST to (custom domain behind an edge/auth wall vs
    // the deploy URL), and that is invisible from the error alone. Keeps prod
    // logs diagnostic without changing the URL resolution order.
    console.error(
      `[self-dispatch] dispatch to ${options.path} (base ${baseUrl}) failed:`,
      err,
    );
  });

  const settleMs = options.settleMs ?? DEFAULT_DISPATCH_SETTLE_MS;
  await Promise.race([
    dispatchPromise,
    new Promise<void>((resolve) => setTimeout(resolve, settleMs)),
  ]);
}
