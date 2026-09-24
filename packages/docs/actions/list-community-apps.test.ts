import { describe, expect, it, vi } from "vitest";

const loadCommunityAppCatalog = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/community-apps.server", () => ({
  loadCommunityAppCatalog,
}));

const { default: listCommunityApps } = await import("./list-community-apps");

describe("list-community-apps", () => {
  it("exposes the published catalog as a public read-only query", async () => {
    const catalog = { apps: [], source: "seed" as const };
    loadCommunityAppCatalog.mockResolvedValue(catalog);

    await expect(listCommunityApps.run({})).resolves.toBe(catalog);
    expect(listCommunityApps).toMatchObject({
      http: { method: "GET" },
      requiresAuth: false,
      readOnly: true,
    });
  });
});
