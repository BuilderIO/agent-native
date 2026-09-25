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

  async function probe(): Promise<FeatureFlagState[]> {
    const states: FeatureFlagState[] = [];
    function Probe() {
      states.push(useFeatureFlagState("settings-redesign"));
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
      vi.fn().mockResolvedValue(jsonResponse({ "settings-redesign": true })),
    );
    const states = await probe();
    expect(states[0]).toEqual({ status: "loading", enabled: false });
    expect(states.at(-1)).toEqual({ status: "ready", enabled: true });
  });

  it("reports a registered flag that evaluated off as ready", async () => {
    sessionMocks.useSession.mockReturnValue({ status: "authenticated" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ "settings-redesign": false })),
    );
    const states = await probe();
    expect(states.at(-1)).toEqual({ status: "ready", enabled: false });
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
