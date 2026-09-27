// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import { useActionQuery } from "./use-action.js";

function actionResponseCount(): number {
  return analyticsMocks.trackEvent.mock.calls.filter(
    (call) => call[0] === "action.response",
  ).length;
}

describe("useActionQuery refetchInterval", () => {
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

  function mountProbe(queryClient: QueryClient, Probe: React.FC) {
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

  it("stops firing action.response once the query settles on a 401, and an invalidate still retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const queryClient = new QueryClient();
    let queryClientRef: QueryClient | undefined;
    function Probe() {
      queryClientRef = useQueryClient();
      useActionQuery("list-labs" as never, undefined, {
        refetchInterval: 20,
      });
      return null;
    }

    await mountProbe(queryClient, Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(actionResponseCount()).toBe(1);

    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(actionResponseCount()).toBe(1);

    await act(async () => {
      await queryClientRef!.invalidateQueries({ queryKey: ["action"] });
    });
    expect(actionResponseCount()).toBe(2);
  });

  it("keeps polling on the caller's interval for a non-auth failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const queryClient = new QueryClient();
    function Probe() {
      useActionQuery("list-labs" as never, undefined, {
        refetchInterval: 20,
      });
      return null;
    }

    await mountProbe(queryClient, Probe);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));

    expect(actionResponseCount()).toBeGreaterThan(1);
  });
});
