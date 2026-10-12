// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import {
  fetchActionGet,
  resetActionGetBatchForTests,
} from "./action-get-batch.js";
import { callAction, useActionQuery } from "./use-action.js";

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
 * and any single action call; the default echoes the URL back.
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

function answerBatches(call: RecordedCall): Response {
  return call.url === BATCH_URL
    ? batchResponses(call, () => ({ status: 200, body: {} }))
    : jsonResponse({});
}

function batchedActions(calls: RecordedCall[]): string[] | undefined {
  return calls
    .find((call) => call.url === BATCH_URL)
    ?.body?.requests?.map((request) => request.action);
}

type QuerySpec = readonly [
  name: string,
  params?: Record<string, unknown>,
  options?: { batchRefetches?: boolean },
];

const roots: Root[] = [];

function Probe({ spec: [name, params, options] }: { spec: QuerySpec }) {
  useActionQuery(name, params, { retry: false, ...options });
  return null;
}

/**
 * Mounts one useActionQuery per spec and waits for their first fetches.
 * `refetchAll` then invalidates every action query at once, so the refetches
 * start in one tick, and returns each query's state once they settle.
 */
async function mountQueries(
  specs: readonly QuerySpec[],
  queryClient = new QueryClient(),
) {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        specs.map((spec, index) => createElement(Probe, { key: index, spec })),
      ),
    ),
  );
  await settled(queryClient);
  const states = () =>
    specs.map(([name, params]) =>
      queryClient.getQueryState(["action", name, params]),
    );
  return {
    queryClient,
    states,
    async refetchAll() {
      await act(() => queryClient.invalidateQueries({ queryKey: ["action"] }));
      return states();
    },
  };
}

async function settled(queryClient: QueryClient) {
  await act(() => vi.waitFor(() => expect(queryClient.isFetching()).toBe(0)));
}

function requestLine(call: RecordedCall): string {
  return `${call.method} ${call.url}`;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetActionGetBatchForTests();
  resetActionFailureCircuits();
});

