// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("../use-session.js", () => sessionMocks);

const analyticsMocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("../analytics.js", () => analyticsMocks);

import { setAgentNativeApiDisabled } from "../api-surface.js";
import {
  useFeatureFlagState,
  type FeatureFlagState,
} from "./use-feature-flag.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useFeatureFlagState", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    setAgentNativeApiDisabled(null);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function probe(key = "example-flag"): Promise<FeatureFlagState[]> {
    const states: FeatureFlagState[] = [];
    function Probe() {
      states.push(useFeatureFlagState(key));
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    return states;
  }

  it("answers on for a retired flag, so older generated apps take its shipped path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    for (const status of ["loading", "unauthenticated", "authenticated"]) {
      sessionMocks.useSession.mockReturnValue({ status });
      const states = await probe("settings-redesign");
      expect(states.every((state) => state.status === "ready")).toBe(true);
      expect(states.at(-1)).toEqual({ status: "ready", enabled: true });
    }
  });

  it("reports loading while the session resolves", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "loading" });
    vi.stubGlobal("fetch", vi.fn());
    const states = await probe();
    expect(states.at(-1)).toEqual({ status: "loading", enabled: false });
  });

  it("reports loading, then the evaluated value", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ "example-flag": true })),
    );
    const states = await probe();
    expect(states[0]).toEqual({ status: "loading", enabled: false });
    expect(states.at(-1)).toEqual({ status: "ready", enabled: true });
  });

  it("reports a registered flag that evaluated off as ready", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ "example-flag": false })),
    );
    const states = await probe();
    expect(states.at(-1)).toEqual({ status: "ready", enabled: false });
  });

  it.each([
    { cached: false, fresh: true, status: 200 },
    { cached: true, fresh: false, status: 200 },
    { cached: true, fresh: false, status: 500 },
  ])(
    "revalidates cached $cached before using status $status",
    async ({ cached, fresh, status }) => {
      sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
      let respond: (response: Response) => void = () => {};
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              respond = resolve;
            }),
        ),
      );
      const states: FeatureFlagState[] = [];
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
      });
      client.setQueryData(
        [
          "action",
          "get-feature-flags",
          undefined,
          "fresh-on-mount",
          JSON.stringify([null, null, "example-flag"]),
        ],
        { "example-flag": cached },
      );
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
      });
      function Probe() {
        states.push(
          useFeatureFlagState("example-flag", { freshOnMount: true }),
        );
        return null;
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>,
        ),
      );
      expect(states.at(-1)).toEqual({ status: "loading", enabled: false });
      await act(async () => {
        respond(jsonResponse({ "example-flag": fresh }, status));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(states.at(-1)).toEqual(
        status === 200
          ? { status: "ready", enabled: fresh }
          : { status: "unavailable", enabled: false },
      );
    },
  );

  it.each([500, 403])(
    "reports status %s on a later refresh instead of a stale value",
    async (failureStatus) => {
      sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(jsonResponse({ "example-flag": true }))
          .mockResolvedValueOnce(
            jsonResponse({ error: "unavailable" }, failureStatus),
          ),
      );
      const states: FeatureFlagState[] = [];
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
      });
      function Probe() {
        states.push(
          useFeatureFlagState("example-flag", { freshOnMount: true }),
        );
        return null;
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>,
        ),
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(states.at(-1)).toEqual({ status: "ready", enabled: true });
      await act(async () => {
        await client.invalidateQueries({
          queryKey: ["action", "get-feature-flags"],
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(states.at(-1)).toEqual({ status: "unavailable", enabled: false });
    },
  );

  it("does not reuse a verified flag for a different viewer", async () => {
    sessionMocks.useSession.mockReturnValue({
      status: "authenticated",
      session: { userId: "viewer-a" },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ "example-flag": true }))
        .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 500)),
    );
    const states: FeatureFlagState[] = [];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    function Probe() {
      states.push(useFeatureFlagState("example-flag", { freshOnMount: true }));
      return null;
    }
    const render = () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    await act(async () => render());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(states.at(-1)).toEqual({ status: "ready", enabled: true });
    sessionMocks.useSession.mockReturnValue({
      status: "authenticated",
      session: { userId: "viewer-b" },
    });
    await act(async () => render());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(states.at(-1)).toEqual({ status: "unavailable", enabled: false });
  });

  it("does not restore a flag after access is denied", async () => {
    sessionMocks.useSession.mockReturnValue({
      status: "authenticated",
      session: { userId: "viewer-a" },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ "example-flag": true }))
        .mockResolvedValueOnce(jsonResponse({ error: "denied" }, 403))
        .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 500)),
    );
    const states: FeatureFlagState[] = [];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    function Probe() {
      states.push(useFeatureFlagState("example-flag", { freshOnMount: true }));
      return null;
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(states.at(-1)).toEqual({ status: "ready", enabled: true });
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await client.invalidateQueries({
          queryKey: ["action", "get-feature-flags"],
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(states.at(-1)).toEqual({ status: "unavailable", enabled: false });
    }
  });

  it("tells an unreadable answer apart from off", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500)),
    );
    const states = await probe();
    expect(states.at(-1)).toEqual({ status: "unavailable", enabled: false });
  });

  it("never waits for a signed-out viewer or a disabled API surface", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sessionMocks.useSession.mockReturnValue({ status: "unauthenticated" });
    expect((await probe()).at(-1)).toEqual({
      status: "unavailable",
      enabled: false,
    });

    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    setAgentNativeApiDisabled("framed canvas");
    expect((await probe()).at(-1)).toEqual({
      status: "unavailable",
      enabled: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
