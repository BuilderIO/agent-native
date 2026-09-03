import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return { ...actual, getDb: getDbMock };
});

import { schema } from "../db/index.js";
import { upsertFirstPartyAnalyticsRollups } from "./first-party-analytics-rollups";

interface Write {
  kind: "update" | "nothing";
  table: unknown;
  rows: unknown;
  config: unknown;
}

function mockDb() {
  const writes: Write[] = [];
  const tx = {
    execute: vi.fn(async (_query: unknown) => ({ rows: [] })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((rows: unknown) => ({
        onConflictDoUpdate: vi.fn(async (config: unknown) => {
          writes.push({ kind: "update", table, rows, config });
        }),
        onConflictDoNothing: vi.fn(async (config: unknown) => {
          writes.push({ kind: "nothing", table, rows, config });
        }),
      })),
    })),
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) =>
      callback(tx),
    ),
  };
  return { db, tx, writes };
}

beforeEach(() => {
  getDbMock.mockReset();
});

describe("upsertFirstPartyAnalyticsRollups", () => {
  it("groups daily counts and de-duplicates user days within one batch", async () => {
    const { db, writes } = mockDb();
    getDbMock.mockReturnValue(db);

    const result = await upsertFirstPartyAnalyticsRollups([
      {
        eventName: "pageview",
        eventDate: "2026-08-05",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        userKey: "user_1",
        app: "analytics",
        template: "analytics",
      },
      {
        eventName: "pageview",
        eventDate: "2026-08-05",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        userKey: "user_1",
        app: "analytics",
        template: "analytics",
      },
      {
        eventName: "signup",
        eventDate: "2026-08-05",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        userKey: "user_2",
        app: "analytics",
        template: "analytics",
      },
      {
        eventName: "pageview",
        eventDate: "2026-08-05",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        userKey: null,
        app: "analytics",
        template: "analytics",
      },
    ]);

    expect(result).toEqual({
      eventCount: 4,
      dailyRollupCount: 2,
      userDayCount: 2,
    });
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      kind: "update",
      table: schema.analyticsEventDailyRollups,
    });
    expect(writes[0].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantKey: "org:org_123",
          eventName: "pageview",
          eventCount: 3,
        }),
        expect.objectContaining({
          tenantKey: "org:org_123",
          eventName: "signup",
          eventCount: 1,
        }),
      ]),
    );
    expect(writes[1]).toMatchObject({
      kind: "nothing",
      table: schema.analyticsUserDays,
    });
    expect(writes[1].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userKey: "user_1" }),
        expect.objectContaining({ userKey: "user_2" }),
      ]),
    );
  });

  it("keeps personal tenants separate and does not create anonymous user-day rows", async () => {
    const { db, writes } = mockDb();
    getDbMock.mockReturnValue(db);

    const result = await upsertFirstPartyAnalyticsRollups([
      {
        eventName: "pageview",
        eventDate: "2026-08-05",
        ownerEmail: "one@example.com",
        userKey: "visitor_1",
      },
      {
        eventName: "pageview",
        eventDate: "2026-08-05",
        ownerEmail: "two@example.com",
        userKey: null,
      },
    ]);

    expect(result).toEqual({
      eventCount: 2,
      dailyRollupCount: 2,
      userDayCount: 1,
    });
    expect(writes[0].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenantKey: "user:one@example.com" }),
        expect.objectContaining({ tenantKey: "user:two@example.com" }),
      ]),
    );
    expect(writes[1].rows).toEqual([
      expect.objectContaining({
        tenantKey: "user:one@example.com",
        userKey: "visitor_1",
      }),
    ]);
  });

  it("writes each post-insert batch as an incremental conflict update", async () => {
    const { db, writes } = mockDb();
    getDbMock.mockReturnValue(db);
    const row = {
      eventName: "pageview",
      eventDate: "2026-08-05",
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      userKey: "visitor_1",
      app: "analytics",
      template: "analytics",
    };

    await upsertFirstPartyAnalyticsRollups([row]);
    await upsertFirstPartyAnalyticsRollups([row]);

    const dailyWrites = writes.filter((write) => write.kind === "update");
    const userDayWrites = writes.filter((write) => write.kind === "nothing");
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(dailyWrites).toHaveLength(2);
    expect((dailyWrites[0].rows as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({ eventCount: 1 }),
    );
    expect((dailyWrites[1].rows as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({ eventCount: 1 }),
    );
    expect((dailyWrites[0].rows as Array<Record<string, unknown>>)[0]?.id).toBe(
      (dailyWrites[1].rows as Array<Record<string, unknown>>)[0]?.id,
    );
    expect(userDayWrites).toHaveLength(2);
  });

  it("uses a caller-owned transaction when one is provided", async () => {
    const { db, tx, writes } = mockDb();
    getDbMock.mockReturnValue(db);
    const row = {
      eventName: "pageview",
      eventDate: "2026-08-05",
      ownerEmail: "owner@example.com",
      userKey: "visitor_1",
    };

    await upsertFirstPartyAnalyticsRollups([row], tx);

    expect(writes).toHaveLength(2);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("does not block foreground ingest behind a historical backfill", async () => {
    const { tx, db } = mockDb();
    getDbMock.mockReturnValue(db);

    await upsertFirstPartyAnalyticsRollups(
      [
        {
          eventName: "pageview",
          eventDate: "2026-08-05",
          ownerEmail: "owner@example.com",
        },
      ],
      tx,
    );

    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("fails before opening a transaction for malformed normalized rows", async () => {
    const { db } = mockDb();
    getDbMock.mockReturnValue(db);

    await expect(
      upsertFirstPartyAnalyticsRollups([
        {
          eventName: "",
          eventDate: "2026-08-05",
          ownerEmail: "owner@example.com",
        },
      ]),
    ).rejects.toThrow("eventName");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("does not open the database for an empty batch", async () => {
    const { db } = mockDb();
    getDbMock.mockReturnValue(db);

    await expect(upsertFirstPartyAnalyticsRollups([])).resolves.toEqual({
      eventCount: 0,
      dailyRollupCount: 0,
      userDayCount: 0,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
