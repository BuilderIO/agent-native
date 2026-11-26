// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useThemeFamily } from "./theme-family.js";
import { useActionMutation } from "./use-action.js";

describe("theme family read and unscoped writes", () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    roots.length = 0;
    vi.unstubAllGlobals();
  });

  it("does not cancel an in-flight get-theme-family refetch when writes declare no resources", async () => {
    const themeSignals: AbortSignal[] = [];
    const releaseTheme: Array<() => void> = [];
    let themeReads = 0;
    const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      if (init?.method === "POST") return json({ ok: true });
      if (String(input).includes("/actions/get-theme-family")) {
        if (themeReads++ === 0)
          return json({ family: "original", source: "default", appId: null });
        if (init?.signal) themeSignals.push(init.signal);
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          releaseTheme.push(() =>
            resolve(
              json({ family: "original", source: "default", appId: null }),
            ),
          );
        });
      }
      return json({ ok: true });
    });
    vi.stubGlobal("fetch", fetch);

    let write: () => Promise<unknown> = () =>
      Promise.reject(new Error("probe not rendered"));
    function Probe() {
      useThemeFamily();
      const mutation = useActionMutation("save-table-view");
      write = () => mutation.mutateAsync({ id: "t1" });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
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
    await vi.waitFor(() => expect(themeReads).toBe(1));
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

    await act(async () => {
      await write();
    });
    await act(async () => {
      await write();
    });

    expect(themeSignals.map((signal) => signal.aborted)).not.toContain(true);
    await act(async () => {
      for (const release of releaseTheme) release();
    });
  });
});
