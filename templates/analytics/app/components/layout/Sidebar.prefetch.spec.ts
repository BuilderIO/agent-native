// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/chat/ownership-history", () => ({
  useOwnershipChatHistory: vi.fn(),
  OwnershipChatHistoryRail: () => null,
  ownDraftRows: () => [],
}));

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction,
}));

import { sqlDashboardPrefetchKey } from "@/lib/prefetch-keys";
import { fetchDashboard } from "@/pages/adhoc/sql-dashboard/fetch-dashboard";

import { prefetchSqlDashboard } from "./Sidebar";

describe("sidebar dashboard prefetch", () => {
  it("seeds the dashboard page with everything the page's own fetch loads", async () => {
    callAction.mockResolvedValue({
      name: "Launch week",
      panels: [],
      annotations: { hiddenKeyDateSets: ["launches"] },
      catalog: { templateId: "growth" },
      orgId: "org-1",
      visibility: "org",
      updatedAt: "2026-10-14T00:00:00.000Z",
    });
    const queryClient = new QueryClient();

    await prefetchSqlDashboard(queryClient, "dash-1", "alice:org-1", 3);

    const snapshot = queryClient.getQueryData(
      sqlDashboardPrefetchKey("dash-1", "alice:org-1"),
    );
    expect(snapshot).toMatchObject({
      data: { config: { annotations: { hiddenKeyDateSets: ["launches"] } } },
    });
    expect(snapshot).toEqual({
      data: await fetchDashboard("dash-1"),
      syncVersion: 3,
    });
  });
});
