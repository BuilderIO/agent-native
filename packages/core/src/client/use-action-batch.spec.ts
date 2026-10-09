import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import {
  fetchActionGet,
  resetActionGetBatchForTests,
} from "./action-get-batch.js";
import { callAction } from "./use-action.js";

const BATCH_URL = "/_agent-native/actions/get-actions-batch";
// What a server without the batch action answers: the body names the route.
const MISSING_BATCH_ROUTE = {
  error:
    "Cannot find any route matching /_agent-native/actions/get-actions-batch",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

type RecordedCall = {
  url: string;
  method: string;
  body?: { requests?: Array<{ action: string; query: string }> } & Record<
    string,
    unknown
  >;
};

/**
 * Records every fetch the client makes. `respond` answers the batch endpoint
 * and any single action call; the default echoes the action name back.
 */
function stubFetch(
  respond: (call: RecordedCall) => Response | Promise<Response> = (call) =>
    jsonResponse({ url: call.url }),
) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(url),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function batchResponses(
  call: RecordedCall,
  results: (index: number) => unknown,
): Response {
  const requests = call.body?.requests ?? [];
  return jsonResponse({
    results: requests.map((_, index) => results(index)),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetActionGetBatchForTests();
});

describe("action GET batching", () => {
  it("issues one request for GET calls made in the same tick", async () => {
    const names = [
      "list-designs",
      "list-decks",
      "get-brand",
      "list-folders",
      "get-settings",
    ];
    const { fetchMock, calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, (index) => ({
            status: 200,
            body: { action: call.body?.requests?.[index]?.action },
          }))
        : jsonResponse({}),
    );

    const results = await Promise.all(
      names.map((name) => callAction(name, { limit: 5 }, { method: "GET" })),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ url: BATCH_URL, method: "POST" });
    expect(calls[0].body?.requests).toEqual(
      names.map((action) => ({ action, query: "limit=5" })),
    );
    expect(results).toEqual(names.map((action) => ({ action })));
  });

  it("rejects only the call whose item returned 403", async () => {
    stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, (index) =>
            index === 1
              ? {
                  status: 403,
                  error: {
                    error: "Not allowed for this design",
                    errorCode: "forbidden",
                  },
                }
              : { status: 200, body: { index } },
          )
        : jsonResponse({}),
    );

    const settled = await Promise.allSettled([
      callAction("get-a", {}, { method: "GET" }),
      callAction("get-b", {}, { method: "GET" }),
      callAction("get-c", {}, { method: "GET" }),
    ]);

    expect(settled[0]).toEqual({ status: "fulfilled", value: { index: 0 } });
    expect(settled[2]).toEqual({ status: "fulfilled", value: { index: 2 } });
    const rejected = settled[1];
    expect(rejected.status).toBe("rejected");
    const error = (rejected as PromiseRejectedResult).reason as Error & {
      status?: number;
      errorCode?: string;
      actionMessage?: string;
    };
    expect(error.message).toBe(
      "Action get-b failed: Not allowed for this design",
    );
    expect(error.status).toBe(403);
    expect(error.errorCode).toBe("forbidden");
    expect(error.actionMessage).toBe("Not allowed for this design");
  });

  it("gives each batched item response the byte length of its body", async () => {
    stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, (index) => ({
            status: 200,
            body: { index, title: "café ✓" },
          }))
        : jsonResponse({}),
    );

    const [first, second] = await Promise.all(
      ["get-a", "get-b"].map((name) =>
        fetchActionGet({
          name,
          query: "",
          url: `/_agent-native/actions/${name}`,
          init: { method: "GET" },
          headers: {},
          batchUrl: BATCH_URL,
        }),
      ),
    );

    // 28 characters but 31 UTF-8 bytes: the header must count bytes.
    expect(await first.text()).toBe('{"index":0,"title":"café ✓"}');
    expect(first.headers.get("content-length")).toBe("31");
    expect(second.headers.get("content-length")).toBe("31");
  });

  it("never batches a mutation", async () => {
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, () => ({ status: 200, body: {} }))
        : jsonResponse({}),
    );

    await Promise.all([
      callAction("get-a", {}, { method: "GET" }),
      callAction("get-b", {}, { method: "GET" }),
      callAction("save-deck", { title: "Q3" }, { method: "POST" }),
    ]);

    const saves = calls.filter((call) => call.url.includes("/save-deck"));
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ method: "POST" });
    const batched = calls.flatMap((call) => call.body?.requests ?? []);
    expect(batched.map((request) => request.action)).not.toContain("save-deck");
  });

  it("keeps a lone GET on the single request path", async () => {
    const { calls } = stubFetch();

    await callAction("get-solo", { id: "d1" }, { method: "GET" });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/_agent-native/actions/get-solo?id=d1");
  });

  it("falls back to single GETs when the batch endpoint is missing", async () => {
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? jsonResponse(MISSING_BATCH_ROUTE, { status: 404 })
        : jsonResponse({ url: call.url }),
    );

    const results = await Promise.all([
      callAction("get-a", {}, { method: "GET" }),
      callAction("get-b", {}, { method: "GET" }),
    ]);

    expect(calls).toHaveLength(3);
    expect(results).toEqual([
      { url: "/_agent-native/actions/get-a" },
      { url: "/_agent-native/actions/get-b" },
    ]);
  });

  it("stops trying the batch after the endpoint is missing", async () => {
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? jsonResponse(MISSING_BATCH_ROUTE, { status: 404 })
        : jsonResponse({ url: call.url }),
    );
    await Promise.all([
      callAction("get-a", {}, { method: "GET" }),
      callAction("get-b", {}, { method: "GET" }),
    ]);
    calls.length = 0;

    await Promise.all([
      callAction("get-c", {}, { method: "GET" }),
      callAction("get-d", {}, { method: "GET" }),
    ]);

    expect(calls.map((call) => call.url)).toEqual([
      "/_agent-native/actions/get-c",
      "/_agent-native/actions/get-d",
    ]);
  });

  it("sends each call alone when the batch is too large, and batches again on the next tick", async () => {
    let tooLarge = true;
    const { calls } = stubFetch((call) => {
      if (call.url !== BATCH_URL) return jsonResponse({ url: call.url });
      if (tooLarge) {
        return jsonResponse(
          { error: "Request body too large" },
          { status: 413 },
        );
      }
      return batchResponses(call, (index) => ({
        status: 200,
        body: { index },
      }));
    });

    const first = await Promise.all([
      callAction("get-a", {}, { method: "GET" }),
      callAction("get-b", {}, { method: "GET" }),
    ]);
    expect(first).toEqual([
      { url: "/_agent-native/actions/get-a" },
      { url: "/_agent-native/actions/get-b" },
    ]);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${BATCH_URL}`,
      "GET /_agent-native/actions/get-a",
      "GET /_agent-native/actions/get-b",
    ]);

    tooLarge = false;
    calls.length = 0;
    await Promise.all([
      callAction("get-c", {}, { method: "GET" }),
      callAction("get-d", {}, { method: "GET" }),
    ]);
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
  });

  it("splits a batch by body size, so no POST body nears the route's limit", async () => {
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, (index) => ({ status: 200, body: { index } }))
        : jsonResponse({}),
    );
    const padding = "x".repeat(12 * 1024);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        callAction("get-long", { q: `${padding}${index}` }, { method: "GET" }),
      ),
    );

    const posts = calls.filter((call) => call.url === BATCH_URL);
    expect(posts.length).toBeGreaterThan(1);
    expect(
      posts.reduce((sum, call) => sum + (call.body?.requests?.length ?? 0), 0),
    ).toBe(50);
    for (const post of posts) {
      const bytes = new TextEncoder().encode(JSON.stringify(post.body));
      expect(bytes.byteLength).toBeLessThan(256 * 1024);
    }
    expect(results).toHaveLength(50);
  });

  it("keeps one request per call inside an embed", async () => {
    vi.stubGlobal("window", {
      location: { href: "https://app.example.com/?embedded=1" },
    });
    const { calls } = stubFetch();

    await Promise.all([
      callAction("get-a", {}, { method: "GET" }),
      callAction("get-b", {}, { method: "GET" }),
    ]);

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /_agent-native/actions/get-a",
      "GET /_agent-native/actions/get-b",
    ]);
  });
});
