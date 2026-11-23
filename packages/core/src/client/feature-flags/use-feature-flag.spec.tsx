// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("../use-session.js", () => sessionMocks);

const analyticsMocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("../analytics.js", () => analyticsMocks);

import {
  useFeatureFlag,
  useFeatureFlags,
  useFeatureFlagState,
} from "./use-feature-flag.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("useFeatureFlag / useFeatureFlags session gating", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function mountProbe(Probe: React.FC, queryClient = new QueryClient()) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    return act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
  }

  it("never fires get-feature-flags for a signed-out visitor, and keeps the fail-closed default", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "unauthenticated" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let value: boolean | undefined;
    let values: Record<string, boolean> | undefined;
    function Probe() {
      value = useFeatureFlag("composer");
      values = useFeatureFlags();
      return null;
    }

    await mountProbe(Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(value).toBe(false);
    expect(values).toEqual({});
  });

  it("fires get-feature-flags once the session is authenticated", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ composer: true }));
    vi.stubGlobal("fetch", fetchMock);

    let value: boolean | undefined;
    function Probe() {
      value = useFeatureFlag("composer");
      return null;
    }

    await mountProbe(Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(value).toBe(true);
  });

  it("hides cached values on refresh failure and restores them after recovery", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ composer: true }))
        .mockResolvedValueOnce(new Response("unavailable", { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({ composer: true })),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let flag = false;
    let flags: Record<string, boolean> = {};
    let state = { status: "loading", enabled: false };
    function Probe() {
      flag = useFeatureFlag("composer");
      flags = useFeatureFlags();
      state = useFeatureFlagState("composer");
      return null;
    }
    await mountProbe(Probe, client);
    await vi.waitFor(() => expect(flag).toBe(true));
    expect(flags).toEqual({ composer: true });
    expect(state).toEqual({ status: "ready", enabled: true });

    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["action", "get-feature-flags"],
      });
    });
    await vi.waitFor(() =>
      expect(state).toEqual({ status: "unavailable", enabled: false }),
    );
    expect(flag).toBe(false);
    expect(flags).toEqual({});

    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["action", "get-feature-flags"],
      });
    });
    await vi.waitFor(() =>
      expect(state).toEqual({ status: "ready", enabled: true }),
    );
    expect(flag).toBe(true);
    expect(flags).toEqual({ composer: true });
  });

  it.each(["flag", "flags", "state", "fresh state"])(
    "automatically retries a failed refresh for %s",
    async (kind) => {
      sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ composer: true }))
        .mockResolvedValueOnce(new Response("unavailable", { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({ composer: true }));
      vi.stubGlobal("fetch", fetchMock);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      let value: unknown;
      function FlagProbe() {
        value = useFeatureFlag("composer");
        return null;
      }
      function FlagsProbe() {
        value = useFeatureFlags();
        return null;
      }
      function StateProbe() {
        value = useFeatureFlagState("composer", {
          freshOnMount: kind === "fresh state",
        });
        return null;
      }
      const Probe =
        kind === "flag"
          ? FlagProbe
          : kind === "flags"
            ? FlagsProbe
            : StateProbe;
      const enabled =
        kind === "flag"
          ? true
          : kind === "flags"
            ? { composer: true }
            : { status: "ready", enabled: true };
      const disabled =
        kind === "flag"
          ? false
          : kind === "flags"
            ? {}
            : { status: "unavailable", enabled: false };
      await mountProbe(Probe, client);
      await vi.waitFor(() => expect(value).toEqual(enabled));
      vi.useFakeTimers();
      try {
        await act(async () => {
          await client.invalidateQueries({
            queryKey: ["action", "get-feature-flags"],
          });
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(value).toEqual(disabled);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_001);
        });
        expect(value).toEqual(enabled);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("does not fire while the session is still loading", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "loading" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      useFeatureFlag("composer");
      return null;
    }

    await mountProbe(Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
