import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { and, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return { ...actual, getDb: getDbMock };
});

import { schema } from "../db/index.js";
import {
  __resetSessionEventIndexForTests,
  aggregateSessionEventIndexRows,
  EVENT_CATALOG_MAX_ENTRIES,
  listEventCatalog,
  listSessionEventNames,
  pruneSessionEventIndex,
  recordEventCatalog,
  recordSessionEventIndex,
  samplePropertyKeys,
  sessionEventFilterConditions,
  type SessionEventIndexInputRow,
} from "./session-event-index";

/** The index DDL comes straight from the migration so the test tracks it. */
function sessionEventIndexMigrationSql(): string[] {
  const source = readFileSync(
    new URL("../plugins/db.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(
    /name: "analytics-session-event-index",\s*sql: \{\s*postgres: `([\s\S]*?)`/,
  );
  if (!match) throw new Error("session event index migration not found");
  return match[1]
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function createTables(client: PGliteClient) {
  for (const statement of sessionEventIndexMigrationSql()) {
    await client.query(statement);
  }
  await client.query(`
    CREATE TABLE session_recordings (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      started_at text NOT NULL
    )
  `);
}

const OWNER = "owner@example.com";
const ORG = "org_1";

function event(
  overrides: Partial<SessionEventIndexInputRow> & {
    eventName: string;
    sessionId: string | null;
    timestamp: string;
  },
): SessionEventIndexInputRow {
  return {
    eventDate: overrides.timestamp.slice(0, 10),
    app: "clips",
    properties: "{}",
    ownerEmail: OWNER,
    orgId: ORG,
    ...overrides,
  };
}

describe("samplePropertyKeys", () => {
  it("returns sorted top-level keys and drops unsafe ones", () => {
    expect(
      samplePropertyKeys(
        JSON.stringify({
          zeta: 1,
          alpha: { nested: true },
          "has space": 1,
          $ai_model: "x",
        }),
      ),
    ).toEqual(["$ai_model", "alpha", "zeta"]);
  });

  it("ignores invalid JSON and non-object payloads", () => {
    expect(samplePropertyKeys("not json")).toEqual([]);
    expect(samplePropertyKeys("[1,2]")).toEqual([]);
    expect(samplePropertyKeys("null")).toEqual([]);
  });
});

describe("aggregateSessionEventIndexRows", () => {
  it("counts per session and per day, and keeps first and last times", () => {
    const { sessionEvents, catalog } = aggregateSessionEventIndexRows([
      event({
        eventName: "clip_viewed",
        sessionId: "s1",
        timestamp: "2026-09-20T10:00:05.000Z",
      }),
      event({
        eventName: "clip_viewed",
        sessionId: "s1",
        timestamp: "2026-09-20T10:00:01.000Z",
        properties: JSON.stringify({ early: true }),
      }),
      event({
        eventName: "clip_viewed",
        sessionId: null,
        timestamp: "2026-09-20T11:00:00.000Z",
        properties: JSON.stringify({ clipId: "c1" }),
      }),
    ]);

    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0]).toMatchObject({
      tenantKey: `org:${ORG}`,
      sessionId: "s1",
      eventCount: 2,
      firstAt: "2026-09-20T10:00:01.000Z",
      lastAt: "2026-09-20T10:00:05.000Z",
    });
    // Events without a session still count toward the catalog.
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      eventCount: 3,
      lastSeenAt: "2026-09-20T11:00:00.000Z",
      propertyKeys: JSON.stringify(["clipId"]),
    });
  });

  it("keys personal events by owner and skips rows without a name", () => {
    const { sessionEvents } = aggregateSessionEventIndexRows([
      event({
        eventName: "recording_started",
        sessionId: "s1",
        timestamp: "2026-09-20T10:00:00.000Z",
        orgId: null,
      }),
      event({
        eventName: "  ",
        sessionId: "s1",
        timestamp: "2026-09-20T10:00:00.000Z",
      }),
    ]);
    expect(sessionEvents.map((row) => row.tenantKey)).toEqual([
      `user:${OWNER}`,
    ]);
  });
});

