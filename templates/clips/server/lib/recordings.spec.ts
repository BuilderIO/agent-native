import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getUserSetting: vi.fn(),
  getRequestUserEmail: vi.fn(),
  implicitServiceOrgRole: vi.fn(),
  readAppState: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
}));

const tables = vi.hoisted(() => ({
  recordingViewers: {
    recordingId: "recording_viewers.recording_id",
    countedView: "recording_viewers.counted_view",
  },
  recordingViews: {
    recordingId: "recording_views.recording_id",
  },
  organizationSettings: {
    organizationId: "organization_settings.workspace_id",
    defaultVisibility: "organization_settings.default_visibility",
  },
  workspaces: {
    id: "workspaces.id",
    createdAt: "workspaces.created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  count: () => ({ type: "count" }),
  desc: (column: unknown) => ({ type: "desc", column }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("h3", () => ({
  HTTPError: class extends Error {
    statusCode?: number;
    statusMessage?: string;
    constructor(init: { statusCode?: number; statusMessage?: string } = {}) {
      super(init.statusMessage);
      this.statusCode = init.statusCode;
      this.statusMessage = init.statusMessage;
    }
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
}));

vi.mock("@agent-native/core/org", () => ({
  implicitServiceOrgRole: (...args: unknown[]) =>
    mocks.implicitServiceOrgRole(...args),
  organizations: { id: "organizations.id" },
  orgMembers: { orgId: "org_members.org_id", email: "org_members.email" },
  resolveOrgIdForEmail: (...args: unknown[]) =>
    mocks.resolveOrgIdForEmail(...args),
}));

vi.mock("@agent-native/core/server", () => ({ getSession: vi.fn() }));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: (...args: unknown[]) => mocks.getUserSetting(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: (...args: unknown[]) =>
    mocks.getRequestUserEmail(...args),
  getRequestOrgId: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: tables,
}));

import {
  countedViewCondition,
  countRecordingViews,
  getActiveOrganizationId,
  getDefaultRecordingVisibility,
  requireActiveOrganizationId,
} from "./recordings.js";

/**
 * Two counts come back per call — one per table — so the fake resolves each
 * `.where()` against the table the builder was pointed at.
 */
function createDb(rowsByTable: { viewers?: unknown[]; views?: unknown[] }) {
  const calls: {
    tables: unknown[];
    wheres: unknown[];
  } = { tables: [], wheres: [] };
  const db = {
    select() {
      let table: unknown;
      const builder = {
        from(next: unknown) {
          table = next;
          calls.tables.push(next);
          return builder;
        },
        where(condition: unknown) {
          calls.wheres.push(condition);
          return Promise.resolve(
            table === tables.recordingViews
              ? (rowsByTable.views ?? [])
              : (rowsByTable.viewers ?? []),
          );
        },
      };
      return builder;
    },
  };
  return { db, calls };
}

describe("countRecordingViews", () => {
  it("counts one view per logged view session, not per viewer", async () => {
    const { db, calls } = createDb({
      viewers: [{ value: 7 }],
      views: [{ value: 19 }],
    });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(19);

    expect(calls.tables).toEqual([
      tables.recordingViewers,
      tables.recordingViews,
    ]);
    expect(calls.wheres[0]).toEqual({
      type: "and",
      conditions: [
        {
          type: "eq",
          left: tables.recordingViewers.recordingId,
          right: "rec-1",
        },
        countedViewCondition(),
      ],
    });
    expect(calls.wheres[1]).toEqual({
      type: "eq",
      left: tables.recordingViews.recordingId,
      right: "rec-1",
    });
  });

  it("falls back to the counted-viewer count for pre-migration clips", async () => {
    const { db } = createDb({ viewers: [{ value: 7 }], views: [{ value: 0 }] });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(7);
  });

  it("never reports fewer views than counted viewers", async () => {
    const { db } = createDb({
      viewers: [{ value: 11 }],
      views: [{ value: 4 }],
    });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(11);
  });

  it("returns 0 when no viewer or view rows exist", async () => {
    const { db } = createDb({});
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(0);
  });

  it("normalizes driver-provided string counts", async () => {
    const { db } = createDb({
      viewers: [{ value: "12" }],
      views: [{ value: "3" }],
    });
    mocks.getDb.mockReturnValue(db);

    await expect(countRecordingViews("rec-1")).resolves.toBe(12);
  });
});

describe("getDefaultRecordingVisibility", () => {
  beforeEach(() => {
    mocks.getDb.mockClear();
  });

  it("prefers the personal default over the organization default", async () => {
    mocks.getRequestUserEmail.mockReturnValue("Owner@Example.test");
    mocks.getUserSetting.mockResolvedValue({
      defaultRecordingVisibility: "private",
    });

    await expect(getDefaultRecordingVisibility("org-1")).resolves.toBe(
      "private",
    );
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      "clips-user-prefs",
    );
  });

  it("falls back to the organization default when no preference is set", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.getUserSetting.mockResolvedValue({});
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ defaultVisibility: "org" }],
          }),
        }),
      }),
    });

    await expect(getDefaultRecordingVisibility("org-1")).resolves.toBe("org");
  });

  it("uses public when neither personal nor organization defaults exist", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getUserSetting.mockResolvedValue(null);
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    });

    await expect(getDefaultRecordingVisibility("org-1")).resolves.toBe(
      "public",
    );
  });

  it("honors an explicit personal public preference", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getUserSetting.mockResolvedValue({
      defaultRecordingVisibility: "public",
    });

    await expect(getDefaultRecordingVisibility("org-1")).resolves.toBe(
      "public",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("accepts the authenticated action owner when request context is empty", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);
    mocks.getUserSetting.mockResolvedValue({
      defaultRecordingVisibility: "private",
    });

    await expect(
      getDefaultRecordingVisibility("org-1", "Owner@Example.test"),
    ).resolves.toBe("private");
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      "clips-user-prefs",
    );
  });
});

