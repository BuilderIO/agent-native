import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  openDashboard: vi.fn(),
  loadBuiltinDashboard: vi.fn(),
  where: vi.fn(
    async () =>
      [] as Array<{
        id: string;
        updatedAt: string;
        hiddenBy: string | null;
        accessible?: boolean;
        orgId?: string | null;
      }>,
  ),
  select: vi.fn(),
  accessFilter: vi.fn(),
  isOrgMember: vi.fn(async (_orgId: string, _email: string) => false),
  values: vi.fn(async () => undefined),
  putPrivateBlob: vi.fn(async (_input: unknown) => ({
    key: "private-test-handle",
  })),
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "probe@example.test",
  getRequestOrgId: () => "org-test",
}));
vi.mock("@agent-native/core/org", () => ({ isOrgMember: mocks.isOrgMember }));
vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: mocks.putPrivateBlob,
}));
vi.mock("../db/index.js", async () => ({
  getDb: () => ({
    insert: () => ({ values: mocks.values }),
    select: mocks.select,
  }),
  schema: await import("../db/schema.js"),
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
}));
vi.mock("./builtin-dashboards.js", () => ({
  loadBuiltinDashboard: mocks.loadBuiltinDashboard,
}));
vi.mock("./open-dashboard.js", () => ({ openDashboard: mocks.openDashboard }));

import { nativeDashboardCreativeContextAdapter as adapter } from "./native-creative-context";

const builtin = {
  id: "builtin-risk-meeting",
  title: "Risk Meeting",
  version: "builtin-definition-v2",
  config: {
    name: "Risk Meeting",
    panels: [{ id: "current-panel", title: "Current cohort" }],
  },
};

