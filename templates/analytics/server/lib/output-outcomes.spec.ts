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

import {
  MAX_OUTPUTS_PER_RECORDING,
  MIN_PRESENTATION_MS,
  outputUrl,
} from "../../shared/output-use";
import { schema } from "../db/index.js";
import {
  __resetOutputOutcomesForTests,
  aggregateOutputOutcomeRows,
  getSessionRecordingOutputs,
  pruneOutputOutcomes,
  recordLostOutputBatch,
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

describe("outputUrl", () => {
  const pages = (
    firstUrl: string | null,
    lastUrl: string | null = null,
    allowedOrigins = [new URL((firstUrl ?? lastUrl)!).origin],
  ) => ({ firstUrl, lastUrl, allowedOrigins });

  it("links a deck on the host its session was recorded on", () => {
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages("https://slides.example.com/deck/new?x=1"),
      ),
    ).toBe("https://slides.example.com/deck/deck-1");
  });

  it("keeps the mount path of a workspace deploy", () => {
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages("https://team.example.com/slides/home"),
      ),
    ).toBe("https://team.example.com/slides/deck/deck-1");
    expect(
      outputUrl("slides", "deck-1", pages("https://team.example.com/slides")),
    ).toBe("https://team.example.com/slides/deck/deck-1");
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages("https://team.example.com/slideshow/x"),
      ),
    ).toBe("https://team.example.com/deck/deck-1");
  });

  it("keeps the mount when the recording started in another workspace app", () => {
    // The tab moved from Mail into Slides.
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages(
          "https://team.example.com/mail/inbox",
          "https://team.example.com/slides/deck/deck-1",
        ),
      ),
    ).toBe("https://team.example.com/slides/deck/deck-1");
  });

  it("links only to an origin the recording's replay key accepts", () => {
    const allowed = ["https://slides.example.com"];
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages("https://slides.example.com/deck/new", null, allowed),
      ),
    ).toBe("https://slides.example.com/deck/deck-1");
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages(null, "https://slides.example.com/deck/new", allowed),
      ),
    ).toBe("https://slides.example.com/deck/deck-1");
    // An uploader can send any URL, and a key that accepts any origin vouches
    // for none.
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages("https://phish.example.net/deck/new", null, allowed),
      ),
    ).toBeNull();
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages("https://slides.example.com/deck/new", null, []),
      ),
    ).toBeNull();
  });

  it("takes the origin and the mount from the same page", () => {
    const allowed = ["https://one.example.com", "https://two.example.com"];
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages(
          "https://one.example.com/mail/inbox",
          "https://two.example.com/slides/deck/deck-1",
          allowed,
        ),
      ),
    ).toBe("https://two.example.com/slides/deck/deck-1");
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages(
          "https://phish.example.net/deck/new",
          "https://one.example.com/deck/new",
          allowed,
        ),
      ),
    ).toBe("https://one.example.com/deck/deck-1");
    expect(
      outputUrl(
        "slides",
        "deck-1",
        pages(
          "https://one.example.com/deck/new",
          "https://phish.example.net/slides/home",
          allowed,
        ),
      ),
    ).toBe("https://one.example.com/deck/deck-1");
  });
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

  it("counts a presentation from one slide advanced and 30 seconds", () => {
    const usedEvent = (properties: Record<string, unknown>) =>
      aggregateOutputOutcomeRows([
        made("s1", "deck-1"),
        presented("deck-1", "2026-10-02T10:00:00.000Z", properties),
      ]).outcomes[0]?.usedEvent ?? null;
    expect(
      usedEvent({ slides_advanced: 1, duration_ms: MIN_PRESENTATION_MS }),
    ).toBe("presentation_ended");
    expect(
      usedEvent({ slides_advanced: 1, duration_ms: MIN_PRESENTATION_MS - 1 }),
    ).toBeNull();
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
        public_key_id text NOT NULL,
        session_id text NOT NULL,
        owner_email text NOT NULL,
        org_id text,
        visibility text NOT NULL DEFAULT 'private',
        first_url text,
        last_url text,
        started_at text NOT NULL,
        ended_at text,
        last_ingested_at text
      )
    `);
    await client.query(`
      CREATE TABLE analytics_public_keys (
        id text PRIMARY KEY,
        replay_allowed_origins text NOT NULL DEFAULT '[]'
      )
    `);
    await client.query(
      `INSERT INTO analytics_public_keys (id, replay_allowed_origins)
       VALUES ('pk-slides', '["https://slides.example.com"]'), ('pk-any', '[]')`,
    );
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
    owner: {
      ownerEmail?: string;
      orgId?: string | null;
      publicKeyId?: string;
    } = {},
  ) {
    await client.query(
      `INSERT INTO session_recordings (id, public_key_id, session_id, owner_email, org_id, first_url, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        owner.publicKeyId ?? "pk-slides",
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

  it("links no deck from a recording whose replay key accepts any origin", async () => {
    await ingest([made("s1", "deck-1")]);
    await addRecording("r1", "s1", { publicKeyId: "pk-any" });

    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result.outputs.r1).toMatchObject([
      { outputId: "deck-1", status: "unused", url: null },
    ]);
  });

  it("reads a use that came after the window as unused", async () => {
    await ingest([made("s1", "deck-1")]);
    await ingest([exported("deck-1", "2026-10-09T09:00:00.000Z")]);
    await addRecording("r1", "s1");

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual(["r1"]);
  });

  it("counts a use at exactly seven days", async () => {
    await ingest([made("s1", "deck-1")]);
    await ingest([exported("deck-1", "2026-10-08T10:00:00.000Z")]);
    await addRecording("r1", "s1");

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result.outputs.r1?.[0]?.status).toBe("used");
  });

  it("counts a use delivered before its making", async () => {
    await ingest([presented("deck-1", "2026-10-03T10:00:00.000Z")]);
    await ingest([made("s1", "deck-1")]);
    await addRecording("r1", "s1");

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result.outputs.r1).toMatchObject([
      { status: "used", usedAt: "2026-10-03T10:00:00.000Z" },
    ]);
  });

  it("reads a batch delivered twice the same as once", async () => {
    const batch = [
      made("s1", "deck-1"),
      presented("deck-1", "2026-10-03T10:00:00.000Z"),
    ];
    await ingest(batch);
    await ingest(batch);
    await addRecording("r1", "s1");

    const rows = await client.query(
      "SELECT count(*)::int AS count FROM analytics_output_outcomes",
    );
    expect(rows.rows[0].count).toBe(1);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result.outputs.r1?.[0]?.status).toBe("used");
  });

  it("keeps two tenants' decks with the same id apart", async () => {
    const other = { ownerEmail: "other@example.com", orgId: "org_2" };
    await ingest([made("s1", "deck-1"), made("s2", "deck-1", MADE, other)]);
    await ingest([
      { ...presented("deck-1", "2026-10-03T10:00:00.000Z"), ...other },
    ]);
    await addRecording("r1", "s1");
    await addRecording("r2", "s2", other);

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual(["r1"]);
    expect(
      await unusedRecordings(AFTER_WINDOW, {
        userEmail: other.ownerEmail,
        orgId: other.orgId,
      }),
    ).toEqual([]);
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

  it("reads a deck whose use was in a batch ingest lost as unmeasured, never unused", async () => {
    await ingest([made("s1", "deck-1")]);
    await addRecording("r1", "s1");
    // The tracker does not resend a batch the server failed to store.
    await recordLostOutputBatch(
      db,
      [exported("deck-1", "2026-10-03T10:00:00.000Z")],
      "2026-10-03T10:00:01.000Z",
    );

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    expect(result.outputs.r1?.[0]?.status).toBe("unmeasured");
  });

  it("reads a recording a lost batch overlapped as unknown and never matches it", async () => {
    // r-known made an unused deck after a batch earlier in its recording was
    // lost; r-lost's only making was in that batch; r-clear recorded later.
    await ingest([
      made("s-known", "deck-known", "2026-10-01T10:20:00.000Z"),
      made("s-clear", "deck-clear", "2026-10-01T11:10:00.000Z"),
    ]);
    await recordLostOutputBatch(
      db,
      [made("s-lost", "deck-lost", "2026-10-01T10:05:00.000Z")],
      "2026-10-01T10:05:01.000Z",
    );
    await addRecording("r-lost", "s-lost");
    await addRecording("r-known", "s-known");
    await addRecording("r-clear", "s-clear");
    await client.query(
      `UPDATE session_recordings SET ended_at = '2026-10-01T10:30:00.000Z'
       WHERE id IN ('r-lost', 'r-known')`,
    );
    await client.query(
      `UPDATE session_recordings
       SET started_at = '2026-10-01T11:00:00.000Z', ended_at = '2026-10-01T11:30:00.000Z'
       WHERE id = 'r-clear'`,
    );

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual(["r-clear"]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r-lost", "r-known", "r-clear"],
      AFTER_WINDOW,
    );
    expect(result.outputs["r-lost"]).toBeNull();
    expect(result.outputs["r-known"]).toBeNull();
    expect(result.outputs["r-clear"]).toMatchObject([
      { outputId: "deck-clear", status: "unused" },
    ]);
  });

  it("records one gap for a lost span however often it is reported", async () => {
    const lost = [exported("deck-1", "2026-10-03T10:00:00.000Z")];
    await recordLostOutputBatch(db, lost, "2026-10-03T10:00:01.000Z");
    await recordLostOutputBatch(db, lost, "2026-10-03T10:05:00.000Z");

    const gaps = await client.query(
      "SELECT count(*)::int AS count FROM analytics_output_outcome_gaps",
    );
    expect(gaps.rows[0].count).toBe(1);
  });

  it("records nothing for a lost batch no rule reads", async () => {
    await recordLostOutputBatch(
      db,
      [event("pageview", "s1", "2026-10-03T10:00:00.000Z", {})],
      "2026-10-03T10:00:01.000Z",
    );

    const gaps = await client.query(
      "SELECT count(*)::int AS count FROM analytics_output_outcome_gaps",
    );
    expect(gaps.rows[0].count).toBe(0);
  });

  it("lists a session's unused deck first when it made more than a recording lists", async () => {
    const decks = Array.from(
      { length: MAX_OUTPUTS_PER_RECORDING + 1 },
      (_, i) => `deck-${String(i).padStart(2, "0")}`,
    );
    const madeAt = (i: number) =>
      new Date(Date.parse(MADE) + i * 60_000).toISOString();
    await ingest(decks.map((deck, i) => made("s1", deck, madeAt(i))));
    // Every deck but the newest is used.
    await ingest(
      decks
        .slice(0, -1)
        .map((deck) => presented(deck, "2026-10-03T10:00:00.000Z")),
    );
    await addRecording("r1", "s1");

    expect(await unusedRecordings(AFTER_WINDOW)).toEqual(["r1"]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    const listed = result.outputs.r1 ?? [];
    expect(listed).toHaveLength(MAX_OUTPUTS_PER_RECORDING);
    expect(listed.filter((output) => output.status === "unused")).toEqual([
      expect.objectContaining({ outputId: decks[decks.length - 1] }),
    ]);
    expect(listed.map((output) => output.madeAt)).toEqual(
      [...listed.map((output) => output.madeAt)].sort(),
    );
    expect(result.omittedOutputs).toEqual({ r1: 1 });
  });

  it("caps and counts a recording's outputs across the sessions it observed", async () => {
    const madeAt = (i: number) =>
      new Date(Date.parse(MADE) + i * 60_000).toISOString();
    const decks = (session: string) =>
      Array.from({ length: 6 }, (_, i) => `${session}-deck-${i}`);
    await ingest([
      ...decks("s-a").map((deck, i) => made("s-a", deck, madeAt(i))),
      ...decks("s-b").map((deck, i) => made("s-b", deck, madeAt(i + 6))),
    ]);
    // Only s-b's newest deck goes unused.
    await ingest(
      [...decks("s-a"), ...decks("s-b").slice(0, -1)].map((deck) =>
        presented(deck, "2026-10-03T10:00:00.000Z"),
      ),
    );
    await addRecording("r1", "s-a");
    for (const sessionId of ["s-a", "s-b"]) {
      await client.query(
        `INSERT INTO session_recording_session_associations (id, recording_id, session_id)
         VALUES ($1, 'r1', $2)`,
        [`association-${sessionId}`, sessionId],
      );
    }

    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r1"],
      AFTER_WINDOW,
    );
    const listed = result.outputs.r1 ?? [];
    expect(listed).toHaveLength(MAX_OUTPUTS_PER_RECORDING);
    expect(listed.filter((output) => output.status === "unused")).toMatchObject(
      [{ outputId: "s-b-deck-5" }],
    );
    expect(result.omittedOutputs).toEqual({ r1: 2 });
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
      outputs: { r1: [] },
      omittedOutputs: {},
      coverageStartedAt: "2026-10-01T12:00:00.000Z",
    });
  });

  it("reads a recording as unknown until its own tenant tracks outputs", async () => {
    // The org tenant has started tracking; the viewer's personal one has not.
    await ingest([made("s1", "deck-1")]);
    await addRecording("r-org", "s-made-nothing");
    await addRecording("r-personal", "s-personal", { orgId: null });

    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r-org", "r-personal"],
      AFTER_WINDOW,
    );
    expect(result.outputs).toEqual({ "r-org": [], "r-personal": null });
    expect(result.coverageStartedAt).toBe("2026-09-30T00:00:00.000Z");
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

    expect(
      await unusedRecordings(AFTER_WINDOW, {
        userEmail: other.ownerEmail,
        orgId: other.orgId,
      }),
    ).toEqual(["r-other"]);
    expect(await unusedRecordings(AFTER_WINDOW)).toEqual([]);
    const result = await getSessionRecordingOutputs(
      SCOPE,
      ["r-other"],
      AFTER_WINDOW,
    );
    // Recordings honor user shares only inside the viewer's org, so this
    // cross-org share grants nothing to read.
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
    ).toEqual({
      outputs: { r1: null },
      omittedOutputs: {},
      coverageStartedAt: null,
    });
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

  it("keeps a gap while an output it overlaps is kept", async () => {
    const now = new Date("2026-12-31T00:00:00.000Z");
    const daysAgo = (days: number) =>
      new Date(now.getTime() - days * 86_400_000).toISOString();
    await ingest([made("s1", "deck-1", daysAgo(60))]);
    // A use long after the window keeps the row without making it used.
    await ingest([exported("deck-1", daysAgo(1))]);
    const tenant = sessionEventTenantKey(OWNER, ORG);
    await db.execute(
      sql`INSERT INTO analytics_output_outcome_gaps (id, tenant_key, owner_email, org_id, first_at, last_at, recorded_at)
          VALUES ('gap-overlapping', ${tenant}, ${OWNER}, ${ORG}, ${daysAgo(58)}, ${daysAgo(57)}, ${daysAgo(57)}),
                 ('gap-unrelated', ${tenant}, ${OWNER}, ${ORG}, ${daysAgo(100)}, ${daysAgo(99)}, ${daysAgo(99)})`,
    );

    expect(await pruneOutputOutcomes(30, now)).toEqual({ outputs: 0 });
    const gaps = await client.query(
      "SELECT id FROM analytics_output_outcome_gaps ORDER BY id",
    );
    expect(gaps.rows).toEqual([{ id: "gap-overlapping" }]);
    await addRecording("r1", "s1");
    const result = await getSessionRecordingOutputs(SCOPE, ["r1"], now);
    expect(result.outputs.r1?.[0]?.status).toBe("unmeasured");
  });
});
