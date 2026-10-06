// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  expireClientStatusResult,
  fetchAgentEngineStatus,
  fetchAuthSessionStatus,
  fetchBuilderStatus,
  fetchEnvironmentStatus,
  fetchFileUploadStatus,
  invalidateClientStatusRequest,
  invalidateClientStatusRequests,
  SESSION_RESULT_LIFETIME_MS,
} from "./client-status-requests.js";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

function untilAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

describe("client status requests", () => {
  beforeEach(() => {
    invalidateClientStatusRequests();
    delete window.__agentNativeSessionBootstrap;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    delete window.__agentNativeSessionBootstrap;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("coalesces concurrent reads", async () => {
    const fetch = vi.fn(async () => jsonResponse({ configured: true }));
    vi.stubGlobal("fetch", fetch);

    const first = fetchBuilderStatus<{ configured: boolean }>();
    const second = fetchBuilderStatus<{ configured: boolean }>();
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(first).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
    await expect(second).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
  });

  it("starts a fresh status read and routes superseded callers to its result", async () => {
    let resolvePassive!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePassive = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ chatEligible: false }));
    vi.stubGlobal("fetch", fetch);

    const passive = fetchAgentEngineStatus<{ chatEligible: boolean }>();
    const fresh = fetchAgentEngineStatus<{ chatEligible: boolean }>({
      fresh: true,
    });
    await expect(fresh).resolves.toEqual({
      state: "available",
      value: { chatEligible: false },
    });
    resolvePassive(jsonResponse({ chatEligible: true }));

    await expect(passive).resolves.toEqual({
      state: "available",
      value: { chatEligible: false },
    });
    await expect(fetchAgentEngineStatus()).resolves.toEqual({
      state: "available",
      value: { chatEligible: false },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent fresh status reads", async () => {
    let resolveFresh!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFresh = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);

    const first = fetchAgentEngineStatus<{ chatEligible: boolean }>({
      fresh: true,
    });
    const second = fetchAgentEngineStatus<{ chatEligible: boolean }>({
      fresh: true,
    });
    expect(fetch).toHaveBeenCalledOnce();

    resolveFresh(jsonResponse({ chatEligible: true }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { state: "available", value: { chatEligible: true } },
      { state: "available", value: { chatEligible: true } },
    ]);
  });

  it("keeps a failed file-storage status probe unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("storage check failed", { status: 503 })),
    );

    await expect(fetchFileUploadStatus()).resolves.toEqual({
      state: "unavailable",
      status: 503,
    });
  });

  it("consumes the session request started by the static shell", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ error: "unexpected fetch" }),
    );
    vi.stubGlobal("fetch", fetch);
    window.__agentNativeSessionBootstrap = Promise.resolve({
      state: "available",
      value: { userId: "user-1", email: "user@example.com" },
    });

    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "user-1", email: "user@example.com" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(window.__agentNativeSessionBootstrap).toBeUndefined();
  });

  it("discards an unconsumed session bootstrap when session status is invalidated", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ userId: "current-user", email: "current@example.com" }),
    );
    vi.stubGlobal("fetch", fetch);
    window.__agentNativeSessionBootstrap = Promise.resolve({
      state: "available",
      value: { userId: "stale-user", email: "stale@example.com" },
    });

    invalidateClientStatusRequest("/_agent-native/auth/session");

    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "current-user", email: "current@example.com" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts fresh after invalidation and ignores a late stale result", async () => {
    let resolveStale!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValue(jsonResponse({ configured: false }));
    vi.stubGlobal("fetch", fetch);

    const stale = fetchBuilderStatus();
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
    await expect(fetchBuilderStatus()).resolves.toEqual({
      state: "available",
      value: { configured: false },
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    resolveStale(jsonResponse({ configured: true }));
    await expect(stale).resolves.toEqual({
      state: "available",
      value: { configured: false },
    });
    await expect(fetchBuilderStatus()).resolves.toEqual({
      state: "available",
      value: { configured: false },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not abort another endpoint when one status request is invalidated", async () => {
    let resolveEnvironment!: (response: Response) => void;
    let builderReads = 0;
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/builder/status")) {
        builderReads += 1;
        return builderReads === 1
          ? untilAborted(init?.signal)
          : Promise.resolve(jsonResponse({ configured: true }));
      }
      return new Promise<Response>((resolve) => {
        resolveEnvironment = resolve;
      });
    });
    vi.stubGlobal("fetch", fetch);

    const builder = fetchBuilderStatus();
    const environment = fetchEnvironmentStatus();
    invalidateClientStatusRequest("/_agent-native/builder/status");
    resolveEnvironment(jsonResponse([{ key: "ANTHROPIC_API_KEY" }]));

    await expect(builder).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
    expect(builderReads).toBe(2);
    await expect(environment).resolves.toEqual({
      state: "available",
      value: [{ key: "ANTHROPIC_API_KEY" }],
    });
  });

  it("gives callers of an invalidated engine status read the re-read result", async () => {
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) await untilAborted(init?.signal);
      return jsonResponse({ chatEligible: true });
    });
    vi.stubGlobal("fetch", fetch);

    const joined = fetchAgentEngineStatus({ fresh: true });
    window.dispatchEvent(new Event("agent-engine:configured-changed"));

    await expect(joined).resolves.toEqual({
      state: "available",
      value: { chatEligible: true },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("expires cached status on focus without aborting an in-flight request", async () => {
    let resolveBuilder!: (response: Response) => void;
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          resolveBuilder = resolve;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetch);

    const builder = fetchBuilderStatus();
    window.dispatchEvent(new Event("focus"));
    resolveBuilder(jsonResponse({ configured: true }));

    await expect(builder).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
  });

  it("keeps the session answer through focus for its lifetime while endpoint statuses expire", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetch = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/auth/session")
        ? jsonResponse({ email: "person@example.com" })
        : jsonResponse({ configured: true }),
    );
    vi.stubGlobal("fetch", fetch);
    const sessionReads = () =>
      fetch.mock.calls.filter(([input]) =>
        String(input).includes("/auth/session"),
      ).length;

    await fetchAuthSessionStatus();
    await fetchBuilderStatus();
    now += 5_000;
    window.dispatchEvent(new Event("focus"));
    await fetchAuthSessionStatus();
    await fetchBuilderStatus();

    expect(sessionReads()).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);

    now += SESSION_RESULT_LIFETIME_MS;
    await fetchAuthSessionStatus();
    expect(sessionReads()).toBe(2);
  });

  it("keeps only the short status TTL for a signed-out session answer", async () => {
    let now = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetch = vi.fn(async () =>
      jsonResponse({ error: "Not authenticated" }),
    );
    vi.stubGlobal("fetch", fetch);

    await fetchAuthSessionStatus();
    now += 1_000;
    await fetchAuthSessionStatus();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("expires a session answer without aborting the read already in flight", async () => {
    let respond!: (response: Response) => void;
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          respond = resolve;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetch);

    const first = fetchAuthSessionStatus();
    expireClientStatusResult("/_agent-native/auth/session");
    const second = fetchAuthSessionStatus();
    respond(jsonResponse({ email: "person@example.com" }));

    await expect(first).resolves.toMatchObject({ state: "available" });
    await expect(second).resolves.toMatchObject({ state: "available" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("releases a shared request when the transport hangs so a retry is fresh", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValue(jsonResponse({ configured: true }));
    vi.stubGlobal("fetch", fetch);

    const result = fetchBuilderStatus();
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toEqual({ state: "unavailable" });
    await expect(fetchBuilderStatus()).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
