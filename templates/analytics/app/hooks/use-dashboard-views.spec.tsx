// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ email: "viewer@example.com" }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  useSession: () => ({ session }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { dashboardCacheScope } from "@/lib/prefetch-keys";
import { serverReadState } from "@/pages/adhoc/sql-dashboard/dashboard-filter-restore";

import { useDashboardViews } from "./use-dashboard-views";

describe("useDashboardViews", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    callAction.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps filter restore waiting while cached views refetch", async () => {
    let resolveViews: (value: unknown) => void = () => {};
    callAction.mockReturnValue(
      new Promise((resolve) => {
        resolveViews = resolve;
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      ["dashboard-views", "v3", dashboardCacheScope(session)],
      [{ id: "q3", name: "Q3", filters: {} }],
      { updatedAt: Date.now() - 60_000 },
    );

    function Probe() {
      const views = useDashboardViews("v3");
      return (
        <div>
          {serverReadState(views)}:
          {views.views.map((view) => view.id).join(",")}
        </div>
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).toBe("loading:q3");

    await act(async () => {
      resolveViews({ views: [] });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe("success:");
  });

  it("opts a failed view delete in to the shared write-failure toast", async () => {
    callAction.mockImplementation(async (name: string) => {
      if (name === "delete-dashboard-view") throw new Error("boom");
      return { views: [] };
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const surfaced: unknown[] = [];
    queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        surfaced.push(event.mutation.meta);
      }
    });
    let deleteView: ReturnType<
      typeof useDashboardViews
    >["deleteView"] = async () => {};

    function Probe() {
      deleteView = useDashboardViews("v3").deleteView;
      return null;
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await expect(deleteView("q3")).rejects.toThrow("boom");
    });
    expect(surfaced).toEqual([{ surfaceError: true }]);
  });
});
