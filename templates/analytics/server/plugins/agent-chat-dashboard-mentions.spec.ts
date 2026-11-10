import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  access: vi.fn(),
  legacy: vi.fn(async (): Promise<{ id: string }[]> => []),
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => ({
    email: "viewer@example.test",
    orgId: "org-one",
  }),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.access,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("../lib/dashboards-store.js", () => ({
  listDashboardSummaries: mocks.list,
}));
vi.mock("../lib/composer-reference-messages.js", () => ({
  composerReferenceMessages: async () => ({
    authentication: "Sign in",
    invalid: "Invalid reference",
    unavailable: "Reference unavailable",
  }),
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "viewer@example.test",
  getRequestOrgId: () => "org-one",
}));
vi.mock("../lib/legacy-dashboard-summaries.js", () => ({
  listLegacyDashboardSummaries: mocks.legacy,
}));
import { ForbiddenError } from "@agent-native/core/sharing";
import type { H3Event } from "h3";

import {
  searchDashboardMentions,
  validateDashboardReferences,
} from "../lib/composer-references.js";
describe("dashboard references", () => {
  it("requests a bounded scoped metadata projection and reports unreadable search distinctly", async () => {
    mocks.list.mockResolvedValue([
      { id: "dashboard-one", name: "Revenue", config: "private SQL" },
    ]);
    expect(await searchDashboardMentions("revenue", {} as H3Event)).toEqual([
      {
        id: "dashboard:dashboard-one",
        label: "Revenue",
        description: "/dashboards/dashboard-one",
        icon: "deck",
        refType: "dashboard",
        refId: "dashboard-one",
        refPath: "/dashboards/dashboard-one",
      },
    ]);
    expect(mocks.list).toHaveBeenCalledWith(
      { email: "viewer@example.test", orgId: "org-one" },
      { hidden: "all", search: "revenue", limit: 20, legacyScan: "strict" },
    );
    mocks.list.mockRejectedValueOnce(new Error("read failed"));
    await expect(
      searchDashboardMentions("revenue", {} as H3Event),
    ).rejects.toThrow("read failed");
  });
  it("revalidates selected dashboard IDs without loading config bodies", async () => {
    mocks.access.mockRejectedValueOnce(new ForbiddenError("revoked"));
    await expect(
      validateDashboardReferences([
        {
          type: "mention",
          refType: "dashboard",
          refId: "dashboard-one",
          name: "Revenue",
          path: "/dashboards/dashboard-one",
          source: "dashboard",
        },
      ]),
    ).rejects.toThrow("Reference unavailable");
    expect(mocks.legacy).toHaveBeenCalledWith(
      { email: "viewer@example.test", orgId: "org-one" },
      { id: "dashboard-one", limit: 1 },
    );
    expect(mocks.access).toHaveBeenCalledWith(
      "dashboard",
      "dashboard-one",
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
  });
  it("accepts scoped legacy only when no native row exists and propagates legacy read errors", async () => {
    const ref = {
      type: "mention" as const,
      refType: "dashboard",
      refId: "legacy",
      name: "Legacy",
      path: "/dashboards/legacy",
      source: "dashboards",
    };
    mocks.legacy.mockResolvedValue([{ id: "legacy" }]);
    await expect(validateDashboardReferences([ref])).resolves.toBeUndefined();
    expect(mocks.legacy).toHaveBeenCalledWith(
      { email: "viewer@example.test", orgId: "org-one" },
      { id: "legacy", limit: 1 },
    );
    mocks.legacy.mockResolvedValueOnce([]);
    mocks.access.mockRejectedValueOnce(new ForbiddenError("not found"));
    await expect(validateDashboardReferences([ref])).rejects.toThrow(
      "Reference unavailable",
    );
    mocks.legacy.mockRejectedValueOnce(new Error("legacy read failed"));
    await expect(validateDashboardReferences([ref])).rejects.toThrow(
      "legacy read failed",
    );
  });
});
