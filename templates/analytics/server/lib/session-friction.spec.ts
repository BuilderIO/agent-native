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
  EVENT_FRICTION_SCORE_INPUTS,
  REPLAY_FRICTION_SCORE_INPUTS,
  SESSION_FRICTION_WEIGHTS,
  sessionFrictionScore,
  type SessionFrictionSignal,
  type SessionFrictionSort,
} from "../../shared/session-friction.js";
import { SESSION_REPLAY_NETWORK_EVENT_TAG } from "../../shared/session-replay-diagnostics.js";
import { schema } from "../db/index.js";
import {
  __resetSessionEventIndexForTests,
  recordSessionEventIndex,
  sessionEventTenantKey,
  type SessionEventIndexInputRow,
} from "./session-event-index";
import {
  __resetSessionFrictionForTests,
  aggregateSessionFrictionEvents,
  getSessionFrictionDetails,
  QUICK_BACK_WINDOW_MS,
  recordReplayFriction,
  sessionFrictionFilterConditions,
  sessionFrictionSortOrder,
} from "./session-friction";

/** Migration DDL comes straight from db.ts so the tests track it. */
function migrationSql(name: string): string[] {
  const source = readFileSync(
    new URL("../plugins/db.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(
    new RegExp(`name: "${name}",\\s*sql: \\{\\s*postgres: \`([\\s\\S]*?)\``),
  );
  if (!match) throw new Error(`${name} migration not found`);
  return match[1]
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const OWNER = "owner@example.com";
const ORG = "org_1";
const SCOPE = { userEmail: OWNER, orgId: ORG };
const TENANT = sessionEventTenantKey(OWNER, ORG);

async function createBaseTables(client: PGliteClient) {
  for (const statement of migrationSql("analytics-session-event-index")) {
    await client.query(statement);
  }
  await client.query(`
    CREATE TABLE session_recordings (
      id text PRIMARY KEY,
      client_recording_id text NOT NULL,
      session_id text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      visibility text NOT NULL DEFAULT 'private',
      started_at text NOT NULL,
      chunk_count integer NOT NULL DEFAULT 0
    )
  `);
  await client.query(`
    CREATE TABLE error_issues (
      id text PRIMARY KEY,
      title text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      visibility text NOT NULL DEFAULT 'private'
    )
  `);
  await client.query(`
    CREATE TABLE error_issue_shares (
      id text PRIMARY KEY,
      resource_id text NOT NULL,
      principal_type text NOT NULL,
      principal_id text NOT NULL,
      role text NOT NULL DEFAULT 'viewer'
    )
  `);
  await client.query(`
    CREATE TABLE error_events (
      id text PRIMARY KEY,
      issue_id text NOT NULL,
      session_recording_id text,
      client_recording_id text,
      owner_email text NOT NULL,
      org_id text
    )
  `);
}

async function migrateFriction(client: PGliteClient) {
  for (const statement of migrationSql("analytics-session-friction")) {
    await client.query(statement);
  }
}

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

const at = (seconds: number) =>
  new Date(Date.UTC(2026, 8, 20, 10, 0, seconds)).toISOString();

function pageview(sessionId: string, seconds: number, path: string) {
  return event({
    eventName: "pageview",
    sessionId,
    timestamp: at(seconds),
    properties: JSON.stringify({ path }),
  });
}

function runOutcome(
  sessionId: string,
  seconds: number,
  properties: Record<string, unknown>,
) {
  return event({
    eventName: "agent_run_outcome",
    sessionId,
    timestamp: at(seconds),
    properties: JSON.stringify(properties),
  });
}

function actionResponse(
  sessionId: string,
  seconds: number,
  properties: Record<string, unknown>,
) {
  return event({
    eventName: "action.response",
    sessionId,
    timestamp: at(seconds),
    properties: JSON.stringify(properties),
  });
}

describe("aggregateSessionFrictionEvents", () => {
  it("counts a fast return to the previous page as a quick back", () => {
    const { sessions } = aggregateSessionFrictionEvents(
      [
        pageview("s1", 0, "/a"),
        pageview("s1", 10, "/b"),
        pageview("s1", 12, "/a"),
        // Back again each time, but only after reading the page for a while.
        pageview("s1", 12 + QUICK_BACK_WINDOW_MS / 1000 + 1, "/b"),
        pageview("s1", 2 * (QUICK_BACK_WINDOW_MS / 1000 + 1) + 12, "/a"),
      ],
      new Map(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ quickBacks: 1 });
    expect(sessions[0]!.navState).not.toContain("/a");
  });

  it("continues navigation from the state an earlier batch stored", () => {
    const first = aggregateSessionFrictionEvents(
      [pageview("s1", 0, "/a"), pageview("s1", 10, "/b")],
      new Map(),
    );
    const id = first.sessions[0]!.id;
    const second = aggregateSessionFrictionEvents(
      [pageview("s1", 12, "/a")],
      new Map([[id, first.sessions[0]!.navState ?? null]]),
    );
    expect(second.sessions[0]).toMatchObject({ quickBacks: 1 });
  });

  it("groups failed actions by name and status, and skips cancelled ones", () => {
    const { sessions, troubles } = aggregateSessionFrictionEvents(
      [
        actionResponse("s1", 1, {
          action: "save-deck",
          success: false,
          status_code: 500,
        }),
        actionResponse("s1", 2, {
          action: "save-deck",
          success: false,
          status_code: 500,
        }),
        actionResponse("s1", 3, {
          action: "save-deck",
          success: false,
          status_code: 409,
        }),
        actionResponse("s1", 4, {
          action: "save-deck",
          success: false,
          outcome: "cancelled",
        }),
        actionResponse("s1", 5, { action: "save-deck", success: true }),
      ],
      new Map(),
    );
    expect(sessions[0]).toMatchObject({ failedActions: 3 });
    expect(
      troubles
        .map(({ kind, label, status, eventCount }) => ({
          kind,
          label,
          status,
          eventCount,
        }))
        .sort((a, b) => b.eventCount! - a.eventCount!),
    ).toEqual([
      { kind: "action", label: "save-deck", status: "500", eventCount: 2 },
      { kind: "action", label: "save-deck", status: "409", eventCount: 1 },
    ]);
  });

  it("names agent failures by cause, from the event or its code", () => {
    const { sessions, troubles } = aggregateSessionFrictionEvents(
      [
        runOutcome("s1", 1, {
          outcome: "failed",
          code: "http_429",
          cause: "rate_limit",
        }),
        // An older recorder sends only the code.
        runOutcome("s1", 2, { outcome: "failed", code: "http_429" }),
        runOutcome("s1", 3, {
          outcome: "interrupted",
          code: "missing_credentials",
        }),
        // A cause outside the approved list is not trusted.
        runOutcome("s1", 4, {
          outcome: "failed",
          code: "runtime_error",
          cause: "made_up",
          error_message: "Tool <text> failed after <n> tries",
        }),
      ],
      new Map(),
    );
    expect(sessions[0]).toMatchObject({ agentFailures: 4 });
    expect(
      troubles
        .map(({ label, cause, eventCount }) => ({ label, cause, eventCount }))
        .sort(
          (a, b) =>
            b.eventCount! - a.eventCount! || (a.label < b.label ? -1 : 1),
        ),
    ).toEqual([
      { label: "rate_limit", cause: "rate_limit", eventCount: 2 },
      {
        label: "Tool <text> failed after <n> tries",
        cause: null,
        eventCount: 1,
      },
      {
        label: "no_model_connected",
        cause: "no_model_connected",
        eventCount: 1,
      },
    ]);
  });

  it("groups unnamed agent failures by their normalized message", () => {
    const { troubles } = aggregateSessionFrictionEvents(
      [
        runOutcome("s1", 1, {
          outcome: "failed",
          code: "runtime_error",
          error_message: "Tool 'search' failed after 3 tries",
        }),
        runOutcome("s1", 2, {
          outcome: "failed",
          code: "runtime_error",
          error_message: "Tool 'fetch' failed after 5 tries",
        }),
      ],
      new Map(),
    );
    expect(troubles).toHaveLength(1);
    expect(troubles[0]).toMatchObject({
      label: "Tool <text> failed after <n> tries",
      eventCount: 2,
    });
  });

  it("counts stopped runs, stuck chats, and only negative feedback", () => {
    const { sessions, troubles } = aggregateSessionFrictionEvents(
      [
        runOutcome("s1", 1, { outcome: "stopped" }),
        runOutcome("s1", 2, { outcome: "succeeded" }),
        event({
          eventName: "agent_chat_stuck_detected",
          sessionId: "s1",
          timestamp: at(3),
        }),
        event({
          eventName: "agent_feedback_submitted",
          sessionId: "s1",
          timestamp: at(4),
          properties: JSON.stringify({ sentiment: "negative" }),
        }),
        event({
          eventName: "agent_feedback_submitted",
          sessionId: "s1",
          timestamp: at(5),
          properties: JSON.stringify({ sentiment: "positive" }),
        }),
      ],
      new Map(),
    );
    expect(sessions[0]).toMatchObject({
      cancelledRuns: 1,
      stuckChats: 1,
      thumbsDown: 1,
      agentFailures: 0,
    });
    expect(troubles).toEqual([]);
  });

  it("gives every session in the batch a row, even with nothing to count", () => {
    const { sessions } = aggregateSessionFrictionEvents(
      [event({ eventName: "clip_viewed", sessionId: "s1", timestamp: at(1) })],
      new Map(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ score: 0, failedActions: 0 });
  });

  it("refuses navigation state it cannot read", () => {
    const first = aggregateSessionFrictionEvents(
      [pageview("s1", 0, "/a")],
      new Map(),
    );
    expect(() =>
      aggregateSessionFrictionEvents(
        [pageview("s1", 1, "/b")],
        new Map([[first.sessions[0]!.id, "{"]]),
      ),
    ).toThrow();
  });
});

describe("session friction on Postgres", () => {
  let client: PGliteClient;
  let db: any;

  beforeEach(async () => {
    __resetSessionEventIndexForTests();
    __resetSessionFrictionForTests();
    client = await PGlite.create("memory://");
    await createBaseTables(client);
    db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
  });

  afterEach(async () => {
    await client.close();
  });

  async function index(rows: SessionEventIndexInputRow[], receivedAt: string) {
    await db.transaction((tx: any) =>
      recordSessionEventIndex(tx, rows, receivedAt),
    );
  }

  async function addRecording(
    id: string,
    sessionId: string,
    startedAt: string,
    chunkCount = 0,
  ) {
    await client.query(
      `INSERT INTO session_recordings (id, client_recording_id, session_id, owner_email, org_id, started_at, chunk_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, `client-${id}`, sessionId, OWNER, ORG, startedAt, chunkCount],
    );
  }

  function recordingInput(id: string, sessionId: string, chunkCount = 0) {
    return {
      id,
      clientRecordingId: `client-${id}`,
      sessionId,
      chunkCount,
      ownerEmail: OWNER,
      orgId: ORG,
      errorCount: 0,
      rageClickCount: 0,
    };
  }

  async function replayBatch(
    recordingId: string,
    sessionId: string,
    priorChunkCount: number,
    events: unknown[],
  ) {
    await recordReplayFriction({
      recordingId,
      sessionId,
      ownerEmail: OWNER,
      orgId: ORG,
      priorChunkCount,
      newChunks: [
        { seq: priorChunkCount, inlineData: JSON.stringify({ events }) },
      ],
      errorCount: 0,
      rageClickCount: 0,
      ingestedAt: at(0),
    });
  }

  const deadClick = (timestamp: number) => [
    { type: 3, timestamp, data: { source: 2, type: 2, id: 7 } },
    { type: 3, timestamp: timestamp + 2_000, data: { source: 1 } },
  ];
  const serverError = (timestamp: number) => ({
    type: 5,
    timestamp,
    data: {
      tag: SESSION_REPLAY_NETWORK_EVENT_TAG,
      payload: { method: "POST", url: "/api/save", status: 503, ok: false },
    },
  });

  async function matching(signals: SessionFrictionSignal[]) {
    const r = schema.sessionRecordings;
    const rows = await db
      .select({ id: r.id })
      .from(r)
      .where(and(...(await sessionFrictionFilterConditions(signals))))
      .orderBy(asc(r.id));
    return rows.map((row: { id: string }) => row.id);
  }

  async function sorted(sort: SessionFrictionSort) {
    const r = schema.sessionRecordings;
    const order = await sessionFrictionSortOrder(sort);
    if (!order) return null;
    const rows = await db
      .select({ id: r.id })
      .from(r)
      .orderBy(order, asc(r.id));
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

  it("stores batches and reports nothing measured before the migration", async () => {
    await index(
      [
        actionResponse("s1", 1, { action: "save", success: false }),
        pageview("s1", 2, "/a"),
      ],
      at(0),
    );
    await replayBatch("r1", "s1", 0, deadClick(1_000));
    await addRecording("r1", "s1", at(5), 1);

    const indexed = await client.query(
      "SELECT event_name FROM analytics_session_events ORDER BY event_name",
    );
    expect(indexed.rows.map((row: any) => row.event_name)).toEqual([
      "action.response",
      "pageview",
    ]);
    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1", 1),
    ]);
    expect(details.get("r1")).toEqual({
      score: null,
      replay: null,
      events: null,
      topSignals: [],
      troubles: [],
      errorIssues: null,
    });
    expect(await matching(["failed_actions"])).toEqual([]);
    expect(await sorted("friction")).toBeNull();
  });

  it("tells a session with no friction apart from one it never measured", async () => {
    await migrateFriction(client);
    // r-before's session started before coverage, so its earlier events are unknown.
    await addRecording("r-before", "s-before", at(0));
    await index(
      [
        pageview("s-calm", 11, "/a"),
        event({
          eventName: "clip_viewed",
          sessionId: "s-before",
          timestamp: at(12),
        }),
      ],
      at(10),
    );
    await addRecording("r-calm", "s-calm", at(10));
    await addRecording("r-unseen", "s-unseen", at(20));

    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-calm", "s-calm"),
      recordingInput("r-before", "s-before"),
      recordingInput("r-unseen", "s-unseen"),
    ]);
    expect(details.get("r-calm")).toMatchObject({
      score: 0,
      replay: null,
      events: {
        agent_failures: 0,
        stuck_chats: 0,
        thumbs_down: 0,
        failed_actions: 0,
        quick_backs: 0,
        cancelled_runs: 0,
      },
      topSignals: [],
      errorIssues: [],
    });
    for (const id of ["r-before", "r-unseen"]) {
      expect(details.get(id)).toMatchObject({
        score: null,
        replay: null,
        events: null,
      });
    }
  });

  it("leaves a session unmeasured once a friction write for it failed", async () => {
    await migrateFriction(client);
    await index([pageview("s-ok", 1, "/a")], at(0));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failInsertsInto("analytics_session_friction");
    await index(
      [actionResponse("s-gap", 6, { action: "save", success: false })],
      at(5),
    );
    await client.query(
      "DROP TRIGGER fail_insert ON analytics_session_friction",
    );
    warn.mockRestore();
    await index([pageview("s-gap", 8, "/a")], at(7));
    await addRecording("r-ok", "s-ok", at(0));
    await addRecording("r-gap", "s-gap", at(4));

    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-ok", "s-ok"),
      recordingInput("r-gap", "s-gap"),
    ]);
    expect(details.get("r-ok")?.events).not.toBeNull();
    expect(details.get("r-gap")?.events).toBeNull();
  });

  it("measures replay batches in order and stops at a batch it missed", async () => {
    await migrateFriction(client);
    await addRecording("r1", "s1", at(0), 1);
    await replayBatch("r1", "s1", 0, [...deadClick(1_000), serverError(5_000)]);
    let details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1", 1),
    ]);
    expect(details.get("r1")?.replay).toMatchObject({
      dead_clicks: 1,
      http_5xx: 1,
      error_then_leave: 1,
    });
    expect(details.get("r1")?.score).toBe(
      sessionFrictionScore(
        { dead_clicks: 1, http_5xx: 1, error_then_leave: 1 },
        REPLAY_FRICTION_SCORE_INPUTS,
      ),
    );

    await replayBatch("r1", "s1", 1, deadClick(60_000));
    details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1", 2),
    ]);
    expect(details.get("r1")?.replay).toMatchObject({
      dead_clicks: 2,
      error_then_leave: 0,
    });

    // Chunk 2 never reached the detector, so the recording has moved past it.
    await replayBatch("r1", "s1", 3, deadClick(90_000));
    details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1", 4),
    ]);
    expect(details.get("r1")).toMatchObject({ replay: null, score: null });
  });

  it("filters and sorts by measured friction, unmeasured sessions last", async () => {
    await migrateFriction(client);
    await addRecording("r-replay", "s-replay", at(0), 1);
    await replayBatch("r-replay", "s-replay", 0, deadClick(1_000));
    await index(
      [
        pageview("s-replay", 1, "/a"),
        actionResponse("s-agent", 2, { action: "save", success: false }),
        runOutcome("s-agent", 3, { outcome: "failed", code: "http_429" }),
      ],
      at(0),
    );
    await addRecording("r-agent", "s-agent", at(0));
    await addRecording("r-unmeasured", "s-unmeasured", at(0), 3);

    expect(await matching(["dead_clicks"])).toEqual(["r-replay"]);
    expect(await matching(["failed_actions"])).toEqual(["r-agent"]);
    expect(await matching(["failed_actions", "dead_clicks"])).toEqual([]);
    expect(await sorted("friction")).toEqual([
      "r-agent",
      "r-replay",
      "r-unmeasured",
    ]);
    expect(await sorted("dead_clicks")).toEqual([
      "r-replay",
      "r-agent",
      "r-unmeasured",
    ]);
  });

  it("keeps the stored event score equal to the score of the merged counts", async () => {
    await migrateFriction(client);
    const failures = (start: number) =>
      [0, 1, 2].map((offset) =>
        actionResponse("s1", start + offset, {
          action: "save",
          success: false,
        }),
      );
    await index(failures(1), at(0));
    await index(
      [...failures(10), runOutcome("s1", 20, { outcome: "stopped" })],
      at(9),
    );
    const stored = await client.query(
      "SELECT failed_actions, cancelled_runs, score FROM analytics_session_friction",
    );
    expect(stored.rows).toEqual([
      { failed_actions: 6, cancelled_runs: 1, score: expect.any(Number) },
    ]);
    expect(stored.rows[0].score).toBe(
      sessionFrictionScore(
        { failed_actions: 6, cancelled_runs: 1 },
        EVENT_FRICTION_SCORE_INPUTS,
      ),
    );
    expect(stored.rows[0].score).toBe(
      5 * SESSION_FRICTION_WEIGHTS.failed_actions +
        SESSION_FRICTION_WEIGHTS.cancelled_runs,
    );
  });

  it("returns a session's top trouble groups with their causes", async () => {
    await migrateFriction(client);
    await index(
      [
        runOutcome("s1", 1, { outcome: "failed", code: "http_429" }),
        runOutcome("s1", 2, { outcome: "failed", code: "http_429" }),
        actionResponse("s1", 3, {
          action: "save",
          success: false,
          status_code: 500,
        }),
      ],
      at(0),
    );
    await addRecording("r1", "s1", at(0));
    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1"),
    ]);
    expect(details.get("r1")?.troubles).toEqual([
      {
        kind: "agent",
        label: "rate_limit",
        status: "http_429",
        cause: "rate_limit",
        count: 2,
      },
      { kind: "action", label: "save", status: "500", cause: null, count: 1 },
    ]);
  });

  it("links the Monitoring issues a recording's errors belong to", async () => {
    await migrateFriction(client);
    await addRecording("r1", "s1", at(0));
    await client.query(`
      INSERT INTO error_issues (id, title, owner_email, org_id) VALUES
        ('issue-a', 'TypeError: x is undefined', '${OWNER}', '${ORG}'),
        ('issue-b', 'Save failed', '${OWNER}', '${ORG}'),
        ('issue-other', 'Someone else''s issue', 'other@example.com', 'org_2')
    `);
    await client.query(`
      INSERT INTO error_events (id, issue_id, session_recording_id, client_recording_id, owner_email, org_id) VALUES
        ('e1', 'issue-a', 'r1', NULL, '${OWNER}', '${ORG}'),
        ('e2', 'issue-a', NULL, 'client-r1', '${OWNER}', '${ORG}'),
        ('e3', 'issue-b', 'r1', NULL, '${OWNER}', '${ORG}'),
        ('e4', 'issue-other', 'r1', 'client-r1', 'other@example.com', 'org_2')
    `);
    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1"),
    ]);
    expect(details.get("r1")?.errorIssues).toEqual([
      { id: "issue-a", title: "TypeError: x is undefined", count: 2 },
      { id: "issue-b", title: "Save failed", count: 1 },
    ]);
  });

  it("keys friction rows by tenant, never another tenant's session", async () => {
    await migrateFriction(client);
    await index(
      [
        actionResponse("s1", 1, { action: "save", success: false }),
        {
          ...actionResponse("s1", 2, { action: "save", success: false }),
          ownerEmail: "other@example.com",
          orgId: "org_2",
        },
      ],
      at(0),
    );
    const rows = await db
      .select({
        tenantKey: schema.analyticsSessionFriction.tenantKey,
        failedActions: schema.analyticsSessionFriction.failedActions,
      })
      .from(schema.analyticsSessionFriction)
      .where(sql`${schema.analyticsSessionFriction.sessionId} = 's1'`)
      .orderBy(asc(schema.analyticsSessionFriction.tenantKey));
    expect(rows).toEqual([
      { tenantKey: TENANT, failedActions: 1 },
      {
        tenantKey: sessionEventTenantKey("other@example.com", "org_2"),
        failedActions: 1,
      },
    ]);
  });
});
