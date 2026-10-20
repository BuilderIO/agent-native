import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { ActionBatchItemResult } from "../shared/action-batch.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import { captureError } from "./capture-error.js";
import { getRequestContext } from "./request-context.js";

// Kept out of get-actions-batch.ts: that module builds a defineAction at load,
// and action-routes.ts loads this file on every cold start.
export const ACTION_ROUTE_PREFIX = "/_agent-native/actions";

const NOT_FORWARDED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
]);

// A browser-side reader of a single GET's header only sees batched items for
// headers listed here, so a new reader must be added to this list.
const ITEM_RESPONSE_HEADERS = [
  "retry-after",
  "x-agent-native-request-id",
  "server-timing",
  "x-agent-native-browser-persist",
  "x-agent-native-change-marker",
  "x-agent-native-client-mismatch",
  "x-agent-native-build-id",
  "x-agent-native-client-compatibility",
] as const;

// Items share one database pool. On serverless that pool holds one connection,
// and more items than this queue for it until their connect budget runs out.
const ITEM_CONCURRENCY = 4;

export interface ActionBatchBinding {
  /** The app's HTTP pipeline (`nitroApp.fetch`). Each item is a real GET through it. */
  fetch: (request: Request) => Response | Promise<Response>;
  /** The mounted action registry, for `http.path` overrides and `http: false`. */
  actions: Record<string, ActionEntry>;
}

let binding: ActionBatchBinding | undefined;

/**
 * Called by mountActionRoutes for the primary action mount. The batch action
 * needs the pipeline and registry, which only the mount has.
 */
export function bindActionBatch(next: ActionBatchBinding): void {
  binding = next;
}

export async function runActionBatch(
  input: { requests: Array<{ action: string; query: string }> },
  ctx: ActionRunContext | undefined,
): Promise<{ results: ActionBatchItemResult[] }> {
  const bound = binding;
  if (!bound) {
    throw new Error(
      "get-actions-batch cannot dispatch: no action routes are mounted.",
    );
  }
  const origin = getRequestContext()?.requestOrigin;
  if (!origin) {
    throw new Error(
      "get-actions-batch cannot dispatch: the request has no origin.",
    );
  }
  const base = `${origin}${getConfiguredAppBasePath()}${ACTION_ROUTE_PREFIX}`;
  const headers = forwardedItemHeaders(ctx?.requestHeaders);
  const results = await mapWithConcurrency(
    input.requests,
    ITEM_CONCURRENCY,
    (item) => dispatchItem(item, base, headers, bound),
  );
  return { results };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Each item runs with the batch caller's headers, so the item sees the same
 * cookies, bearer token, and frontend markers its own GET would have carried.
 * Identity and access are then resolved by the item's own route.
 */
function forwardedItemHeaders(source: Headers | undefined): Headers {
  const headers = new Headers();
  source?.forEach((value, name) => {
    if (!NOT_FORWARDED_HEADERS.has(name)) headers.set(name, value);
  });
  return headers;
}

async function dispatchItem(
  item: { action: string; query: string },
  base: string,
  headers: Headers,
  bound: ActionBatchBinding,
): Promise<ActionBatchItemResult> {
  const entry = bound.actions[item.action];
  if (!entry || entry.http === false) {
    return {
      status: 404,
      error: { error: `Action "${item.action}" is not an HTTP action.` },
    };
  }
  // A POST action's route refuses a GET with 405 before running it, so a
  // mutation can never run through the batch.
  const path = entry.http?.path ?? item.action;
  const url = `${base}/${path}${item.query ? `?${item.query}` : ""}`;

  let response: Response;
  let text: string;
  try {
    response = await bound.fetch(new Request(url, { method: "GET", headers }));
    text = await response.text();
  } catch (error) {
    const captureId = captureError(error, {
      tags: { action: "get-actions-batch", batch_item: item.action },
    });
    console.error(`[agent-native] action batch item '${item.action}' failed:`, {
      ...(captureId ? { captureId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, error: { error: "Internal server error" } };
  }

  const itemHeaders = pickItemHeaders(response.headers);
  if (response.status === 204) {
    return { status: 204, headers: itemHeaders };
  }
  let payload: unknown;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        status: 502,
        error: { error: "Action returned a non-JSON response." },
        headers: itemHeaders,
      };
    }
  }
  return response.ok
    ? { status: response.status, body: payload, headers: itemHeaders }
    : { status: response.status, error: payload, headers: itemHeaders };
}

function pickItemHeaders(headers: Headers): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of ITEM_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) picked[name] = value;
  }
  return picked;
}
