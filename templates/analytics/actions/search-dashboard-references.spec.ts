import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  search: vi.fn(async () => [
    {
      id: "dashboard-1",
      kind: "sql",
      name: "Customer revenue",
      description: "A saved reference",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      visibility: "org",
      updatedAt: "2026-08-13T00:00:00.000Z",
      matchedFields: ["name"],
    },
  ]),
}));

vi.mock("../server/lib/dashboards-store", () => ({
  searchDashboardReferences: state.search,
}));
vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/analytics"),
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "alice@example.com"),
}));

const { default: action } = await import("./search-dashboard-references.js");

describe("search-dashboard-references action", () => {
  beforeEach(() => state.search.mockClear());

  it("passes the authenticated scope and bounded search to the store", async () => {
    const result = await (action as any).run({ search: "revenue", limit: 4 });

    expect(state.search).toHaveBeenCalledWith(
      { email: "alice@example.com", orgId: "org-1" },
      "revenue",
      4,
    );
    expect(result[0]).toMatchObject({
      id: "dashboard-1",
      matchedFields: ["name"],
    });
  });
});