describe("session event index on Postgres", () => {
  let client: PGliteClient;
  let db: any;

  beforeEach(async () => {
    __resetSessionEventIndexForTests();
    client = await PGlite.create("memory://");
    await createTables(client);
    db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
  });

  afterEach(async () => {
    await client.close();
  });

  async function addRecording(
    id: string,
    sessionId: string,
    startedAt: string,
    owner: { ownerEmail?: string; orgId?: string | null } = {},
  ) {
    await client.query(
      `INSERT INTO session_recordings (id, session_id, owner_email, org_id, started_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        sessionId,
        owner.ownerEmail ?? OWNER,
        owner.orgId === undefined ? ORG : owner.orgId,
        startedAt,
      ],
    );
  }

  async function matchingRecordings(filters: {
    didEvents?: string[];
    didNotEvents?: string[];
  }): Promise<string[]> {
    const r = schema.sessionRecordings;
    const rows = await db
      .select({ id: r.id })
      .from(r)
      .where(and(...sessionEventFilterConditions(filters)))
      .orderBy(asc(r.id));
    return rows.map((row: { id: string }) => row.id);
  }

  /** Mirrors ingest: session rows in the event transaction, catalog after it. */
  async function index(rows: SessionEventIndexInputRow[], receivedAt: string) {
    await db.transaction((tx: any) =>
      recordSessionEventIndex(tx, rows, receivedAt),
    );
    await recordEventCatalog(rows);
  }

  /** A real write error, so the savepoint rollback runs as it does in production. */
  async function failInsertsInto(table: string) {
    await client.query(
      "CREATE OR REPLACE FUNCTION fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'insert failed'; END $$",
    );
    await client.query(
      `CREATE TRIGGER fail_insert BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_insert()`,
    );
  }

  async function restoreInsertsInto(table: string) {
    await client.query(`DROP TRIGGER fail_insert ON ${table}`);
  }

  async function storeBatch(
    recordingId: string,
    rows: SessionEventIndexInputRow[],
    receivedAt: string,
  ) {
    // The recording row stands in for the events the ingest transaction stores.
    await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`INSERT INTO session_recordings (id, session_id, owner_email, org_id, started_at)
            VALUES (${recordingId}, 'stored', ${OWNER}, ${ORG}, ${receivedAt})`,
      );
      await recordSessionEventIndex(tx, rows, receivedAt);
    });
  }

  it("returns exactly the sessions that did one event and not another", async () => {
    await index(
      [
        event({
          eventName: "recording_started",
          sessionId: "s-both",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
        event({
          eventName: "clip_viewed",
          sessionId: "s-both",
          timestamp: "2026-09-20T10:02:00.000Z",
        }),
        event({
          eventName: "recording_started",
          sessionId: "s-recorded",
          timestamp: "2026-09-20T10:03:00.000Z",
        }),
        event({
          eventName: "clip_viewed",
          sessionId: "s-viewed",
          timestamp: "2026-09-20T10:04:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    await addRecording("r-both", "s-both", "2026-09-20T10:00:30.000Z");
    await addRecording("r-recorded", "s-recorded", "2026-09-20T10:02:30.000Z");
    await addRecording("r-viewed", "s-viewed", "2026-09-20T10:03:30.000Z");

    expect(
      await matchingRecordings({
        didEvents: ["recording_started"],
        didNotEvents: ["clip_viewed"],
      }),
    ).toEqual(["r-recorded"]);
    expect(
      await matchingRecordings({ didEvents: ["recording_started"] }),
    ).toEqual(["r-both", "r-recorded"]);
    expect(await matchingRecordings({ didNotEvents: ["clip_viewed"] })).toEqual(
      ["r-recorded"],
    );
  });

  it("never treats a session the index never saw as not doing an event", async () => {
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s-seen",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    await addRecording("r-seen", "s-seen", "2026-09-20T10:00:30.000Z");
    // Covered by time, but its index write failed or was pruned.
    await addRecording("r-unseen", "s-unseen", "2026-09-20T10:05:00.000Z");

    expect(await matchingRecordings({ didNotEvents: ["clip_viewed"] })).toEqual(
      ["r-seen"],
    );
  });

  it("excludes a session that had a recording before coverage began", async () => {
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s-tabs",
          timestamp: "2026-09-20T10:31:00.000Z",
        }),
        event({
          eventName: "pageview",
          sessionId: "s-fresh",
          timestamp: "2026-09-20T10:31:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    // The first tab's events, such as a purchase, predate the index.
    await addRecording("r-tab-1", "s-tabs", "2026-09-20T09:50:00.000Z");
    await addRecording("r-tab-2", "s-tabs", "2026-09-20T10:30:00.000Z");
    await addRecording("r-fresh", "s-fresh", "2026-09-20T10:30:00.000Z");
    // The same session id under another tenant never excludes this one.
    await addRecording("r-other", "s-fresh", "2026-09-20T09:00:00.000Z", {
      ownerEmail: "someone@other.test",
      orgId: "org_other",
    });

    expect(await matchingRecordings({ didNotEvents: ["purchase"] })).toEqual([
      "r-fresh",
    ]);
  });

  it("starts coverage only after a session write succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const batch = [
      event({
        eventName: "pageview",
        sessionId: "s1",
        timestamp: "2026-09-20T10:01:00.000Z",
      }),
    ];
    await failInsertsInto("analytics_session_events");
    await index(batch, "2026-09-20T10:00:00.000Z");
    await restoreInsertsInto("analytics_session_events");
    await index(batch, "2026-09-20T11:00:00.000Z");
    warn.mockRestore();

    const coverage = await client.query(
      "SELECT started_at FROM analytics_session_event_coverage",
    );
    expect(coverage.rows).toEqual([{ started_at: "2026-09-20T11:00:00.000Z" }]);
  });

  it("keeps a session whose index write failed out of didn't filters", async () => {
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s-ok",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The failed batch held s-gap's clip view.
    await failInsertsInto("analytics_session_events");
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s-gap",
          timestamp: "2026-09-20T10:05:00.000Z",
        }),
      ],
      "2026-09-20T10:05:00.000Z",
    );
    await restoreInsertsInto("analytics_session_events");
    warn.mockRestore();
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s-gap",
          timestamp: "2026-09-20T10:06:00.000Z",
        }),
      ],
      "2026-09-20T10:06:00.000Z",
    );
    await addRecording("r-ok", "s-ok", "2026-09-20T10:00:30.000Z");
    await addRecording("r-gap", "s-gap", "2026-09-20T10:04:00.000Z");

    expect(await matchingRecordings({ didNotEvents: ["clip_viewed"] })).toEqual(
      ["r-ok"],
    );
    expect(await matchingRecordings({ didEvents: ["pageview"] })).toEqual([
      "r-gap",
      "r-ok",
    ]);
  });

  it("reports the coverage start that holds for every tenant the viewer sees", async () => {
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s-personal",
          timestamp: "2026-09-19T09:01:00.000Z",
          orgId: null,
        }),
      ],
      "2026-09-19T09:00:00.000Z",
    );
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s-org",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );

    const names = await listSessionEventNames({ userEmail: OWNER, orgId: ORG });
    expect(names.coverageStartedAt).toBe("2026-09-20T10:00:00.000Z");
  });

  it("rejects range bounds it cannot parse", async () => {
    const scope = { userEmail: OWNER, orgId: ORG };
    await expect(
      listEventCatalog(scope, { from: "last week" }),
    ).rejects.toThrow("Invalid event range bound");
    // All but the first parse with `new Date()` as some other moment.
    for (const bound of [
      "not-a-date",
      "Sept 1",
      "2026-02-30",
      "2026-09-20T10:00:00",
    ]) {
      await expect(listEventCatalog(scope, { to: bound })).rejects.toThrow(
        "Invalid event range bound",
      );
    }
    await expect(
      listSessionEventNames(scope, { from: "last week" }),
    ).rejects.toThrow("Invalid event range bound");
  });

  it("excludes sessions recorded before the index covered their tenant", async () => {
    await index(
      [
        event({
          eventName: "recording_started",
          sessionId: "s-new",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    await addRecording("r-old", "s-old", "2026-09-19T09:00:00.000Z");
    await addRecording("r-new", "s-new", "2026-09-20T10:00:30.000Z");

    // The old session has no index rows; "didn't" would falsely match it.
    expect(
      await matchingRecordings({ didNotEvents: ["recording_started"] }),
    ).toEqual([]);
  });

  it("never matches index rows from another tenant's session", async () => {
    await index(
      [
        event({
          eventName: "recording_started",
          sessionId: "shared-session",
          timestamp: "2026-09-20T10:01:00.000Z",
          ownerEmail: "someone@other.test",
          orgId: "org_other",
        }),
        event({
          eventName: "pageview",
          sessionId: "shared-session",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    await addRecording("r-mine", "shared-session", "2026-09-20T10:00:30.000Z");

    expect(
      await matchingRecordings({ didEvents: ["recording_started"] }),
    ).toEqual([]);
  });

  it("accumulates counts across batches and lists names in range", async () => {
    const batch = [
      event({
        eventName: "clip_viewed",
        sessionId: "s1",
        timestamp: "2026-09-20T10:01:00.000Z",
      }),
      event({
        eventName: "clip_viewed",
        sessionId: "s2",
        timestamp: "2026-09-20T10:02:00.000Z",
      }),
      event({
        eventName: "recording_started",
        sessionId: "s1",
        timestamp: "2026-09-20T10:03:00.000Z",
      }),
    ];
    await index(batch, "2026-09-20T10:00:00.000Z");
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-20T09:59:00.000Z",
        }),
      ],
      "2026-09-20T10:05:00.000Z",
    );

    const row = (
      await client.query(
        `SELECT event_count, first_at, last_at FROM analytics_session_events
         WHERE session_id = 's1' AND event_name = 'clip_viewed'`,
      )
    ).rows[0] as Record<string, unknown>;
    expect(row).toEqual({
      event_count: 2,
      first_at: "2026-09-20T09:59:00.000Z",
      last_at: "2026-09-20T10:01:00.000Z",
    });

    const names = await listSessionEventNames(
      { userEmail: OWNER, orgId: ORG },
      { from: "2026-09-20T00:00:00.000Z" },
    );
    expect(names.events).toEqual([
      { eventName: "clip_viewed", sessionCount: 2 },
      { eventName: "recording_started", sessionCount: 1 },
    ]);
    expect(names.coverageStartedAt).toBe("2026-09-20T10:00:00.000Z");

    const otherViewer = await listSessionEventNames({
      userEmail: "someone@other.test",
      orgId: "org_other",
    });
    expect(otherViewer.events).toEqual([]);
  });

  it("builds the catalog with volume, last seen, keys, and health flags", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-23T10:00:00.000Z",
          properties: JSON.stringify({ clipId: "c1", source: "share" }),
        }),
        event({
          eventName: "clip_viewed",
          sessionId: "s2",
          timestamp: "2026-09-22T10:00:00.000Z",
        }),
        event({
          eventName: "recording_started",
          sessionId: "s3",
          timestamp: "2026-09-01T10:00:00.000Z",
        }),
        event({
          eventName: "pageview",
          sessionId: "s4",
          timestamp: "2026-09-23T10:00:00.000Z",
          app: "slides",
        }),
      ],
      "2026-09-01T00:00:00.000Z",
    );

    const catalog = await listEventCatalog(
      { userEmail: OWNER, orgId: ORG },
      { from: "2026-09-10T00:00:00.000Z", now },
    );

    const byName = Object.fromEntries(
      catalog.entries.map((entry) => [
        `${entry.app}:${entry.eventName}`,
        entry,
      ]),
    );
    expect(byName["clips:clip_viewed"]).toMatchObject({
      volume: 2,
      lastSeenAt: "2026-09-23T10:00:00.000Z",
      propertyKeys: ["clipId", "source"],
      automatic: false,
      stoppedFiring: false,
    });
    // Out of range, but still listed with its last-seen date.
    expect(byName["clips:recording_started"]).toMatchObject({
      volume: 0,
      lastSeenAt: "2026-09-01T10:00:00.000Z",
      stoppedFiring: true,
    });
    expect(byName["slides:pageview"]).toMatchObject({ automatic: true });
    expect(catalog.truncated).toBe(false);
    expect(catalog.apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ app: "slides", onlyAutomaticEvents: true }),
        expect.objectContaining({ app: "clips", onlyAutomaticEvents: false }),
      ]),
    );
  });

  it("returns the most recently seen events up to the catalog cap", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const base = Date.parse("2026-09-01T00:00:00.000Z");
    await index(
      Array.from({ length: EVENT_CATALOG_MAX_ENTRIES + 1 }, (_, index) =>
        event({
          eventName: `event_${String(index).padStart(4, "0")}`,
          sessionId: "s1",
          timestamp: new Date(base + index * 60_000).toISOString(),
        }),
      ),
      "2026-09-01T00:00:00.000Z",
    );

    const catalog = await listEventCatalog(
      { userEmail: OWNER, orgId: ORG },
      { now },
    );

    expect(catalog.truncated).toBe(true);
    expect(catalog.entries).toHaveLength(EVENT_CATALOG_MAX_ENTRIES);
    expect(
      catalog.entries.some((entry) => entry.eventName === "event_0000"),
    ).toBe(false);
  });

  it("keeps last seen from the latest sighting across batches", async () => {
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-22T10:00:00.000Z",
          properties: JSON.stringify({ newer: true }),
        }),
      ],
      "2026-09-22T10:00:00.000Z",
    );
    // A late batch with an older event never rolls last seen back.
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s2",
          timestamp: "2026-09-21T10:00:00.000Z",
          properties: JSON.stringify({ older: true }),
        }),
      ],
      "2026-09-22T10:01:00.000Z",
    );

    const catalog = await listEventCatalog(
      { userEmail: OWNER, orgId: ORG },
      { now: new Date("2026-09-24T12:00:00.000Z") },
    );
    expect(catalog.entries).toEqual([
      expect.objectContaining({
        eventName: "clip_viewed",
        volume: 2,
        lastSeenAt: "2026-09-22T10:00:00.000Z",
        propertyKeys: ["newer"],
      }),
    ]);
  });

  it("flags apps from every event in range, not just the listed ones", async () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    // crm's custom event is its oldest, so the cap cuts it from the list.
    await index(
      [
        event({
          eventName: "deal_won",
          sessionId: "s-crm",
          timestamp: "2026-09-11T10:00:00.000Z",
          app: "crm",
        }),
        event({
          eventName: "pageview",
          sessionId: "s-crm",
          timestamp: "2026-09-20T10:01:00.000Z",
          app: "crm",
        }),
        ...Array.from({ length: EVENT_CATALOG_MAX_ENTRIES }, (_, index) =>
          event({
            eventName: `web_${String(index).padStart(4, "0")}`,
            sessionId: "s-web",
            timestamp: "2026-09-20T10:00:00.000Z",
            app: "web",
          }),
        ),
      ],
      "2026-09-20T10:01:00.000Z",
    );

    const catalog = await listEventCatalog(
      { userEmail: OWNER, orgId: ORG },
      { now },
    );

    expect(catalog.truncated).toBe(true);
    expect(
      catalog.entries.some((entry) => entry.eventName === "deal_won"),
    ).toBe(false);
    expect(catalog.apps.find((app) => app.app === "crm")).toEqual({
      app: "crm",
      eventCount: 2,
      volume: 2,
      onlyAutomaticEvents: false,
    });
  });

  it("merges an event the viewer's org and personal tenants both saw", async () => {
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s-personal",
          timestamp: "2026-09-20T10:00:00.000Z",
          orgId: null,
          properties: JSON.stringify({ personal: true }),
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s-org",
          timestamp: "2026-09-21T10:00:00.000Z",
          properties: JSON.stringify({ org: true }),
        }),
      ],
      "2026-09-21T10:00:00.000Z",
    );

    const catalog = await listEventCatalog(
      { userEmail: OWNER, orgId: ORG },
      { now: new Date("2026-09-24T12:00:00.000Z") },
    );
    expect(catalog.entries).toEqual([
      expect.objectContaining({
        eventName: "clip_viewed",
        volume: 2,
        lastSeenAt: "2026-09-21T10:00:00.000Z",
        propertyKeys: ["org"],
      }),
    ]);
  });

  it("prunes session rows past replay retention and old catalog days", async () => {
    await index(
      [
        event({
          eventName: "old_event",
          sessionId: "s-old",
          timestamp: "2026-01-01T10:00:00.000Z",
        }),
        event({
          eventName: "new_event",
          sessionId: "s-new",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-01-01T00:00:00.000Z",
    );

    await pruneSessionEventIndex(30, new Date("2026-09-24T00:00:00.000Z"));

    const sessions = await client.query(
      "SELECT event_name FROM analytics_session_events ORDER BY event_name",
    );
    expect(sessions.rows).toEqual([{ event_name: "new_event" }]);
    const catalog = await client.query(
      "SELECT event_name FROM analytics_event_catalog_daily ORDER BY event_name",
    );
    expect(catalog.rows).toEqual([{ event_name: "new_event" }]);
    const latest = await client.query(
      "SELECT event_name FROM analytics_event_catalog_latest ORDER BY event_name",
    );
    expect(latest.rows).toEqual([{ event_name: "new_event" }]);
  });

  it("prunes a gap marker only once its session has expired", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failInsertsInto("analytics_session_events");
    for (const sessionId of ["s-expired", "s-active"]) {
      await index(
        [
          event({
            eventName: "clip_viewed",
            sessionId,
            timestamp: "2026-08-01T10:00:00.000Z",
          }),
        ],
        "2026-08-01T10:00:00.000Z",
      );
    }
    await restoreInsertsInto("analytics_session_events");
    warn.mockRestore();
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s-active",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );

    await pruneSessionEventIndex(30, new Date("2026-09-24T00:00:00.000Z"));

    const gaps = await client.query(
      "SELECT session_id FROM analytics_session_event_gaps ORDER BY session_id",
    );
    expect(gaps.rows).toEqual([{ session_id: "s-active" }]);
  });

  it("keeps a session's rows together until all of them expire", async () => {
    await index(
      [
        event({
          eventName: "purchase",
          sessionId: "s-long",
          timestamp: "2026-08-01T10:00:00.000Z",
        }),
        event({
          eventName: "pageview",
          sessionId: "s-long",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-07-01T00:00:00.000Z",
    );
    await addRecording("r-long", "s-long", "2026-08-01T09:59:00.000Z");

    await pruneSessionEventIndex(30, new Date("2026-09-24T00:00:00.000Z"));

    const sessions = await client.query(
      "SELECT event_name FROM analytics_session_events ORDER BY event_name",
    );
    expect(sessions.rows).toEqual([
      { event_name: "pageview" },
      { event_name: "purchase" },
    ]);
    expect(await matchingRecordings({ didNotEvents: ["purchase"] })).toEqual(
      [],
    );
  });

  it("stores a batch whose index write fails, with its sessions marked incomplete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The last write fails, so the session rows must roll back with it.
    await failInsertsInto("analytics_session_event_coverage");
    await storeBatch(
      "r-stored",
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("marked incomplete");
    warn.mockRestore();

    const stored = await client.query("SELECT id FROM session_recordings");
    expect(stored.rows).toEqual([{ id: "r-stored" }]);
    const sessions = await client.query(
      "SELECT session_id FROM analytics_session_events",
    );
    expect(sessions.rows).toEqual([]);
    const gaps = await client.query(
      "SELECT session_id FROM analytics_session_event_gaps",
    );
    expect(gaps.rows).toEqual([{ session_id: "s1" }]);
  });

  it("stores the batch unindexed before the index tables are migrated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const table of [
      "analytics_session_events",
      "analytics_session_event_coverage",
      "analytics_session_event_gaps",
    ]) {
      await client.query(`DROP TABLE ${table}`);
    }
    await storeBatch(
      "r-early",
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("not migrated yet");
    warn.mockRestore();

    const stored = await client.query("SELECT id FROM session_recordings");
    expect(stored.rows).toEqual([{ id: "r-early" }]);
  });

  it("stores the batch unindexed when the migration stopped before coverage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await client.query("DROP TABLE analytics_session_event_gaps");
    await client.query("DROP TABLE analytics_session_event_coverage");
    await storeBatch(
      "r-partial",
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    expect(String(warn.mock.calls[0]?.[0])).toContain("not migrated yet");
    warn.mockRestore();

    const stored = await client.query("SELECT id FROM session_recordings");
    expect(stored.rows).toEqual([{ id: "r-partial" }]);
    const indexed = await client.query(
      "SELECT session_id FROM analytics_session_events",
    );
    expect(indexed.rows).toEqual([]);
  });

  it("indexes an event name cut inside an emoji", async () => {
    const name = `${"a".repeat(199)}\u{1F600}`;
    await storeBatch(
      "r-emoji",
      [
        event({
          eventName: name,
          sessionId: "s1",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );

    const indexed = await client.query(
      "SELECT event_name FROM analytics_session_events",
    );
    expect(indexed.rows).toEqual([{ event_name: "a".repeat(199) }]);
    const gaps = await client.query(
      "SELECT session_id FROM analytics_session_event_gaps",
    );
    expect(gaps.rows).toEqual([]);
  });

  it("stores a batch whose session id is too long to index", async () => {
    // Random, so the unique index cannot compress it under its entry limit.
    const longId = Array.from({ length: 4096 }, () =>
      Math.floor(Math.random() * 36).toString(36),
    ).join("");
    await storeBatch(
      "r-long-id",
      [
        event({
          eventName: "clip_viewed",
          sessionId: longId,
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-20T10:00:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );

    const indexed = await client.query(
      "SELECT session_id FROM analytics_session_events",
    );
    expect(indexed.rows).toEqual([{ session_id: "s1" }]);
    const gaps = await client.query(
      "SELECT session_id FROM analytics_session_event_gaps",
    );
    expect(gaps.rows).toEqual([]);
  });

  it("still warns about an index failure right after a catalog failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const batch = [
      event({
        eventName: "pageview",
        sessionId: "s1",
        timestamp: "2026-09-20T10:00:00.000Z",
      }),
    ];
    await failInsertsInto("analytics_event_catalog_latest");
    await index(batch, "2026-09-20T10:00:00.000Z");
    await failInsertsInto("analytics_session_event_coverage");
    await storeBatch("r1", batch, "2026-09-20T10:01:00.000Z");

    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
      expect.stringContaining("Event catalog write failed"),
      expect.stringContaining("marked incomplete"),
    ]);
    warn.mockRestore();
  });

  it("keeps a session indexed when only its catalog write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failInsertsInto("analytics_event_catalog_latest");
    await index(
      [
        event({
          eventName: "pageview",
          sessionId: "s1",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "Event catalog write failed",
    );
    warn.mockRestore();
    await addRecording("r1", "s1", "2026-09-20T10:00:30.000Z");

    expect(await matchingRecordings({ didNotEvents: ["clip_viewed"] })).toEqual(
      ["r1"],
    );
    const gaps = await client.query(
      "SELECT session_id FROM analytics_session_event_gaps",
    );
    expect(gaps.rows).toEqual([]);
  });

  it("treats a date-only upper bound as that whole day", async () => {
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-20T15:00:00.000Z",
        }),
      ],
      "2026-09-20T15:00:00.000Z",
    );

    const names = await listSessionEventNames(
      { userEmail: OWNER, orgId: ORG },
      { from: "2026-09-20", to: "2026-09-20" },
    );
    expect(names.events).toEqual([
      { eventName: "clip_viewed", sessionCount: 1 },
    ]);
  });

  it("rolls back the batch when its sessions cannot be marked incomplete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failInsertsInto("analytics_session_events");
    await failInsertsInto("analytics_session_event_gaps");
    await expect(
      storeBatch(
        "r-lost",
        [
          event({
            eventName: "clip_viewed",
            sessionId: "s1",
            timestamp: "2026-09-20T10:00:00.000Z",
          }),
        ],
        "2026-09-20T10:00:00.000Z",
      ),
    ).rejects.toThrow(/insert into "analytics_session_event_gaps"/);
    warn.mockRestore();

    const stored = await client.query("SELECT id FROM session_recordings");
    expect(stored.rows).toEqual([]);
  });

  it("serves every read from the index tables, never the event store", async () => {
    await index(
      [
        event({
          eventName: "clip_viewed",
          sessionId: "s1",
          timestamp: "2026-09-20T10:01:00.000Z",
        }),
      ],
      "2026-09-20T10:00:00.000Z",
    );
    await addRecording("r1", "s1", "2026-09-20T10:00:30.000Z");
    const queries: string[] = [];
    db = drizzle(client, {
      schema,
      logger: { logQuery: (query) => queries.push(query) },
    });
    getDbMock.mockReturnValue(db);

    const scope = { userEmail: OWNER, orgId: ORG };
    await listSessionEventNames(scope);
    await listEventCatalog(scope);
    expect(await matchingRecordings({ didEvents: ["clip_viewed"] })).toEqual([
      "r1",
    ]);
    expect(await matchingRecordings({ didNotEvents: ["purchase"] })).toEqual([
      "r1",
    ]);

    const tables = new Set(
      queries.flatMap((query) =>
        [...query.matchAll(/\b(?:from|join)\s+"([a-z_]+)"/gi)].map(
          (match) => match[1],
        ),
      ),
    );
    expect([...tables].sort()).toEqual([
      "analytics_event_catalog_daily",
      "analytics_event_catalog_latest",
      "analytics_session_event_coverage",
      "analytics_session_event_gaps",
      "analytics_session_events",
      "session_recordings",
    ]);
  });
});
