// @vitest-environment happy-dom

import {
  WRITE_FAILURE_EVENT,
  type WriteFailureDetail,
} from "@agent-native/core/client/write-failure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDeleteTask, useReorderTasks } from "./use-tasks";

describe("task write failures", () => {
  const reports: WriteFailureDetail[] = [];
  const onReport = (event: Event) => {
    reports.push((event as CustomEvent<WriteFailureDetail>).detail);
  };
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.addEventListener(WRITE_FAILURE_EVENT, onReport);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    window.removeEventListener(WRITE_FAILURE_EVENT, onReport);
    reports.length = 0;
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  async function mountHooks() {
    const latest: {
      hooks?: {
        reorder: ReturnType<typeof useReorderTasks>;
        remove: ReturnType<typeof useDeleteTask>;
      };
    } = {};
    function Probe() {
      latest.hooks = { reorder: useReorderTasks(), remove: useDeleteTask() };
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    await act(async () =>
      mounted.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    return () => {
      if (!latest.hooks) throw new Error("The hooks did not render");
      return latest.hooks;
    };
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("announces a failed reorder even though the caller rolls back in its own onError", async () => {
    const hooks = await mountHooks();
    const rollback = vi.fn();

    await act(async () =>
      hooks().reorder.mutate(
        { taskIds: ["a", "b"], includeDone: false },
        { onError: rollback },
      ),
    );
    await settle();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
  });

  it("announces a failed delete whose rejection the dialog never catches", async () => {
    const hooks = await mountHooks();

    await act(async () => {
      await hooks()
        .remove.mutateAsync({ taskId: "t1" })
        .catch(() => undefined);
    });
    await settle();

    expect(reports).toHaveLength(1);
  });
});