describe("action GET batching", () => {
  it("sends each query's first fetch on its own request, even when they mount together", async () => {
    const names = ["list-designs", "list-decks", "get-brand"];
    const { calls } = stubFetch();

    const { states } = await mountQueries(
      names.map((name) => [name, { limit: 5 }] as const),
    );

    expect(calls.map(requestLine)).toEqual(
      names.map((name) => `GET /_agent-native/actions/${name}?limit=5`),
    );
    expect(states().map((state) => state?.status)).toEqual(
      names.map(() => "success"),
    );
  });

  it("sends refetches of data already on screen as one request", async () => {
    const names = [
      "list-designs",
      "list-decks",
      "get-brand",
      "list-folders",
      "get-settings",
    ];
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, (index) => ({
            status: 200,
            body: { action: call.body?.requests?.[index]?.action },
          }))
        : jsonResponse({}),
    );
    const { refetchAll } = await mountQueries(
      names.map((name) => [name, { limit: 5 }] as const),
    );
    calls.length = 0;

    const states = await refetchAll();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: BATCH_URL, method: "POST" });
    expect(calls[0].body?.requests).toEqual(
      names.map((action) => ({ action, query: "limit=5" })),
    );
    expect(states.map((state) => state?.data)).toEqual(
      names.map((action) => ({ action })),
    );
  });

  it("batches the mount-time refetch of data already in the cache", async () => {
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, (index) => ({ status: 200, body: { index } }))
        : jsonResponse({}),
    );
    const queryClient = new QueryClient();
    for (const name of ["get-a", "get-b"]) {
      queryClient.setQueryData(
        ["action", name, undefined],
        { restored: name },
        { updatedAt: Date.now() - 60_000 },
      );
    }

    const { states } = await mountQueries([["get-a"], ["get-b"]], queryClient);

    expect(calls.map(requestLine)).toEqual([`POST ${BATCH_URL}`]);
    expect(states().map((state) => state?.data)).toEqual([
      { index: 0 },
      { index: 1 },
    ]);
  });

  it("sends a new query's first fetch alone while refetches in its tick share a batch", async () => {
    const { calls } = stubFetch(answerBatches);
    const { queryClient } = await mountQueries([["get-a"], ["get-b"]]);
    calls.length = 0;
    const root = createRoot(document.createElement("div"));
    roots.push(root);

    act(() => {
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe, { spec: ["get-c"] }),
        ),
      );
    });
    await settled(queryClient);

    expect(calls.map(requestLine).sort()).toEqual([
      "GET /_agent-native/actions/get-c",
      `POST ${BATCH_URL}`,
    ]);
    expect(batchedActions(calls)).toEqual(["get-a", "get-b"]);
  });

  it("keeps refetches of a query that opts out of batching on their own requests", async () => {
    const { calls } = stubFetch(answerBatches);
    const { refetchAll } = await mountQueries([
      ["get-a"],
      ["get-b"],
      ["get-editor-document", undefined, { batchRefetches: false }],
    ]);
    calls.length = 0;

    await refetchAll();

    expect(calls.map(requestLine).sort()).toEqual([
      "GET /_agent-native/actions/get-editor-document",
      `POST ${BATCH_URL}`,
    ]);
    expect(batchedActions(calls)).toEqual(["get-a", "get-b"]);
  });

  it.each([
    ["after", false],
    ["before", true],
  ])(
    "keeps an opted-out query unbatched when another reader of it renders %s",
    async (_, defaultReaderFirst) => {
      const { calls } = stubFetch(answerBatches);
      const optedOut: QuerySpec = [
        "get-editor-document",
        undefined,
        { batchRefetches: false },
      ];
      const defaultReader: QuerySpec = ["get-editor-document"];
      const { refetchAll } = await mountQueries([
        ["get-a"],
        ["get-b"],
        ...(defaultReaderFirst
          ? [defaultReader, optedOut]
          : [optedOut, defaultReader]),
      ]);
      calls.length = 0;

      await refetchAll();

      expect(calls.map(requestLine).sort()).toEqual([
        "GET /_agent-native/actions/get-editor-document",
        `POST ${BATCH_URL}`,
      ]);
      expect(batchedActions(calls)).toEqual(["get-a", "get-b"]);
    },
  );

  it("keeps imperative GET calls on their own requests", async () => {
    const { calls } = stubFetch();

    await Promise.all([
      callAction("get-a", {}, { method: "GET" }),
      callAction("get-b", {}, { method: "GET" }),
      callAction("get-solo", { id: "d1" }, { method: "GET" }),
    ]);

    expect(calls.map(requestLine)).toEqual([
      "GET /_agent-native/actions/get-a",
      "GET /_agent-native/actions/get-b",
      "GET /_agent-native/actions/get-solo?id=d1",
    ]);
  });

  it("fails only the query whose batched item returned 403", async () => {
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
    const { refetchAll } = await mountQueries([
      ["get-a"],
      ["get-b"],
      ["get-c"],
    ]);

    const [first, second, third] = await refetchAll();

    expect(first?.data).toEqual({ index: 0 });
    expect(third?.data).toEqual({ index: 2 });
    expect(second?.status).toBe("error");
    const error = second?.error as Error & {
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

  it("fails every batched query when the batch body is not a valid response", async () => {
    stubFetch((call) =>
      call.url === BATCH_URL
        ? new Response("<html>proxy error</html>", { status: 200 })
        : jsonResponse({}),
    );
    const { refetchAll } = await mountQueries([["get-a"], ["get-b"]]);

    const states = await refetchAll();

    expect(states.map((state) => state?.status)).toEqual(["error", "error"]);
    expect(states.map((state) => state?.error?.message)).toEqual([
      "Action get-a failed: Action batch returned an invalid response.",
      "Action get-b failed: Action batch returned an invalid response.",
    ]);
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
    const { queryClient } = await mountQueries([["get-a"], ["get-b"]]);
    calls.length = 0;

    await act(() =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["action"] }),
        callAction("save-deck", { title: "Q3" }, { method: "POST" }),
      ]),
    );

    expect(calls.map(requestLine).sort()).toEqual([
      `POST ${BATCH_URL}`,
      "POST /_agent-native/actions/save-deck",
    ]);
    const batch = calls.find((call) => call.url === BATCH_URL);
    expect(batch?.body?.requests?.map((request) => request.action)).toEqual([
      "get-a",
      "get-b",
    ]);
  });

  it("keeps a lone refetch on the single request path", async () => {
    const { calls } = stubFetch();
    const { refetchAll } = await mountQueries([["get-solo", { id: "d1" }]]);
    calls.length = 0;

    await refetchAll();

    expect(calls.map(requestLine)).toEqual([
      "GET /_agent-native/actions/get-solo?id=d1",
    ]);
  });

  it("falls back to single GETs when the batch endpoint is missing", async () => {
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? jsonResponse(MISSING_BATCH_ROUTE, { status: 404 })
        : jsonResponse({ url: call.url }),
    );
    const { refetchAll } = await mountQueries([["get-a"], ["get-b"]]);
    calls.length = 0;

    const states = await refetchAll();

    expect(calls.map(requestLine)).toEqual([
      `POST ${BATCH_URL}`,
      "GET /_agent-native/actions/get-a",
      "GET /_agent-native/actions/get-b",
    ]);
    expect(states.map((state) => state?.data)).toEqual([
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
    const { refetchAll } = await mountQueries([["get-c"], ["get-d"]]);
    await refetchAll();
    calls.length = 0;

    await refetchAll();

    expect(calls.map(requestLine)).toEqual([
      "GET /_agent-native/actions/get-c",
      "GET /_agent-native/actions/get-d",
    ]);
  });

  it("falls back for one batch on a transient 404, and batches again on the next tick", async () => {
    let transient = true;
    const { calls } = stubFetch((call) => {
      if (call.url !== BATCH_URL) return jsonResponse({ url: call.url });
      if (transient) {
        return jsonResponse({ error: "Gateway timeout" }, { status: 404 });
      }
      return batchResponses(call, (index) => ({
        status: 200,
        body: { index },
      }));
    });
    const { refetchAll } = await mountQueries([["get-a"], ["get-b"]]);

    const first = await refetchAll();
    expect(first.map((state) => state?.data)).toEqual([
      { url: "/_agent-native/actions/get-a" },
      { url: "/_agent-native/actions/get-b" },
    ]);

    transient = false;
    calls.length = 0;
    const second = await refetchAll();
    expect(calls.map(requestLine)).toEqual([`POST ${BATCH_URL}`]);
    expect(second.map((state) => state?.data)).toEqual([
      { index: 0 },
      { index: 1 },
    ]);
  });

  it("sends each refetch alone when the batch is too large, and batches again on the next tick", async () => {
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
    const { refetchAll } = await mountQueries([["get-a"], ["get-b"]]);
    calls.length = 0;

    const first = await refetchAll();
    expect(first.map((state) => state?.data)).toEqual([
      { url: "/_agent-native/actions/get-a" },
      { url: "/_agent-native/actions/get-b" },
    ]);
    expect(calls.map(requestLine)).toEqual([
      `POST ${BATCH_URL}`,
      "GET /_agent-native/actions/get-a",
      "GET /_agent-native/actions/get-b",
    ]);

    tooLarge = false;
    calls.length = 0;
    await refetchAll();
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
  });

  it("splits a batch by body size, so no POST body nears the route's limit", async () => {
    const { calls } = stubFetch((call) =>
      call.url === BATCH_URL
        ? batchResponses(call, (index) => ({ status: 200, body: { index } }))
        : jsonResponse({}),
    );
    const padding = "x".repeat(12 * 1024);
    const { refetchAll } = await mountQueries(
      Array.from(
        { length: 50 },
        (_, index) => ["get-long", { q: `${padding}${index}` }] as const,
      ),
    );
    calls.length = 0;

    const states = await refetchAll();

    const posts = calls.filter((call) => call.url === BATCH_URL);
    expect(posts.length).toBeGreaterThan(1);
    expect(
      posts.reduce((sum, call) => sum + (call.body?.requests?.length ?? 0), 0),
    ).toBe(50);
    for (const post of posts) {
      const bytes = new TextEncoder().encode(JSON.stringify(post.body));
      expect(bytes.byteLength).toBeLessThan(256 * 1024);
    }
    expect(states.every((state) => state?.status === "success")).toBe(true);
  });

  it("keeps one request per call inside an embed", async () => {
    window.history.replaceState(null, "", "/?embedded=1");
    try {
      const { calls } = stubFetch();
      const { refetchAll } = await mountQueries([["get-a"], ["get-b"]]);
      calls.length = 0;

      await refetchAll();

      expect(calls.map(requestLine)).toEqual([
        "GET /_agent-native/actions/get-a",
        "GET /_agent-native/actions/get-b",
      ]);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
