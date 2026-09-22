// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("../use-session.js", () => sessionMocks);

const analyticsMocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("../analytics.js", () => analyticsMocks);

import { useFeatureFlag, useFeatureFlags } from "./use-feature-flag.js";

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

  function mountProbe(Probe: React.FC) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient();
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
