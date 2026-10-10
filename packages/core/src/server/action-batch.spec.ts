import { afterEach, describe, expect, it, vi } from "vitest";

import { bindActionBatch, runActionBatch } from "./action-batch.js";
import batchAction from "./get-actions-batch.js";
import { runWithRequestContext } from "./request-context.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const actions = {
  "list-designs": { http: { method: "GET" } },
  "list-decks": { http: { method: "GET" } },
  "get-brand": { http: { method: "GET", path: "brands/by-id" } },
  "local-only": { http: false },
  "save-deck": { http: { method: "POST" } },
} as any;

function withOrigin<T>(run: () => Promise<T>): Promise<T> {
  return Promise.resolve(
    runWithRequestContext({ requestOrigin: "https://app.example.com" }, run),
  );
}

function callerHeaders(): Headers {
  return new Headers({
    cookie: "session=abc",
    authorization: "Bearer token-1",
    host: "app.example.com",
    "content-length": "42",
    "content-type": "application/json",
    "x-agent-native-frontend": "1",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("get-actions-batch dispatch", () => {
  it("sends each item as a GET to its route with the caller's headers", async () => {
    const seen: Request[] = [];
    bindActionBatch({
      fetch: async (request) => {
        seen.push(request);
        return jsonResponse({ ok: true });
      },
      actions,
    });

    await withOrigin(() =>
      runActionBatch(
        { requests: [{ action: "list-designs", query: "limit=5" }] },
        { caller: "http", requestHeaders: callerHeaders() } as any,
      ),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].url).toBe(
      "https://app.example.com/_agent-native/actions/list-designs?limit=5",
    );
    expect(seen[0].headers.get("cookie")).toBe("session=abc");
    expect(seen[0].headers.get("authorization")).toBe("Bearer token-1");
    expect(seen[0].headers.get("x-agent-native-frontend")).toBe("1");
    expect(seen[0].headers.get("host")).toBeNull();
    expect(seen[0].headers.get("content-length")).toBeNull();
  });

  it("keeps one item's 403 from failing the other items", async () => {
    bindActionBatch({
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/list-decks")) {
          return jsonResponse(
            { error: "Not allowed", errorCode: "forbidden" },
            { status: 403, headers: { "Retry-After": "3" } },
          );
        }
        return jsonResponse({ path });
      },
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch(
        {
          requests: [
            { action: "list-designs", query: "" },
            { action: "list-decks", query: "" },
            { action: "get-brand", query: "" },
          ],
        },
        { caller: "http" } as any,
      ),
    );

    expect(results).toEqual([
      {
        status: 200,
        body: { path: "/_agent-native/actions/list-designs" },
        headers: {},
      },
      {
        status: 403,
        error: { error: "Not allowed", errorCode: "forbidden" },
        headers: { "retry-after": "3" },
      },
      {
        status: 200,
        body: { path: "/_agent-native/actions/brands/by-id" },
        headers: {},
      },
    ]);
  });

  it("turns an item whose dispatch throws into a 500 item", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    bindActionBatch({
      fetch: async (request) => {
        if (new URL(request.url).pathname.endsWith("/list-decks")) {
          throw new Error("connection reset");
        }
        return jsonResponse({ ok: true });
      },
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch(
        {
          requests: [
            { action: "list-designs", query: "" },
            { action: "list-decks", query: "" },
          ],
        },
        { caller: "http" } as any,
      ),
    );

    expect(results[0]).toEqual({
      status: 200,
      body: { ok: true },
      headers: {},
    });
    expect(results[1]).toEqual({
      status: 500,
      error: { error: "Internal server error" },
    });
  });

  it("answers unknown and non-HTTP actions without dispatching them", async () => {
    const seen: Request[] = [];
    bindActionBatch({
      fetch: async (request) => {
        seen.push(request);
        return jsonResponse({});
      },
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch(
        {
          requests: [
            { action: "no-such-action", query: "" },
            { action: "local-only", query: "" },
          ],
        },
        { caller: "http" } as any,
      ),
    );

    expect(results.map((result) => result.status)).toEqual([404, 404]);
    expect(seen).toHaveLength(0);
  });

  it("passes a POST action's 405 through instead of running it", async () => {
    const seen: Request[] = [];
    bindActionBatch({
      fetch: async (request) => {
        seen.push(request);
        return jsonResponse(
          { error: "Method not allowed. Use POST." },
          { status: 405 },
        );
      },
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch({ requests: [{ action: "save-deck", query: "" }] }, {
        caller: "http",
      } as any),
    );

    expect(results).toEqual([
      {
        status: 405,
        error: { error: "Method not allowed. Use POST." },
        headers: {},
      },
    ]);
    expect(seen.map((request) => request.method)).toEqual(["GET"]);
  });

  it("returns a 204 item without a body", async () => {
    bindActionBatch({
      fetch: async () => new Response(null, { status: 204 }),
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch({ requests: [{ action: "list-designs", query: "" }] }, {
        caller: "http",
      } as any),
    );

    expect(results).toEqual([{ status: 204, headers: {} }]);
  });

  it("returns the browser persist header on a batched GET item", async () => {
    bindActionBatch({
      fetch: async () =>
        jsonResponse(
          { name: "list-designs" },
          { headers: { "x-agent-native-browser-persist": "allow" } },
        ),
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch({ requests: [{ action: "list-designs", query: "" }] }, {
        caller: "http",
      } as any),
    );

    expect(results).toEqual([
      {
        status: 200,
        body: { name: "list-designs" },
        headers: { "x-agent-native-browser-persist": "allow" },
      },
    ]);
  });

  it("returns the failed change marker header on a batched GET write", async () => {
    bindActionBatch({
      fetch: async () =>
        jsonResponse(
          { ok: true },
          { headers: { "X-Agent-Native-Change-Marker": "failed" } },
        ),
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch({ requests: [{ action: "list-designs", query: "" }] }, {
        caller: "http",
      } as any),
    );

    expect(results).toEqual([
      {
        status: 200,
        body: { ok: true },
        headers: { "x-agent-native-change-marker": "failed" },
      },
    ]);
  });

  it("rejects a batch over the request limit before dispatching", async () => {
    const seen: Request[] = [];
    bindActionBatch({
      fetch: async (request) => {
        seen.push(request);
        return jsonResponse({});
      },
      actions,
    });

    await expect(
      batchAction.run(
        {
          requests: Array.from({ length: 51 }, (_, index) => ({
            action: "list-designs",
            query: `page=${index}`,
          })),
        },
        { caller: "http" } as any,
      ),
    ).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it("returns the client build markers on a batched item", async () => {
    bindActionBatch({
      fetch: async () =>
        jsonResponse(
          { error: "Client build is out of date" },
          {
            status: 409,
            headers: {
              "X-Agent-Native-Client-Mismatch": "1",
              "X-Agent-Native-Build-Id": "build-2",
              "X-Agent-Native-Client-Compatibility": "7",
            },
          },
        ),
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch({ requests: [{ action: "list-designs", query: "" }] }, {
        caller: "http",
      } as any),
    );

    expect(results[0]).toEqual({
      status: 409,
      error: { error: "Client build is out of date" },
      headers: {
        "x-agent-native-client-mismatch": "1",
        "x-agent-native-build-id": "build-2",
        "x-agent-native-client-compatibility": "7",
      },
    });
  });

  it("runs at most four items at once and resolves all of them", async () => {
    let running = 0;
    let peak = 0;
    bindActionBatch({
      fetch: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return jsonResponse({ ok: true });
      },
      actions,
    });

    const { results } = await withOrigin(() =>
      runActionBatch(
        {
          requests: Array.from({ length: 50 }, (_, index) => ({
            action: "list-designs",
            query: `page=${index}`,
          })),
        },
        { caller: "http" } as any,
      ),
    );

    expect(results).toHaveLength(50);
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(peak).toBe(4);
  });
});
