import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import {
  bindActionBatch,
  runActionBatch,
  type ActionBatchBinding,
} from "./action-batch.js";
import { captureError } from "./capture-error.js";
import { runWithRequestContext } from "./request-context.js";

vi.mock("./capture-error.js", () => ({
  captureError: vi.fn(() => "capture-test-id"),
}));

const CANARY = "PRIVATE-CANARY-9f3a";
const PUBLIC_MARKER = "public-diagnostic-marker-7c21";

type ActionRunContext = NonNullable<Parameters<typeof runActionBatch>[1]>;

function entry(value: Record<string, unknown>): ActionEntry {
  return value as unknown as ActionEntry;
}

function contains(
  value: unknown,
  needle: string,
  seen = new Set<unknown>(),
): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value instanceof Error)
    return [value.message, value.stack, value.cause].some((v) =>
      contains(v, needle, seen),
    );
  if (value && typeof value === "object") {
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some((v) => contains(v, needle, seen));
  }
  return false;
}

function containsCanary(value: unknown): boolean {
  return contains(value, CANARY);
}

function batch(
  fetch: ActionBatchBinding["fetch"],
  actions: Record<string, ActionEntry>,
  requests: Array<{ action: string; query: string }>,
  ctxOverrides: Partial<ActionRunContext> = {},
) {
  bindActionBatch({ fetch, actions });
  const ctx = { ...ctxOverrides, caller: "http" } as ActionRunContext;
  return Promise.resolve(
    runWithRequestContext(
      { requestOrigin: "https://app.example.com" } as never,
      () => runActionBatch({ requests }, ctx),
    ),
  );
}

function expectOmitted(call: unknown[]): void {
  expect(call[0]).toBeInstanceOf(Error);
  expect(containsCanary(call)).toBe(false);
  expect((call[1] as any)?.errorMessagePolicy).toBe("omit");
  for (const logged of vi.mocked(console.error).mock.calls)
    expect(containsCanary(logged)).toBe(false);
}

beforeEach(() => {
  vi.mocked(captureError).mockReset();
  vi.mocked(captureError).mockReturnValue("capture-test-id");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("action batch transport-failure privacy", () => {
  it("omits a private fetch rejection while its neighbor succeeds", async () => {
    const boom = Object.assign(new Error(`body-${CANARY}`), {
      body: `body-${CANARY}`,
      cause: new Error(`cause-${CANARY}`),
    });
    const fetch = vi.fn((r: Request) =>
      new URL(r.url).pathname.endsWith("/ok")
        ? Promise.resolve(
            new Response(JSON.stringify({ ok: true }), {
              headers: { "x-agent-native-request-id": "req-ok" },
            }),
          )
        : Promise.reject(boom),
    );
    const { results } = await batch(
      fetch,
      {
        secret: entry({ http: { method: "GET" }, persistInChatHistory: false }),
        ok: entry({ http: { method: "GET" } }),
      },
      [
        { action: "secret", query: "" },
        { action: "ok", query: "" },
      ],
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual({
      status: 500,
      error: { error: "Internal server error" },
    });
    expect(results[1]).toMatchObject({
      status: 200,
      body: { ok: true },
      headers: { "x-agent-native-request-id": "req-ok" },
    });
    const call = vi.mocked(captureError).mock.calls[0];
    expect(call[0]).not.toBe(boom);
    expectOmitted(call);
  });

  it("omits a private response.text rejection", async () => {
    const text = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error(`text-${CANARY}`), { body: `b-${CANARY}` }),
      ),
    );
    const response = {
      status: 200,
      ok: true,
      headers: new Headers(),
      text,
    } as unknown as Response;
    const fetch = vi.fn(async () => response);
    const { results } = await batch(
      fetch,
      {
        secret: entry({ http: { method: "GET" }, persistInChatHistory: false }),
      },
      [{ action: "secret", query: "" }],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: 500, error: { error: "Internal server error" } },
    ]);
    expectOmitted(vi.mocked(captureError).mock.calls[0]);
  });

  it("omits a private non-Error throw", async () => {
    const thrown = { body: `b-${CANARY}`, toString: () => `t-${CANARY}` };
    const fetch = vi.fn(() => {
      throw thrown;
    });
    const { results } = await batch(
      fetch,
      {
        secret: entry({ http: { method: "GET" }, persistInChatHistory: false }),
      },
      [{ action: "secret", query: "" }],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: 500, error: { error: "Internal server error" } },
    ]);
    expect(vi.mocked(captureError).mock.calls[0][0]).not.toBe(thrown);
    expectOmitted(vi.mocked(captureError).mock.calls[0]);
  });

  it("keeps the original diagnostic for a public entry failure", async () => {
    const boom = new Error(`public-${CANARY}`);
    const fetch = vi.fn(() => Promise.reject(boom));
    const { results } = await batch(
      fetch,
      { open: entry({ http: { method: "GET" } }) },
      [{ action: "open", query: "" }],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: 500, error: { error: "Internal server error" } },
    ]);
    const call = vi.mocked(captureError).mock.calls[0];
    expect(call[0]).toBe(boom);
    expect((call[1] as any)?.errorMessagePolicy).not.toBe("omit");
    expect(
      vi.mocked(console.error).mock.calls.some((c) => containsCanary(c)),
    ).toBe(true);
  });

  it("classifies mixed private and public failures independently", async () => {
    const privateBoom = new Error(`p-${CANARY}`);
    const publicBoom = new Error(`q-${PUBLIC_MARKER}`);
    const fetch = vi.fn((r: Request) =>
      new URL(r.url).pathname.endsWith("/closed")
        ? Promise.reject(privateBoom)
        : Promise.reject(publicBoom),
    );
    const { results } = await batch(
      fetch,
      {
        closed: entry({ http: { method: "GET" }, persistInChatHistory: false }),
        open: entry({ http: { method: "GET" } }),
      },
      [
        { action: "closed", query: "" },
        { action: "open", query: "" },
      ],
    );
    expect(results.map((r) => r.status)).toEqual([500, 500]);
    const calls = vi.mocked(captureError).mock.calls;
    const find = (name: string) =>
      calls.find((c) => (c[1] as any)?.tags?.batch_item === name)!;
    const privateCall = find("closed");
    const publicCall = find("open");
    expect(privateCall[0]).not.toBe(privateBoom);
    expectOmitted(privateCall);
    expect(publicCall[0]).toBe(publicBoom);
    expect((publicCall[1] as any)?.errorMessagePolicy).not.toBe("omit");
    expect(
      vi
        .mocked(console.error)
        .mock.calls.some((c) => contains(c, PUBLIC_MARKER)),
    ).toBe(true);
  });

  it("protects an otherwise public entry during an ambient private turn", async () => {
    const boom = new Error(`ambient-${CANARY}`);
    const fetch = vi.fn(() => Promise.reject(boom));
    const { results } = await batch(
      fetch,
      { open: entry({ http: { method: "GET" } }) },
      [{ action: "open", query: "" }],
      { omitFromPersistedHistory: true },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: 500, error: { error: "Internal server error" } },
    ]);
    expect(vi.mocked(captureError).mock.calls[0][0]).not.toBe(boom);
    expectOmitted(vi.mocked(captureError).mock.calls[0]);
  });
});
