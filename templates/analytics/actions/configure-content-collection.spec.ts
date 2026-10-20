import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org_test",
  getRequestUserEmail: () => "admin@example.test",
}));
vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: async () => ({
    userEmail: "admin@example.test",
    orgId: "org_test",
  }),
}));
vi.mock("../server/lib/content-metrics/store.js", () => ({
  readContentCollection: mocks.read,
  writeContentCollection: mocks.write,
}));
vi.mock("../server/lib/content-metrics/status.js", () => ({
  readContentCollectionStatus: mocks.status,
}));

import { contentCollectionConfigSchema } from "../server/lib/content-metrics/config";
import configure from "./configure-content-collection";

describe("configure-content-collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue({
      config: contentCollectionConfigSchema.parse({
        searchConsole: {
          enabled: true,
          sites: [{ siteUrl: "legacy.example.test" }],
        },
      }),
    });
    mocks.status.mockResolvedValue({ configured: true });
  });

  it("disables collection while preserving saved legacy properties", async () => {
    const args = configure.schema!.parse({
      enabled: true,
      searchConsole: false,
    });
    await configure.run(args, {} as any);
    expect(mocks.write).toHaveBeenCalledWith(
      { ownerEmail: "admin@example.test", orgId: "org_test" },
      expect.objectContaining({
        enabled: true,
        config: expect.objectContaining({
          searchConsole: {
            enabled: false,
            sites: [{ siteUrl: "legacy.example.test" }],
          },
        }),
      }),
    );
  });

  it("rejects invalid new drafts before changing saved configuration", () => {
    expect(
      configure.schema!.safeParse({
        enabled: true,
        searchConsoleSites: [{ siteUrl: "example.test" }],
      }).success,
    ).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
