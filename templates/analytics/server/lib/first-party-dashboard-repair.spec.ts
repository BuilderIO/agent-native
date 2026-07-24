import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  recordChange: vi.fn(),
}));

const revisionUuid = "new-revision";

const schema = vi.hoisted(() => ({
  dashboards: {
    id: { name: "id" },
    kind: { name: "kind" },
    config: { name: "config" },
    title: { name: "title" },
    updatedAt: { name: "updatedAt" },
    updatedBy: { name: "updatedBy" },
    ownerEmail: { name: "ownerEmail" },
    orgId: { name: "orgId" },
    visibility: { name: "visibility" },
  },
  dashboardRevisions: {
    id: { name: "id" },
    dashboardId: { name: "dashboardId" },
    createdAt: { name: "createdAt" },
  },
}));

vi.mock("@agent-native/core/server", () => ({
  recordChange: dbMocks.recordChange,
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => revisionUuid,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (column: { name: string }) => ({ type: "desc", column: column.name }),
  eq: (column: { name: string }, value: unknown) => ({
    type: "eq",
    column: column.name,
    value,
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: dbMocks.getDb,
  schema,
}));

import { LEGACY_NEW_VS_RECURRING_USERS_SQL } from "./canonical-first-party-dashboard-repair";
import { repairPersistedFirstPartyDashboardQueries } from "./first-party-dashboard-repair";
import {
  FIRST_PARTY_DASHBOARD_ID,
  INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL,
  LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
  LEGACY_SEED_SIGNUPS_OVER_TIME_SQL,
  LEGACY_SIGNUPS_OVER_TIME_SQL,
  buildPanel,
} from "./first-party-metric-catalog";

function requiredFirstPartyPanel(
  id: string,
): NonNullable<ReturnType<typeof buildPanel>> {
  const panel = buildPanel(id);
  if (!panel) throw new Error(`Expected first-party metric "${id}" to exist`);
  return panel;
}

type DashboardRow = {
  id: string;
  kind: string;
  config: string;
  title: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
};

function createDb(
  row: DashboardRow | null,
  updated: unknown[] = [{ id: FIRST_PARTY_DASHBOARD_ID }],
  revisions: Array<{ id: string }> = [],
  options: { insertError?: Error } = {},
) {
  const dashboardSelectWhere = vi.fn(async () => (row ? [row] : []));
  const dashboardSelectFrom = vi.fn(() => ({ where: dashboardSelectWhere }));
  const revisionOrderBy = vi.fn(async () => revisions);
  const revisionSelectWhere = vi.fn(() => ({ orderBy: revisionOrderBy }));
  const revisionSelectFrom = vi.fn(() => ({ where: revisionSelectWhere }));
  const select = vi
    .fn()
    .mockReturnValueOnce({ from: dashboardSelectFrom })
    .mockReturnValueOnce({ from: revisionSelectFrom });

  const returning = vi.fn(async () => updated);
  const updateWhere = vi.fn(() => ({ returning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const insertValues = vi.fn(async () => {
    if (options.insertError) throw options.insertError;
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  const deleteWhere = vi.fn(async () => undefined);
  const deleteRow = vi.fn(() => ({ where: deleteWhere }));
  const transactionRollback = vi.fn();
  const tx = { select, update, insert, delete: deleteRow };
  const transaction = vi.fn(
    async (callback: (transactionDb: typeof tx) => any) => {
      try {
        return await callback(tx);
      } catch (err) {
        transactionRollback(err);
        throw err;
      }
    },
  );

  return {
    db: { select, transaction },
    dashboardSelectWhere,
    revisionOrderBy,
    revisionSelectWhere,
    update,
    updateSet,
    updateWhere,
    insert,
    insertValues,
    deleteRow,
    deleteWhere,
    transaction,
    transactionRollback,
  };
}

function legacyRow(overrides: Partial<DashboardRow> = {}): DashboardRow {
  const daily = requiredFirstPartyPanel("recurring-users-by-template");
  return {
    id: FIRST_PARTY_DASHBOARD_ID,
    kind: "sql",
    config: JSON.stringify({
      panels: [
        {
          ...daily,
          sql: LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
          config: {
            ...(daily.config ?? {}),
            description:
              "Daily signed-in visitors who are NOT on their all-time first active day (Recurring only), stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.",
          },
        },
      ],
    }),
    title: "First-party Template Traffic",
    updatedAt: "2026-07-21T16:00:00.000Z",
    ownerEmail: "steve@builder.io",
    orgId: "builder",
    visibility: "org",
    ...overrides,
  };
}

describe("repairPersistedFirstPartyDashboardQueries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T17:00:00.000Z"));
    dbMocks.getDb.mockReset();
    dbMocks.recordChange.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("repairs the canonical legacy config with an optimistic config match, revision, and scoped change", async () => {
    const row = legacyRow();
    const revisionId = `dashrev-${Date.parse("2026-07-21T17:00:00.000Z")}-${revisionUuid}`;
    const revisions = [
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `revision-${index}`,
      })),
      { id: revisionId },
    ];
    const mocks = createDb(row, [{ id: row.id }], revisions);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(schema.dashboards);
    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string; updatedAt: string; updatedBy: null }]
    >;
    const update = updateCalls[0]?.[0];
    expect(update).toBeDefined();
    if (!update)
      throw new Error("Expected persisted repair to issue an update");
    expect(JSON.parse(update.config).panels[0].sql).toBe(
      requiredFirstPartyPanel("recurring-users-by-template").sql,
    );
    expect(update).toMatchObject({
      updatedAt: "2026-07-21T17:00:00.000Z",
      updatedBy: null,
    });
    expect(mocks.updateWhere).toHaveBeenCalledWith({
      type: "and",
      conditions: [
        { type: "eq", column: "id", value: FIRST_PARTY_DASHBOARD_ID },
        { type: "eq", column: "config", value: row.config },
        { type: "eq", column: "updatedAt", value: row.updatedAt },
      ],
    });
    expect(mocks.insert).toHaveBeenCalledWith(schema.dashboardRevisions);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: revisionId,
        dashboardId: row.id,
        kind: row.kind,
        title: row.title,
        config: row.config,
        createdAt: "2026-07-21T17:00:00.000Z",
        createdBy: null,
        ownerEmail: row.ownerEmail,
        orgId: row.orgId,
      }),
    );
    expect(mocks.revisionSelectWhere).toHaveBeenCalledWith({
      type: "eq",
      column: "dashboardId",
      value: row.id,
    });
    expect(mocks.revisionOrderBy).toHaveBeenCalledWith(
      { type: "desc", column: "createdAt" },
      { type: "desc", column: "id" },
    );
    expect(mocks.deleteWhere).toHaveBeenNthCalledWith(1, {
      type: "eq",
      column: "id",
      value: "revision-49",
    });
    expect(mocks.deleteWhere).toHaveBeenNthCalledWith(2, {
      type: "eq",
      column: "id",
      value: "revision-50",
    });
    expect(mocks.deleteWhere).not.toHaveBeenCalledWith({
      type: "eq",
      column: "id",
      value: revisionId,
    });
    expect(dbMocks.recordChange).toHaveBeenCalledWith({
      source: "dashboards",
      type: "change",
      key: row.id,
      orgId: row.orgId,
    });
  });

  it("repairs the previously deployed bounded monolithic recurring SQL", async () => {
    const daily = requiredFirstPartyPanel("recurring-users-by-template");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...daily,
            sql: INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL,
            config: {
              ...(daily.config ?? {}),
              description:
                "Daily signed-in visitors who are not on their first active day observed in the previous 365 days, stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.",
            },
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0]).toMatchObject({
      sql: daily.sql,
      config: { description: daily.config?.description },
    });
  });

  it("repairs the exact legacy seeded signups date-fill query", async () => {
    const signups = requiredFirstPartyPanel("signups-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [{ ...signups, sql: LEGACY_SEED_SIGNUPS_OVER_TIME_SQL }],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      signups.sql,
    );
  });

  it("repairs only the exact live custom new-vs-recurring panel", async () => {
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            id: "new-vs-recurring-users",
            sql: LEGACY_NEW_VS_RECURRING_USERS_SQL,
            config: {
              description:
                "Daily signed-in visitors split by first-ever session (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs excluded. A user is New only on their all-time first active day.",
            },
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panel = JSON.parse(updateCalls[0]![0].config).panels[0];
    expect(panel.sql).toContain("WITH first_seen AS");
    expect(panel.sql).toContain("), activity AS");
    expect(panel.sql.match(/365 days/g)).toHaveLength(3);
    expect(panel.config.description).toContain("previous 365 days");
  });

  it("does not write a revision or change when its optimistic update loses", async () => {
    const row = legacyRow();
    const mocks = createDb(row, []);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.deleteRow).not.toHaveBeenCalled();
    expect(dbMocks.recordChange).not.toHaveBeenCalled();
  });

  it("rejects a failed revision insert from the transaction without publishing a change", async () => {
    const row = legacyRow();
    const revisionFailure = new Error("revision insert failed");
    const mocks = createDb(row, [{ id: row.id }], [], {
      insertError: revisionFailure,
    });
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).rejects.toBe(
      revisionFailure,
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transactionRollback).toHaveBeenCalledWith(revisionFailure);
    expect(dbMocks.recordChange).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a custom config",
      JSON.stringify({
        panels: [
          {
            id: "recurring-users-by-template",
            sql: "SELECT custom_recurring_users()",
          },
        ],
      }),
    ],
    [
      "a changed custom new-vs-recurring query",
      JSON.stringify({
        panels: [
          {
            id: "new-vs-recurring-users",
            sql: `${LEGACY_NEW_VS_RECURRING_USERS_SQL} `,
          },
        ],
      }),
    ],
    [
      "a changed custom signups date-fill query",
      JSON.stringify({
        panels: [
          {
            id: "signups-over-time",
            sql: `${LEGACY_SIGNUPS_OVER_TIME_SQL} `,
          },
        ],
      }),
    ],
    ["invalid JSON", "not-json"],
  ])("does not update %s", async (_label, config) => {
    const mocks = createDb(legacyRow({ config }));
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(dbMocks.recordChange).not.toHaveBeenCalled();
  });

  it("targets only the canonical dashboard id", async () => {
    const mocks = createDb(null);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.dashboardSelectWhere).toHaveBeenCalledWith({
      type: "eq",
      column: "id",
      value: FIRST_PARTY_DASHBOARD_ID,
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