describe("native dashboard creative context builtin reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openDashboard.mockReset().mockResolvedValue({ builtin });
    mocks.loadBuiltinDashboard.mockResolvedValue(builtin);
    mocks.where.mockResolvedValue([]);
    mocks.isOrgMember.mockResolvedValue(false);
    mocks.select.mockImplementation(() => ({
      from: () => ({ where: mocks.where }),
    }));
  });

  it("lists the opened builtin definition version", async () => {
    expect(await adapter.listResourceVersions!([builtin.id])).toEqual([
      { resourceId: builtin.id, sourceModifiedAt: builtin.version },
    ]);
    expect(mocks.loadBuiltinDashboard).toHaveBeenCalledWith(builtin.id, {
      email: "probe@example.test",
      orgId: "org-test",
    });
  });

  it("batches saved versions and resolves only distinct remaining builtin definitions", async () => {
    const savedIds = Array.from(
      { length: 100 },
      (_, index) => `saved-${index}`,
    );
    mocks.where.mockResolvedValue([
      ...savedIds.map((id) => ({
        id,
        updatedAt: "saved-version",
        hiddenBy: null,
        accessible: true,
        orgId: null,
      })),
      {
        id: "risk-meeting",
        updatedAt: "old-version",
        hiddenBy: "analytics:builtin-dashboards",
        accessible: true,
        orgId: null,
      },
      {
        id: "google-analytics",
        updatedAt: "edited-seed-version",
        hiddenBy: null,
        accessible: true,
        orgId: null,
      },
    ]);
    const versions = await adapter.listResourceVersions!([
      ...savedIds,
      "risk-meeting",
      builtin.id,
      "google-analytics",
      ...Array.from({ length: 100 }, (_, index) => `missing-${index}`),
    ]);
    expect(versions).toEqual([
      ...savedIds.map((resourceId) => ({
        resourceId,
        sourceModifiedAt: "saved-version",
      })),
      { resourceId: "risk-meeting", sourceModifiedAt: builtin.version },
      { resourceId: builtin.id, sourceModifiedAt: builtin.version },
      {
        resourceId: "google-analytics",
        sourceModifiedAt: "edited-seed-version",
      },
    ]);
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.accessFilter).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        userEmail: "probe@example.test",
        orgId: "org-test",
      },
      "viewer",
      { includePublic: true },
    );
    expect(mocks.loadBuiltinDashboard).toHaveBeenCalledOnce();
    expect(mocks.openDashboard).toHaveBeenCalledTimes(100);
  });

  it("keeps unresolved legacy custom versions with bounded scoped reads", async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `legacy-${i}`);
    let active = 0;
    let peak = 0;
    mocks.openDashboard.mockImplementation(async (id) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return id === "missing"
        ? null
        : { saved: { updatedAt: `${id}-version` } };
    });
    expect(
      await adapter.listResourceVersions!([...ids, ids[0], "missing"]),
    ).toEqual(
      [...ids, ids[0]].map((resourceId) => ({
        resourceId,
        sourceModifiedAt: `${resourceId}-version`,
      })),
    );
    expect(mocks.openDashboard).toHaveBeenCalledTimes(14);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
    for (const id of [...ids, "missing"]) {
      expect(mocks.openDashboard).toHaveBeenCalledWith(id, {
        email: "probe@example.test",
        orgId: "org-test",
      });
    }
  });

  it("propagates a failed legacy dashboard read", async () => {
    mocks.openDashboard.mockRejectedValueOnce(
      new Error("legacy settings unavailable"),
    );
    await expect(
      adapter.listResourceVersions!(["legacy-custom"]),
    ).rejects.toThrow("legacy settings unavailable");
  });

  it("checks distinct memberships concurrently within a fixed bound", async () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      id: `org-dashboard-${i}`,
      updatedAt: `version-${i}`,
      hiddenBy: null,
      accessible: false,
      orgId: `org-${i}`,
    }));
    mocks.where.mockResolvedValue([...rows, { ...rows[0], id: "same-org" }]);
    let active = 0;
    let peak = 0;
    mocks.isOrgMember.mockImplementation(async (orgId) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return orgId !== "org-12";
    });
    mocks.openDashboard.mockResolvedValue(null);
    expect(
      await adapter.listResourceVersions!([
        ...rows.map((row) => row.id),
        "same-org",
      ]),
    ).toEqual([
      ...rows.slice(0, 12).map((row) => ({
        resourceId: row.id,
        sourceModifiedAt: row.updatedAt,
      })),
      { resourceId: "same-org", sourceModifiedAt: "version-0" },
    ]);
    expect(mocks.isOrgMember).toHaveBeenCalledTimes(13);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
    for (const row of rows)
      expect(mocks.isOrgMember).toHaveBeenCalledWith(
        row.orgId,
        "probe@example.test",
      );
  });

  it("propagates membership failures instead of returning partial versions", async () => {
    mocks.where.mockResolvedValue([
      {
        id: "foreign-dashboard",
        updatedAt: "version",
        hiddenBy: null,
        accessible: false,
        orgId: "foreign-org",
      },
    ]);
    mocks.isOrgMember.mockRejectedValueOnce(
      new Error("membership unavailable"),
    );
    await expect(
      adapter.listResourceVersions!(["foreign-dashboard"]),
    ).rejects.toThrow("membership unavailable");
    expect(mocks.openDashboard).not.toHaveBeenCalled();
  });

  it("keeps public saved versions, including edits at a builtin seed id", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE TABLE dashboards (
          id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, hidden_by TEXT,
          owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL
        );
        CREATE TABLE org_members (
          org_id TEXT NOT NULL, email TEXT NOT NULL, federation_removal_pending_at TEXT
        );
        CREATE TABLE dashboard_shares (
          resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
          principal_id TEXT NOT NULL, role TEXT NOT NULL
        );
        INSERT INTO dashboards VALUES
          ('public-custom', 'public-custom-version', NULL, 'other@example.test', 'other-org', 'public'),
          ('google-analytics', 'public-seed-edit-version', NULL, 'other@example.test', 'other-org', 'public'),
          ('private-custom', 'private-version', NULL, 'other@example.test', 'other-org', 'private');
      `);
      const { accessFilter } = await vi.importActual<
        typeof import("@agent-native/core/sharing")
      >("@agent-native/core/sharing");
      mocks.accessFilter.mockImplementationOnce(accessFilter);
      const db = drizzle(client);
      mocks.select.mockImplementationOnce(db.select.bind(db));
      expect(
        await adapter.listResourceVersions!([
          "public-custom",
          "google-analytics",
          "private-custom",
        ]),
      ).toEqual([
        {
          resourceId: "public-custom",
          sourceModifiedAt: "public-custom-version",
        },
        {
          resourceId: "google-analytics",
          sourceModifiedAt: "public-seed-edit-version",
        },
      ]);
      expect(mocks.accessFilter).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { userEmail: "probe@example.test", orgId: "org-test" },
        "viewer",
        { includePublic: true },
      );
      expect(mocks.loadBuiltinDashboard).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("keeps org-visible versions from other memberships without granting unrelated orgs", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE TABLE dashboards (
          id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, hidden_by TEXT,
          owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL
        );
        CREATE TABLE dashboard_shares (
          resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
          principal_id TEXT NOT NULL, role TEXT NOT NULL
        );
        CREATE TABLE org_members (
          org_id TEXT NOT NULL, email TEXT NOT NULL, federation_removal_pending_at TEXT
        );
        INSERT INTO org_members VALUES
          ('member-org', 'probe@example.test', NULL),
          ('revoked-org', 'probe@example.test', NULL);
        INSERT INTO dashboards VALUES
          ('member-a', 'member-a-version', NULL, 'other@example.test', 'member-org', 'org'),
          ('member-b', 'member-b-version', NULL, 'other@example.test', 'member-org', 'org'),
          ('google-analytics', 'member-seed-version', NULL, 'other@example.test', 'member-org', 'org'),
          ('revoked', 'revoked-version', NULL, 'other@example.test', 'revoked-org', 'org'),
          ('unrelated', 'unrelated-version', NULL, 'other@example.test', 'unrelated-org', 'org');
      `);
      const { accessFilter } = await vi.importActual<
        typeof import("@agent-native/core/sharing")
      >("@agent-native/core/sharing");
      mocks.accessFilter.mockImplementationOnce(accessFilter);
      const db = drizzle(client);
      mocks.select.mockImplementationOnce(db.select.bind(db));
      mocks.isOrgMember.mockImplementation(
        async (orgId: string) => orgId === "member-org",
      );
      expect(
        await adapter.listResourceVersions!([
          "member-a",
          "member-b",
          "google-analytics",
          "revoked",
          "unrelated",
        ]),
      ).toEqual([
        { resourceId: "member-a", sourceModifiedAt: "member-a-version" },
        { resourceId: "member-b", sourceModifiedAt: "member-b-version" },
        {
          resourceId: "google-analytics",
          sourceModifiedAt: "member-seed-version",
        },
      ]);
      expect(mocks.select).toHaveBeenCalledOnce();
      expect(mocks.isOrgMember.mock.calls).toEqual([
        ["member-org", "probe@example.test"],
        ["revoked-org", "probe@example.test"],
      ]);
      expect(mocks.loadBuiltinDashboard).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("does not turn a failed version query into an empty result", async () => {
    mocks.where.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      adapter.listResourceVersions!(["saved-dashboard"]),
    ).rejects.toThrow("database unavailable");
    expect(mocks.loadBuiltinDashboard).not.toHaveBeenCalled();
  });

  it("captures the builtin config with caller-owned snapshot storage", async () => {
    const result = await adapter.capture({
      appId: "analytics",
      resourceType: "dashboard",
      resourceId: builtin.id,
      expectedUpdatedAt: builtin.version,
    });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: builtin.id,
        config: JSON.stringify(builtin.config),
        ownerEmail: "probe@example.test",
        orgId: "org-test",
      }),
    );
    const blob = mocks.putPrivateBlob.mock.calls[0]?.[0] as any;
    expect(JSON.parse(blob.data.toString("utf8"))).toMatchObject({
      id: builtin.id,
      config: builtin.config,
      updatedAt: builtin.version,
    });
    expect(result.items[0]).toMatchObject({
      title: "Risk Meeting",
      sourceModifiedAt: builtin.version,
    });
  });

  it("rejects unavailable or changed builtins before writing snapshots", async () => {
    mocks.openDashboard.mockResolvedValueOnce(null);
    await expect(
      adapter.capture({
        appId: "analytics",
        resourceType: "dashboard",
        resourceId: builtin.id,
      }),
    ).rejects.toThrow("Dashboard not found");
    await expect(
      adapter.capture({
        appId: "analytics",
        resourceType: "dashboard",
        resourceId: builtin.id,
        expectedUpdatedAt: "old-definition",
      }),
    ).rejects.toThrow("Dashboard changed");
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });
});
