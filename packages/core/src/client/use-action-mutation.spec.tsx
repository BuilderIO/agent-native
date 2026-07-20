// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useActionMutation } from "./use-action.js";

describe("useActionMutation", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.unstubAllGlobals();
  });

  it("keeps mutateAsync pending until an async success callback finishes", async () => {
    let finishSuccess: (() => void) | undefined;
    const successFinished = new Promise<void>((resolve) => {
      finishSuccess = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    let mutation:
      | ReturnType<typeof useActionMutation<Record<string, boolean>>>
      | undefined;
    function Probe() {
      mutation = useActionMutation<Record<string, boolean>>("save-record", {
        onSuccess: () => successFinished,
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );

    let settled = false;
    const result = mutation!.mutateAsync({}).then((value) => {
      settled = true;
      return value;
    });
    await act(async () => Promise.resolve());
    expect(settled).toBe(false);

    finishSuccess?.();
    await expect(result).resolves.toEqual({ ok: true });
    expect(settled).toBe(true);
  });
});
