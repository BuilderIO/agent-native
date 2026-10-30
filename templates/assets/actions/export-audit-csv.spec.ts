import { beforeEach, describe, expect, it, vi } from "vitest";

const putObjectMock = vi.hoisted(() => vi.fn());
const presignMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  like: vi.fn(),
  sql: Object.assign(vi.fn(), { join: vi.fn() }),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
      }),
    }),
  }),
  schema: {
    assetGenerationRuns: {},
    assetLibraries: {},
    assets: {},
  },
}));
vi.mock("../server/lib/org-admin.js", () => ({
  assertOrgAdmin: async () => ({ orgId: "org_1", ownerEmail: null }),
}));
vi.mock("../server/lib/storage.js", () => ({
  putObject: putObjectMock,
  getPresignedObjectUrl: presignMock,
}));

import action from "./export-audit-csv.js";

describe("export-audit-csv download url", () => {
  beforeEach(() => {
    putObjectMock.mockReset();
    presignMock.mockReset();
    presignMock.mockImplementation(async (key: string) =>
      key.startsWith("https://")
        ? { url: key, expiresAt: "2026-01-01T00:00:00.000Z" }
        : null,
    );
  });

  it("links to the stored file when storage returns its own key", async () => {
    putObjectMock.mockResolvedValue({
      key: "https://cdn.example.test/audit.csv",
      url: "https://cdn.example.test/audit.csv",
    });
    const result = await (action as any).run({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      expiresInSeconds: 1800,
    });
    expect(result.downloadUrl).toBe("https://cdn.example.test/audit.csv");
  });
});
