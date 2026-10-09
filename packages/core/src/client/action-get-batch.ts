import {
  ACTION_BATCH_MAX_REQUESTS,
  type ActionBatchItemResult,
  type ActionBatchResponse,
} from "../shared/action-batch.js";

/**
 * Same-tick coalescing for action GETs. Calls made in one synchronous run,
 * such as a page's queries mounting together, are sent as one POST to the
 * batch action. Each caller gets a Response shaped like its own GET, so
 * performActionFetch's error handling applies to it unchanged.
 */

export interface ActionGetRequest {
  name: string;
  /** The query string a single GET of this action carries. */
  query: string;
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  batchUrl: string;
}

interface PendingGet {
  request: ActionGetRequest;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  detachAbort: () => void;
}

let pending: PendingGet[] = [];
let flushScheduled = false;
let batchUnsupported = false;

export function fetchActionGet(request: ActionGetRequest): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const signal = request.init.signal;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const item: PendingGet = {
      request,
      resolve,
      reject,
      settled: false,
      detachAbort: () => {},
    };
    if (signal) {
      const onAbort = () => settle(item, () => reject(abortError()));
      signal.addEventListener("abort", onAbort, { once: true });
      item.detachAbort = () => signal.removeEventListener("abort", onAbort);
    }
    pending.push(item);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  });
}

/** @internal exported for tests */
export function resetActionGetBatchForTests(): void {
  batchUnsupported = false;
}

function flush(): void {
  flushScheduled = false;
  const items = pending.filter((item) => !item.settled);
  pending = [];

  // One batch carries one header set, so calls that differ in headers
  // (for example X-Request-Source) go out as separate batches.
  const groups = new Map<string, PendingGet[]>();
  for (const item of items) {
    const key = JSON.stringify(item.request.headers);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  for (const group of groups.values()) {
    for (
      let start = 0;
      start < group.length;
      start += ACTION_BATCH_MAX_REQUESTS
    ) {
      sendGroup(group.slice(start, start + ACTION_BATCH_MAX_REQUESTS));
    }
  }
}

function sendGroup(items: PendingGet[]): void {
  if (items.length === 1 || batchUnsupported) {
    for (const item of items) sendSingle(item);
    return;
  }
  void sendBatch(items);
}

function sendSingle(item: PendingGet): void {
  fetch(item.request.url, item.request.init).then(
    (response) => settle(item, () => item.resolve(response)),
    (error) => settle(item, () => item.reject(error)),
  );
}

async function sendBatch(items: PendingGet[]): Promise<void> {
  const { batchUrl, headers } = items[0].request;
  let response: Response;
  let text: string;
  try {
    response = await fetch(batchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requests: items.map((item) => ({
          action: item.request.name,
          query: item.request.query,
        })),
      }),
      cache: "no-store",
    });
    text = await response.text();
  } catch (error) {
    for (const item of items) settle(item, () => item.reject(error));
    return;
  }

  // An app whose server does not serve the batch action answers 404 or 405.
  // Its calls then take the single-GET path, and later ticks skip the batch
  // rather than paying a failed POST each time.
  if (response.status === 404 || response.status === 405) {
    batchUnsupported = true;
    for (const item of items) {
      if (!item.settled) sendSingle(item);
    }
    return;
  }

  // A batch-level refusal (auth, client mismatch, UI capability, outage) is
  // the answer to every call in the batch, so each one is handed the same
  // response and takes the same error path a single GET would.
  if (!response.ok) {
    for (const item of items) {
      settle(item, () =>
        item.resolve(
          new Response(text, {
            status: response.status,
            headers: response.headers,
          }),
        ),
      );
    }
    return;
  }

  const results = parseBatchResults(text, items.length);
  if (!results) {
    const error = new Error("Action batch returned an invalid response.");
    for (const item of items) settle(item, () => item.reject(error));
    return;
  }
  items.forEach((item, index) =>
    settle(item, () => item.resolve(itemResponse(results[index]))),
  );
}

function parseBatchResults(
  text: string,
  expectedCount: number,
): ActionBatchItemResult[] | undefined {
  let parsed: Partial<ActionBatchResponse> | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const results = parsed?.results;
  if (!Array.isArray(results) || results.length !== expectedCount) {
    return undefined;
  }
  const valid = results.every(
    (result) =>
      result !== null &&
      typeof result === "object" &&
      Number.isInteger(result.status) &&
      result.status >= 200 &&
      result.status <= 599,
  );
  return valid ? results : undefined;
}

function itemResponse(result: ActionBatchItemResult): Response {
  const headers = new Headers(result.headers);
  const payload = result.status >= 400 ? result.error : result.body;
  if (result.status === 204 || payload === undefined) {
    return new Response(null, { status: result.status, headers });
  }
  // The payload is serialized again here, so its length is measured from this
  // body. A length carried over from the single GET would describe other bytes.
  const body = JSON.stringify(payload);
  headers.set("Content-Type", "application/json");
  headers.set(
    "Content-Length",
    String(new TextEncoder().encode(body).byteLength),
  );
  return new Response(body, {
    status: result.status,
    headers,
  });
}

function settle(item: PendingGet, act: () => void): void {
  if (item.settled) return;
  item.settled = true;
  item.detachAbort();
  act();
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
