// @vitest-environment happy-dom
//
// A lost-save-on-reload sweep found five apps whose page-level
// saves can be cancelled by an immediate reload because the write is not a
// keepalive request. The transport now sends every write that fits the
// browser's keepalive budget as one; these hold that rule down, including the
// two cases that must NOT be keepalive (an explicit false, and a body over the
// 64 KiB budget).
import { afterEach, describe, expect, it, vi } from "vitest";

import { callAction, KEEPALIVE_BODY_LIMIT_BYTES } from "./use-action.js";

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

function jsonResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

function captureFetch(): {
  calls: Array<[string, RequestInit]>;
  mock: typeof fetch;
} {
  const calls: Array<[string, RequestInit]> = [];
  const mock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init ?? {}]);
    return jsonResponse();
  }) as unknown as typeof fetch;
  return { calls, mock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a page-level write survives an immediate reload", () => {
  it("sends a small write as a keepalive request", async () => {
    const { calls, mock } = captureFetch();
    vi.stubGlobal("fetch", mock);

    await callAction("save-user-preferences", { colorMode: "light" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1].method).toBe("POST");
    expect(calls[0]?.[1].keepalive).toBe(true);
  });

  it("leaves a body over the keepalive budget as a normal request", async () => {
    const { calls, mock } = captureFetch();
    vi.stubGlobal("fetch", mock);

    const big = "x".repeat(KEEPALIVE_BODY_LIMIT_BYTES + 1024);
    await callAction("save-user-preferences", { note: big });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1].keepalive).toBeUndefined();
  });

  it("honours an explicit false, which is how a caller opts out", async () => {
    const { calls, mock } = captureFetch();
    vi.stubGlobal("fetch", mock);

    await callAction("save-user-preferences", { colorMode: "dark" }, {
      keepalive: false,
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1].keepalive).toBe(false);
  });

  it("never marks a read as keepalive", async () => {
    const { calls, mock } = captureFetch();
    vi.stubGlobal("fetch", mock);

    await callAction("get-user-preferences", {}, { method: "GET" } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1].keepalive).toBeUndefined();
  });
});
