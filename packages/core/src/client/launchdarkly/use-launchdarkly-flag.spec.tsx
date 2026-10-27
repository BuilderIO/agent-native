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
  useLaunchDarklyFlag,
  useLaunchDarklyFlags,
} from "./use-launchdarkly-flag.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("useLaunchDarklyFlag / useLaunchDarklyFlags session gating", () => {
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

  it("never fires get-launchdarkly-flags for a signed-out visitor, and keeps the fail-closed default", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "unauthenticated" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let value: boolean | undefined;
    function Probe() {
      value = useLaunchDarklyFlag("new-editor");
      return null;
    }

    await mountProbe(Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(value).toBe(false);
  });

  it("fires get-launchdarkly-flags once authenticated and returns the evaluated value", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ flags: { "new-editor": true } }));
    vi.stubGlobal("fetch", fetchMock);

    let value: boolean | undefined;
    function Probe() {
      value = useLaunchDarklyFlag("new-editor");
      return null;
    }

    await mountProbe(Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(value).toBe(true);
  });

  it("stops returning the prior cached flag after logout", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ flags: { "new-editor": true } })),
    );

    let value: boolean | undefined;
    function Probe() {
      value = useLaunchDarklyFlag("new-editor");
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient();
    const render = () =>
      act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        ),
      );

    await render();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(value).toBe(true);

    sessionMocks.useSession.mockReturnValue({ status: "unauthenticated" });
    await render();

    expect(value).toBe(false);
  });

  it("useLaunchDarklyFlags evaluates several keys in one request", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ flags: { a: true, b: false } })),
    );

    let values: Record<string, boolean> | undefined;
    function Probe() {
      values = useLaunchDarklyFlags(["a", "b"]);
      return null;
    }

    await mountProbe(Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(values).toEqual({ a: true, b: false });
  });
});