describe("requireActiveOrganizationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a first-time caller with no org as 409, not a generic 500", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);
    mocks.getDb.mockReturnValue(undefined);

    await expect(requireActiveOrganizationId()).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

/**
 * Both legacy sources outlive the organization they name and neither is scoped
 * to a caller, so each id they hand back has to be vetted before it becomes an
 * active org id. `select` is called once per lookup, in order.
 */
function stubSelects(...results: unknown[][]) {
  const calls: unknown[] = [];
  mocks.getDb.mockReturnValue({
    select: (columns: unknown) => {
      calls.push(columns);
      const result = results.shift() ?? [];
      const builder = {
        from: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => Promise.resolve(result),
      };
      return builder;
    },
  });
  return calls;
}

describe("getActiveOrganizationId legacy fallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.implicitServiceOrgRole.mockReturnValue(null);
    mocks.readAppState.mockResolvedValue(null);
    mocks.getUserSetting.mockResolvedValue(null);
    // The legacy sources are only consulted when the framework resolver could
    // not answer at all; a definite answer ends the search before them.
    mocks.resolveOrgIdForEmail.mockRejectedValue(new Error("unavailable"));
  });

  it("honors a definite no-org answer instead of reviving a legacy workspace", async () => {
    // `resolveOrgIdForEmail` returns null both for no membership and for an
    // explicit Personal selection. Either way it has answered, and the
    // caller-unscoped legacy sources must not reactivate org scope.
    mocks.getRequestUserEmail.mockReturnValue("personal@example.test");
    mocks.resolveOrgIdForEmail.mockResolvedValue(null);
    mocks.readAppState.mockResolvedValue({ id: "org_legacy" });
    const calls = stubSelects([{ id: "org_legacy" }]);

    await expect(getActiveOrganizationId()).resolves.toBeNull();
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("ignores a `current-workspace` key naming a deleted organization", async () => {
    // Deleting an org clears org_members but not this app-state key, so an
    // unvetted id here resurrects the deleted org as a 403 on every read.
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.readAppState.mockResolvedValue({ id: "org_deleted" });
    // organizations lookup (gone), then the deprecated workspaces lookup.
    stubSelects([], []);

    await expect(getActiveOrganizationId()).resolves.toBeNull();
  });

  it("ignores a surviving workspace the caller is not a member of", async () => {
    // The workspaces lookup takes the globally newest row, which can belong to
    // another user entirely. Personal scope is the correct answer, not 403.
    mocks.getRequestUserEmail.mockReturnValue("nomember@example.test");
    stubSelects([{ id: "org_someone_else" }], [{ id: "org_someone_else" }], []);

    await expect(getActiveOrganizationId()).resolves.toBeNull();
  });

  it("still resolves a legacy workspace the caller belongs to", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    stubSelects(
      [{ id: "org_legacy" }],
      [{ id: "org_legacy" }],
      [{ role: "admin" }],
    );

    await expect(getActiveOrganizationId()).resolves.toBe("org_legacy");
  });

  it("accepts an existing legacy workspace when there is no caller identity", async () => {
    // CLI and solo dev have no email to scope by, so an existing org is the
    // best available answer rather than a silent downgrade to personal scope.
    mocks.getRequestUserEmail.mockReturnValue(null);
    stubSelects([{ id: "org_solo" }], [{ id: "org_solo" }]);

    await expect(getActiveOrganizationId()).resolves.toBe("org_solo");
  });
});
