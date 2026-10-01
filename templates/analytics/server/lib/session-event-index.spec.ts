import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { and, asc } from "drizzle-orm";
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
  listEventCatalog,
  listSessionEventNames,
  pruneSessionEventIndex,
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

  it("returns exactly the sessions that did one event and not another", async () => {
    await recordSessionEventIndex(
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
    await recordSessionEventIndex(
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
    await recordSessionEventIndex(
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
    const realDb = db;
    getDbMock.mockReturnValueOnce({
      insert: (table: unknown) => {
        if (table === schema.analyticsSessionEvents) {
          throw new Error("session index write failed");
        }
        return realDb.insert(table);
      },
    });
    const batch = [
      event({
        eventName: "pageview",
        sessionId: "s1",
        timestamp: "2026-09-20T10:01:00.000Z",
      }),
    ];
    await recordSessionEventIndex(batch, "2026-09-20T10:00:00.000Z");
    await recordSessionEventIndex(batch, "2026-09-20T11:00:00.000Z");
    warn.mockRestore();

    const coverage = await client.query(
      "SELECT started_at FROM analytics_session_event_coverage",
    );
    expect(coverage.rows).toEqual([{ started_at: "2026-09-20T11:00:00.000Z" }]);
  });

  it("excludes sessions recorded before the index covered their tenant", async () => {
    await recordSessionEventIndex(
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
    await recordSessionEventIndex(
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
    await recordSessionEventIndex(batch, "2026-09-20T10:00:00.000Z");
    await recordSessionEventIndex(
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
    await recordSessionEventIndex(
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
    expect(catalog.apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ app: "slides", onlyAutomaticEvents: true }),
        expect.objectContaining({ app: "clips", onlyAutomaticEvents: false }),
      ]),
    );
  });

  it("prunes session rows past replay retention and old catalog days", async () => {
    await recordSessionEventIndex(
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
  });

  it("never throws when the index write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getDbMock.mockReturnValue({
      insert: () => {
        throw new Error("db down");
      },
    });
    await expect(
      recordSessionEventIndex(
        [
          event({
            eventName: "clip_viewed",
            sessionId: "s1",
            timestamp: "2026-09-20T10:00:00.000Z",
          }),
        ],
        "2026-09-20T10:00:00.000Z",
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("serves every read from the index tables, never the event store", async () => {
    await recordSessionEventIndex(
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

    const tables = new Set(
      queries.flatMap((query) =>
        [...query.matchAll(/\b(?:from|join)\s+"([a-z_]+)"/gi)].map(
          (match) => match[1],
        ),
      ),
    );
    expect([...tables].sort()).toEqual([
      "analytics_event_catalog_daily",
      "analytics_session_event_coverage",
      "analytics_session_events",
      "session_recordings",
    ]);
  });
});
