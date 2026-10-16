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
  __resetOutputOutcomesForTests,
  aggregateOutputOutcomeRows,
  getSessionRecordingOutputs,
  pruneOutputOutcomes,
  recordOutputOutcomes,
  unusedOutputConditions,
} from "./output-outcomes";
import {
  sessionEventTenantKey,
  type SessionEventIndexInputRow,
} from "./session-event-index";

function migrationSql(pattern: RegExp, name: string): string[] {
  // source-read-ok: runs the migration's SQL against PGlite; nothing asserts on the text.
  const source = readFileSync(
    new URL("../plugins/db.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(pattern);
  if (!match) throw new Error(`${name} migration not found`);
  return match[1]
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const outputOutcomesMigrationSql = () =>
  migrationSql(
    /name: "analytics-output-outcomes",[\s\S]*?postgres: `([\s\S]*?)`/,
    "output outcomes",
  );
const associationsMigrationSql = () =>
  migrationSql(
    /name: "session-recording-session-associations",\s*sql: `([\s\S]*?)`/,
    "session recording session associations",
  );

const OWNER = "owner@example.com";
const ORG = "org_1";
const SCOPE = { userEmail: OWNER, orgId: ORG };
const MADE = "2026-10-01T10:00:00.000Z";
const AFTER_WINDOW = new Date("2026-10-09T10:00:00.000Z");
const INSIDE_WINDOW = new Date("2026-10-05T10:00:00.000Z");

function event(
  eventName: string,
  sessionId: string | null,
  timestamp: string,
  properties: Record<string, unknown>,
  overrides: Partial<SessionEventIndexInputRow> = {},
): SessionEventIndexInputRow {
  return {
    eventName,
    sessionId,
    timestamp,
    eventDate: timestamp.slice(0, 10),
    app: "slides",
    properties: JSON.stringify(properties),
    ownerEmail: OWNER,
    orgId: ORG,
    ...overrides,
  };
}

const made = (
  sessionId: string | null,
  outputId: string,
  timestamp = MADE,
  overrides: Partial<SessionEventIndexInputRow> = {},
) =>
  event(
    "generation_completed",
    sessionId,
    timestamp,
    { output_id: outputId, output_type: "deck" },
    overrides,
  );

const presented = (
  outputId: string,
  timestamp: string,
  properties: Record<string, unknown> = {},
) =>
  event("presentation_ended", "later-session", timestamp, {
    output_id: outputId,
    slides_advanced: 3,
    duration_ms: 45_000,
    ...properties,
  });

const exported = (
  outputId: string,
  timestamp: string,
  properties: Record<string, unknown> = {},
) =>
  event("deck_exported", "later-session", timestamp, {
    output_id: outputId,
    status: "completed",
    slide_count: 4,
    ...properties,
  });

describe("aggregateOutputOutcomeRows", () => {
  it("counts only a real presentation or a finished export of a deck with slides", () => {
    const { outcomes } = aggregateOutputOutcomeRows([
      made("s1", "deck-1"),
      // A quick look, a presentation that never moved, a failed export, and
      // an export of an empty deck are not uses.
      presented("deck-1", "2026-10-02T10:00:00.000Z", { duration_ms: 5_000 }),
      presented("deck-1", "2026-10-02T11:00:00.000Z", { slides_advanced: 0 }),
      exported("deck-1", "2026-10-02T12:00:00.000Z", { status: "failed" }),
      exported("deck-1", "2026-10-02T13:00:00.000Z", { slide_count: 0 }),
      presented("deck-1", "2026-10-02T14:00:00.000Z", {
        duration_ms: "45000",
      }),
      exported("deck-1", "2026-10-03T10:00:00.000Z"),
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      app: "slides",
      outputType: "deck",
      outputId: "deck-1",
      madeAt: MADE,
      useBy: "2026-10-08T10:00:00.000Z",
      madeSessionId: "s1",
      firstUsedAt: "2026-10-03T10:00:00.000Z",
      usedEvent: "deck_exported",
    });
  });

  it("keeps the earliest making with its session", () => {
    const { outcomes } = aggregateOutputOutcomeRows([
      made("s-late", "deck-1", "2026-10-02T10:00:00.000Z"),
      made("s-early", "deck-1", MADE),
    ]);
    expect(outcomes[0]).toMatchObject({
      madeAt: MADE,
      madeSessionId: "s-early",
    });
  });

  it("covers every tenant that sent a rule's event, even without an output id", () => {
    const { outcomes, tenants } = aggregateOutputOutcomeRows([
      event("generation_completed", "s1", MADE, { output_type: "deck" }),
      // Design has no "used it" rule, so its outputs are not tracked.
      made("s2", "design-1", MADE, {
        app: "design",
        ownerEmail: "designer@example.com",
        orgId: "org_2",
      }),
    ]);
    expect(outcomes).toEqual([]);
    expect(tenants.map((tenant) => tenant.tenantKey)).toEqual([
      sessionEventTenantKey(OWNER, ORG),
    ]);
  });

  it("fails loudly on properties ingest could not have written", () => {
    expect(() =>
      aggregateOutputOutcomeRows([
        { ...made("s1", "deck-1"), properties: "{" },
      ]),
    ).toThrow();
  });
});

describe("output outcomes on Postgres", () => {
  let client: PGliteClient;
  let db: any;

  beforeEach(async () => {
    __resetOutputOutcomesForTests();
    client = await PGlite.create("memory://");
    for (const statement of outputOutcomesMigrationSql()) {
      await client.query(statement);
    }
    await client.query(`
      CREATE TABLE session_recordings (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        owner_email text NOT NULL,
        org_id text,
        visibility text NOT NULL DEFAULT 'private',
        first_url text,
        started_at text NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE session_recording_shares (
        id text PRIMARY KEY,
        resource_id text NOT NULL,
        principal_type text NOT NULL,
        principal_id text NOT NULL,
        role text NOT NULL DEFAULT 'viewer'
      )
    `);
    for (const statement of associationsMigrationSql()) {
      await client.query(statement);
    }
    db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
  });

  afterEach(async () => {
    await client.close();
  });

  async function ingest(
    rows: SessionEventIndexInputRow[],
    receivedAt = "2026-09-30T00:00:00.000Z",
  ) {
    await db.transaction(async (tx: any) => {
      await recordOutputOutcomes(tx, rows, receivedAt);
    });
  }

  async function addRecording(
    id: string,
    sessionId: string,
    owner: { ownerEmail?: string; orgId?: string | null } = {},
  ) {
    await client.query(
      `INSERT INTO session_recordings (id, session_id, owner_email, org_id, first_url, started_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        sessionId,
        owner.ownerEmail ?? OWNER,
        owner.orgId === undefined ? ORG : owner.orgId,
        "https://slides.example.com/deck/new?x=1",
        MADE,
      ],
    );
  }

  async function unusedRecordings(
    now: Date,
    viewer: { userEmail: string; orgId: string | null } = SCOPE,
  ): Promise<string[]> {
    const r = schema.sessionRecordings;
    const rows = await db
      .select({ id: r.id })
      .from(r)
      .where(and(...(await unusedOutputConditions(viewer, "slides", now))))
      .orderBy(asc(r.id));
    return rows.map((row: { id: string }) => row.id);
  }

  async function failInsertsInto(table: string) {
    await client.query(
      "CREATE OR REPLACE FUNCTION fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'insert failed'; END $$",
    );
    await client.query(
      `CREATE TRIGGER fail_insert BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_insert()`,
    );
  }

  it("finds a deck no one used once its window closes, and only then", async () => {
    await ingest([
      made("s-unused", "deck-unused"),
      made("s-used", "deck-used"),
    ]);
    await ingest([presented("deck-used", "2026-10-03T10:00:00.000Z")]);
    await addRecording("r-unused", "s-unused");
    await addRecording("r-used", "s-used");

    expect(await unusedRecordings(INSIDE_WINDOW)).toEqual([]);
    expect(await unusedRecordings(AFTER_WINDOW)).toEqual(["r-unused"]);

    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r-unused", "r-used"],
      AFTER_WINDOW,
    );
    expect(result.coverageStartedAt).toBe("2026-09-30T00:00:00.000Z");
    expect(result.outputs["r-unused"]).toEqual([
      {
        app: "slides",
        outputType: "deck",
        outputId: "deck-unused",
        madeAt: MADE,
        useBy: "2026-10-08T10:00:00.000Z",
        status: "unused",
        usedEvent: null,
        usedAt: null,
        url: "https://slides.example.com/deck/deck-unused",
      },
    ]);
    expect(result.outputs["r-used"]).toMatchObject([
      {
        status: "used",
        usedEvent: "presentation_ended",
        usedAt: "2026-10-03T10:00:00.000Z",
      },
    ]);
    const open = await getSessionRecordingOutputs(
      SCOPE,
      ["r-unused"],
      INSIDE_WINDOW,
    );
    expect(open.outputs["r-unused"]?.[0]?.status).toBe("open");
  });

  it("reads a use that came after the window as unused", async () => {
    await ingest([made("s1", "deck-1")]);
    await ingest([exported("deck-1", "2026-10-09T09:00:00.000Z")]);
    await addRecording("r1", "s1");

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual(["r1"]);
  });

  it("merges batches that arrive out of order", async () => {
    await ingest([made("s-late", "deck-1", "2026-10-02T10:00:00.000Z")]);
    await ingest([presented("deck-1", "2026-10-09T09:30:00.000Z")]);
    // An earlier making and an earlier use arrive last.
    await ingest([made("s-early", "deck-1", MADE)]);
    await ingest([exported("deck-1", "2026-10-07T10:00:00.000Z")]);

    const rows = (
      await client.query(
        "SELECT made_at, use_by, made_session_id, first_used_at, used_event FROM analytics_output_outcomes",
      )
    ).rows;
    expect(rows).toEqual([
      {
        made_at: MADE,
        use_by: "2026-10-08T10:00:00.000Z",
        made_session_id: "s-early",
        first_used_at: "2026-10-07T10:00:00.000Z",
        used_event: "deck_exported",
      },
    ]);
  });

  it("finds a recording through any session it observed", async () => {
    await ingest([made("s-second-tab", "deck-1")]);
    await addRecording("r1", "s-first-tab");
    for (const sessionId of ["s-first-tab", "s-second-tab"]) {
      await client.query(
        `INSERT INTO session_recording_session_associations (id, recording_id, session_id)
         VALUES ($1, 'r1', $2)`,
        [`association-${sessionId}`, sessionId],
      );
    }

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual(["r1"]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result.outputs.r1?.map((output) => output.outputId)).toEqual([
      "deck-1",
    ]);
  });

  it("reads a deck whose window overlaps a failed write as unmeasured, never unused", async () => {
    await ingest([made("s1", "deck-1")]);
    await addRecording("r1", "s1");
    await failInsertsInto("analytics_output_outcomes");
    // The lost batch could have held the deck's use.
    await ingest([exported("deck-1", "2026-10-03T10:00:00.000Z")]);

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result.outputs.r1?.[0]?.status).toBe("unmeasured");
  });

  it("skips decks made before output tracking began", async () => {
    await ingest([made("s1", "deck-1")], "2026-10-01T12:00:00.000Z");
    await addRecording("r1", "s1");

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result).toEqual({
      outputs: {},
      coverageStartedAt: "2026-10-01T12:00:00.000Z",
    });
  });

  it("never reads a shared recording's tenant outputs", async () => {
    const other = { ownerEmail: "other@example.com", orgId: "org_2" };
    await ingest([made("s-other", "deck-other", MADE, other)]);
    await addRecording("r-other", "s-other", other);
    await client.query(
      `INSERT INTO session_recording_shares (id, resource_id, principal_type, principal_id)
       VALUES ('share', 'r-other', 'user', $1)`,
      [OWNER],
    );

    expect(await unusedRecordings(AFTER_WINDOW, other)).toEqual(["r-other"]);
    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r-other"],
      AFTER_WINDOW,
    );
    expect(result.outputs).toEqual({});
  });

  it("matches nothing and reports no coverage before the migration runs", async () => {
    await client.query("DROP TABLE analytics_output_outcome_coverage");
    await addRecording("r1", "s1");
    // Ingest still succeeds; the events are stored without outcomes.
    await ingest([made("s1", "deck-1")]);

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    expect(
      await getSessionRecordingOutputs(SCOPE, ["r1"], AFTER_WINDOW),
    ).toEqual({ outputs: {}, coverageStartedAt: null });
  });

  it("prunes outcomes only after their replays and use window expire", async () => {
    const now = new Date("2026-12-31T00:00:00.000Z");
    const daysAgo = (days: number) =>
      new Date(now.getTime() - days * 86_400_000).toISOString();
    await ingest([
      made("s-old", "deck-old", daysAgo(40)),
      made("s-kept", "deck-kept", daysAgo(38)),
    ]);
    await db.execute(
      sql`INSERT INTO analytics_output_outcome_gaps (id, tenant_key, owner_email, org_id, first_at, last_at, recorded_at)
          VALUES ('gap-old', 'tenant', ${OWNER}, ${ORG}, ${daysAgo(41)}, ${daysAgo(40)}, ${daysAgo(40)})`,
    );

    // 30 days of replays + the 7-day window + 2 days of slack.
    const result = await pruneOutputOutcomes(30, now);

    expect(result).toEqual({ outputs: 1 });
    const kept = await client.query(
      "SELECT output_id FROM analytics_output_outcomes ORDER BY output_id",
    );
    expect(kept.rows).toEqual([{ output_id: "deck-kept" }]);
    const gaps = await client.query(
      "SELECT count(*)::int AS count FROM analytics_output_outcome_gaps",
    );
    expect(gaps.rows[0].count).toBe(0);
  });
});
