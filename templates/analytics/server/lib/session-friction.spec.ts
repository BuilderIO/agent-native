import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  AGENT_SIGNALS_PAGEVIEW_PROPERTY,
  AGENT_SIGNALS_VERSION,
  PAGE_LOAD_PAGEVIEW_PROPERTY,
  UNRECOGNIZED_AGENT_ERROR_CODE,
} from "@agent-native/core/shared/analytics-events";
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
import {
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "../../shared/session-replay-diagnostics.js";
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
  finalizeReplayFriction,
  getSessionFrictionCoverageStart,
  getSessionFrictionDetails,
  listRecordingFriction,
  pruneSessionFriction,
  QUICK_BACK_WINDOW_MS,
  recordReplayFriction,
  sessionFrictionFilterConditions,
  sessionFrictionSortOrder,
} from "./session-friction";

/** Migration DDL comes straight from db.ts so the tests track it. */
function migrationSql(name: string): string[] {
  // source-read-ok: runs the migration's SQL against PGlite; nothing asserts on the text.
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
      chunk_count integer NOT NULL DEFAULT 0,
      error_count integer NOT NULL DEFAULT 0,
      rage_click_count integer NOT NULL DEFAULT 0
    )
  `);
  await client.query(`
    CREATE TABLE error_issues (
      id text PRIMARY KEY,
      title text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      visibility text NOT NULL DEFAULT 'private',
      last_seen_at text NOT NULL DEFAULT '',
      last_session_recording_id text
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
      session_id text,
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

function pageview(
  sessionId: string,
  seconds: number,
  path: string,
  properties: Record<string, unknown> = {},
) {
  return event({
    eventName: "pageview",
    sessionId,
    timestamp: at(seconds),
    properties: JSON.stringify({ path, ...properties }),
  });
}

/** One page load's id, which quick backs follow. */
const LOAD = { [PAGE_LOAD_PAGEVIEW_PROPERTY]: "load-1" };

/** A pageview from a client that reports every stop and rating. */
function markedPageview(sessionId: string, seconds: number, path: string) {
  return pageview(sessionId, seconds, path, {
    [AGENT_SIGNALS_PAGEVIEW_PROPERTY]: AGENT_SIGNALS_VERSION,
  });
}

function feedback(sessionId: string, seconds: number, sentiment: string) {
  return event({
    eventName: "agent_feedback_submitted",
    sessionId,
    timestamp: at(seconds),
    properties: JSON.stringify({ sentiment }),
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
        pageview("s1", 0, "/a", LOAD),
        pageview("s1", 10, "/b", LOAD),
        pageview("s1", 12, "/a", LOAD),
        // Back again each time, but only after reading the page for a while.
        pageview("s1", 12 + QUICK_BACK_WINDOW_MS / 1000 + 1, "/b", LOAD),
        pageview("s1", 2 * (QUICK_BACK_WINDOW_MS / 1000 + 1) + 12, "/a", LOAD),
      ],
      new Map(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ quickBacks: 1 });
    expect(sessions[0]!.navState).not.toContain("/a");
  });

  it("compares pages only within one page load", () => {
    const load = (id: string) => ({ page_load_id: id });
    const { sessions } = aggregateSessionFrictionEvents(
      [
        // A list opens an item in a new tab, then changes its own filter.
        pageview("s1", 0, "/list", load("list")),
        pageview("s1", 1, "/item", load("item")),
        pageview("s1", 2, "/list", load("list")),
        // A tab goes back while another tab opens a page in between.
        pageview("s2", 0, "/a", load("one")),
        pageview("s2", 1, "/b", load("one")),
        pageview("s2", 2, "/x", load("two")),
        pageview("s2", 3, "/a", load("one")),
        ...Array.from({ length: 25 }, (_, i) =>
          pageview("s3", i, "/a", load(`load-${i}`)),
        ),
      ],
      new Map(),
    );
    const bySession = new Map(
      sessions.map((session) => [session.sessionId, session]),
    );
    expect(bySession.get("s1")).toMatchObject({ quickBacks: 0 });
    expect(bySession.get("s2")).toMatchObject({ quickBacks: 1 });
    expect(JSON.parse(bySession.get("s3")!.navState!).loads).toHaveLength(20);
  });

  it("counts no quick backs from pageviews without a page load id", () => {
    // Two tabs of an older client: neither went back, but together they look
    // like one tab returning to /a.
    const { sessions } = aggregateSessionFrictionEvents(
      [
        pageview("s1", 0, "/a"),
        pageview("s1", 1, "/b"),
        pageview("s1", 2, "/a"),
      ],
      new Map(),
    );
    expect(sessions[0]).toMatchObject({ quickBacks: 0 });
  });

  it("continues navigation from the state an earlier batch stored", () => {
    const first = aggregateSessionFrictionEvents(
      [pageview("s1", 0, "/a", LOAD), pageview("s1", 10, "/b", LOAD)],
      new Map(),
    );
    const id = first.sessions[0]!.id;
    const second = aggregateSessionFrictionEvents(
      [pageview("s1", 12, "/a", LOAD)],
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
        label: "no_model_connected",
        cause: "no_model_connected",
        eventCount: 1,
      },
      { label: "runtime_error", cause: null, eventCount: 1 },
    ]);
  });

  it("groups unnamed agent failures by code and never keeps a message", () => {
    const { troubles } = aggregateSessionFrictionEvents(
      [
        runOutcome("s1", 1, {
          outcome: "failed",
          code: "runtime_error",
          error_message: "Deck Quarterly Planning not found",
        }),
        runOutcome("s1", 2, {
          outcome: "failed",
          code: "runtime_error",
          error_message: "Tool 'fetch' failed after 5 tries",
        }),
        runOutcome("s1", 3, {
          outcome: "interrupted",
          error_message: "Jane Doe's notes are locked",
        }),
      ],
      new Map(),
    );
    expect(
      troubles.map(({ label, eventCount }) => ({ label, eventCount })),
    ).toEqual(
      expect.arrayContaining([
        { label: "runtime_error", eventCount: 2 },
        { label: "interrupted", eventCount: 1 },
      ]),
    );
    expect(troubles).toHaveLength(2);
    expect(JSON.stringify(troubles)).not.toMatch(/Quarterly|fetch|Jane/);
  });

  it("groups a code that is not an identifier as unrecognized", () => {
    // Older clients sent a route error's `data.code` as is.
    const { troubles } = aggregateSessionFrictionEvents(
      [
        runOutcome("s1", 1, {
          outcome: "failed",
          code: "Jane Doe cannot open Quarterly Planning",
        }),
      ],
      new Map(),
    );
    expect(
      troubles.map(({ label, status, eventCount }) => ({
        label,
        status,
        eventCount,
      })),
    ).toEqual([
      {
        label: UNRECOGNIZED_AGENT_ERROR_CODE,
        status: UNRECOGNIZED_AGENT_ERROR_CODE,
        eventCount: 1,
      },
    ]);
    expect(JSON.stringify(troubles)).not.toMatch(/Quarterly|Jane/);
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

  it("counts only stops reported unsampled", () => {
    const { sessions } = aggregateSessionFrictionEvents(
      [
        runOutcome("s1", 1, { outcome: "stopped", sample_rate: 1 }),
        runOutcome("s1", 2, { outcome: "stopped" }),
        // An older client sampled stops, so one event is not one stop.
        runOutcome("s1", 3, { outcome: "stopped", sample_rate: 0.1 }),
      ],
      new Map(),
    );
    expect(sessions[0]).toMatchObject({ cancelledRuns: 2 });
  });

  it("measures marked-client signals only after a marked pageview", () => {
    const { sessions } = aggregateSessionFrictionEvents(
      [
        pageview("s-old", 1, "/a"),
        pageview("s-bad", 1, "/a", { [AGENT_SIGNALS_PAGEVIEW_PROPERTY]: "1" }),
        markedPageview("s-new", 1, "/a"),
        ...["s-old", "s-bad", "s-new"].flatMap((sessionId) => [
          runOutcome(sessionId, 2, { outcome: "stopped", sample_rate: 1 }),
          feedback(sessionId, 3, "negative"),
        ]),
      ],
      new Map(),
    );
    const bySession = new Map(sessions.map((row) => [row.sessionId, row]));
    expect(bySession.get("s-old")).toMatchObject({
      agentSignalsMeasured: false,
      agentSignalsMissing: true,
      cancelledRuns: 1,
      thumbsDown: 1,
      score: 0,
    });
    expect(bySession.get("s-bad")).toMatchObject({
      agentSignalsMeasured: false,
      agentSignalsMissing: true,
      score: 0,
    });
    expect(bySession.get("s-new")).toMatchObject({
      agentSignalsMeasured: true,
      agentSignalsMissing: false,
      score: sessionFrictionScore(
        { cancelled_runs: 1, thumbs_down: 1 },
        EVENT_FRICTION_SCORE_INPUTS,
      ),
    });
  });

  it("leaves marked-client signals unmeasured when an old tab shares the session", () => {
    const { sessions } = aggregateSessionFrictionEvents(
      [
        markedPageview("s-tabs", 1, "/a"),
        // The old tab's pageview and the new tab's events share one session id.
        pageview("s-tabs", 2, "/b"),
        markedPageview("s-sampled", 1, "/a"),
        // Only an old tab samples stops; the new one would send every stop.
        runOutcome("s-sampled", 2, { outcome: "stopped", sample_rate: 0.1 }),
        ...["s-tabs", "s-sampled"].flatMap((sessionId) => [
          runOutcome(sessionId, 3, { outcome: "stopped", sample_rate: 1 }),
          feedback(sessionId, 4, "negative"),
        ]),
      ],
      new Map(),
    );
    for (const row of sessions) {
      expect(row).toMatchObject({
        agentSignalsMeasured: true,
        agentSignalsMissing: true,
        score: 0,
      });
    }
    expect(sessions).toHaveLength(2);
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
    orgId: string | null = ORG,
  ) {
    await client.query(
      `INSERT INTO session_recordings (id, client_recording_id, session_id, owner_email, org_id, started_at, chunk_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, `client-${id}`, sessionId, OWNER, orgId, startedAt, chunkCount],
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
    recordingEnded = true,
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
      recordingEnded,
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
      .where(and(...(await sessionFrictionFilterConditions(SCOPE, signals))))
      .orderBy(asc(r.id));
    return rows.map((row: { id: string }) => row.id);
  }

  async function sorted(sort: SessionFrictionSort) {
    const r = schema.sessionRecordings;
    const order = await sessionFrictionSortOrder(SCOPE, sort);
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
        markedPageview("s-calm", 11, "/a"),
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

  it("leaves a session unmeasured when it was indexed before coverage began", async () => {
    await index(
      [actionResponse("s-early", 1, { action: "save", success: false })],
      at(1),
    );
    await migrateFriction(client);
    await index(
      [
        markedPageview("s-early", 11, "/a"),
        markedPageview("s-fresh", 11, "/a"),
      ],
      at(10),
    );
    await addRecording("r-early", "s-early", at(11));
    await addRecording("r-fresh", "s-fresh", at(11));

    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-early", "s-early"),
      recordingInput("r-fresh", "s-fresh"),
    ]);
    expect(details.get("r-early")).toMatchObject({ score: null, events: null });
    expect(details.get("r-fresh")).toMatchObject({
      score: 0,
      events: { failed_actions: 0 },
    });
  });

  async function sessionIds(table: string) {
    const result = await client.query(
      `SELECT DISTINCT session_id FROM ${table} ORDER BY session_id`,
    );
    return result.rows.map((row: any) => row.session_id);
  }

  it("leaves a session unmeasured once a friction write for it failed, and keeps its events indexed", async () => {
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
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Session friction write failed"),
      expect.anything(),
    );
    warn.mockRestore();
    await index([pageview("s-gap", 8, "/a")], at(7));
    await addRecording("r-ok", "s-ok", at(0));
    await addRecording("r-gap", "s-gap", at(4));

    // Only friction rolled back: the batch's events stay indexed, and the
    // index itself has no gap, so its own filters still see the session.
    expect(await sessionIds("analytics_session_events")).toEqual([
      "s-gap",
      "s-ok",
    ]);
    expect(await sessionIds("analytics_session_event_gaps")).toEqual([]);
    expect(await sessionIds("analytics_session_friction_gaps")).toEqual([
      "s-gap",
    ]);
    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-ok", "s-ok"),
      recordingInput("r-gap", "s-gap"),
    ]);
    expect(details.get("r-ok")?.events).not.toBeNull();
    expect(details.get("r-gap")?.events).toBeNull();
    expect(await sorted("failed_actions")).toEqual(["r-ok", "r-gap"]);
  });

  it("marks the index gap when even the friction gap marker cannot be written", async () => {
    await migrateFriction(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failInsertsInto("analytics_session_friction");
    await client.query(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON analytics_session_friction_gaps FOR EACH ROW EXECUTE FUNCTION fail_insert()",
    );
    await index(
      [actionResponse("s-gap", 6, { action: "save", success: false })],
      at(5),
    );
    warn.mockRestore();
    expect(await sessionIds("analytics_session_events")).toEqual([]);
    expect(await sessionIds("analytics_session_event_gaps")).toEqual(["s-gap"]);
    await addRecording("r-gap", "s-gap", at(4));
    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-gap", "s-gap"),
    ]);
    expect(details.get("r-gap")?.events).toBeNull();
  });

  it("costs only friction when its readiness probe fails", async () => {
    await migrateFriction(client);
    await client.query(
      `CREATE FUNCTION public.to_regclass(name text) RETURNS regclass LANGUAGE plpgsql AS $$
       BEGIN
         IF name = 'analytics_session_friction_coverage' THEN
           RAISE EXCEPTION 'probe failed';
         END IF;
         RETURN pg_catalog.to_regclass(name);
       END $$`,
    );
    await client.query("SET search_path = public, pg_catalog");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await index(
        [actionResponse("s-probe", 6, { action: "save", success: false })],
        at(5),
      );
    } finally {
      await client.query("RESET search_path");
      await client.query("DROP FUNCTION public.to_regclass(text)");
    }
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Session friction write failed"),
      expect.anything(),
    );
    warn.mockRestore();
    expect(await sessionIds("analytics_session_events")).toEqual(["s-probe"]);
    expect(await sessionIds("analytics_session_event_gaps")).toEqual([]);
    expect(await sessionIds("analytics_session_friction_gaps")).toEqual([
      "s-probe",
    ]);
  });

  it("measures thumbs-down and cancelled runs only for sessions that carried the marker", async () => {
    await migrateFriction(client);
    await index(
      [
        pageview("s-old", 1, "/a"),
        markedPageview("s-new", 1, "/a"),
        ...["s-old", "s-new"].flatMap((sessionId) => [
          runOutcome(sessionId, 2, { outcome: "stopped", sample_rate: 1 }),
          feedback(sessionId, 3, "negative"),
          actionResponse(sessionId, 4, { action: "save", success: false }),
        ]),
      ],
      at(0),
    );
    await addRecording("r-old", "s-old", at(0));
    await addRecording("r-new", "s-new", at(0));

    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-old", "s-old"),
      recordingInput("r-new", "s-new"),
    ]);
    expect(details.get("r-old")).toMatchObject({
      score: sessionFrictionScore(
        { failed_actions: 1 },
        EVENT_FRICTION_SCORE_INPUTS,
      ),
      events: {
        failed_actions: 1,
        thumbs_down: null,
        cancelled_runs: null,
        quick_backs: null,
      },
      topSignals: [{ signal: "failed_actions", count: 1 }],
    });
    expect(details.get("r-new")).toMatchObject({
      score: sessionFrictionScore(
        { failed_actions: 1, thumbs_down: 1, cancelled_runs: 1 },
        EVENT_FRICTION_SCORE_INPUTS,
      ),
      events: { failed_actions: 1, thumbs_down: 1, cancelled_runs: 1 },
    });
    expect(await matching(["thumbs_down"])).toEqual(["r-new"]);
    expect(await matching(["cancelled_runs"])).toEqual(["r-new"]);
    expect(await matching(["failed_actions"])).toEqual(["r-new", "r-old"]);
    expect(await sorted("thumbs_down")).toEqual(["r-new", "r-old"]);
    expect(await sorted("friction")).toEqual(["r-new", "r-old"]);

    // A new tab joins the old one's session, and an old tab joins the new
    // one's: neither session reports every stop and rating, so neither is
    // measured, and the stored score agrees with what reads show.
    await index(
      [markedPageview("s-old", 9, "/b"), pageview("s-new", 9, "/b")],
      at(8),
    );
    const later = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-old", "s-old"),
      recordingInput("r-new", "s-new"),
    ]);
    for (const id of ["r-old", "r-new"]) {
      expect(later.get(id)).toMatchObject({
        score: sessionFrictionScore(
          { failed_actions: 1 },
          EVENT_FRICTION_SCORE_INPUTS,
        ),
        events: {
          failed_actions: 1,
          thumbs_down: null,
          cancelled_runs: null,
          quick_backs: null,
        },
      });
    }
    expect(await matching(["thumbs_down"])).toEqual([]);
    const stored = await client.query(
      "SELECT session_id, agent_signals_measured, agent_signals_missing FROM analytics_session_friction ORDER BY session_id",
    );
    expect(stored.rows).toEqual([
      {
        session_id: "s-new",
        agent_signals_measured: true,
        agent_signals_missing: true,
      },
      {
        session_id: "s-old",
        agent_signals_measured: true,
        agent_signals_missing: true,
      },
    ]);
  });

  it("leaves a recording unmeasured when a batch skips or reorders its chunks", async () => {
    await migrateFriction(client);
    await addRecording("r-gap", "s1", at(0), 3);
    await addRecording("r-late", "s2", at(0), 2);
    const write = (
      recordingId: string,
      sessionId: string,
      priorChunkCount: number,
      seqs: number[],
    ) =>
      recordReplayFriction({
        recordingId,
        sessionId,
        ownerEmail: OWNER,
        orgId: ORG,
        priorChunkCount,
        newChunks: seqs.map((seq) => ({
          seq,
          inlineData: JSON.stringify({
            events: deadClick(1_000 + seq * 60_000),
          }),
        })),
        errorCount: 0,
        rageClickCount: 0,
        recordingEnded: false,
        ingestedAt: at(0),
      });
    // Chunk 0 arrives after chunk 1, so this batch does not start the recording,
    // and neither the late chunk 0 nor the next chunk, whose seq matches the
    // stored count, can start it afterwards.
    await write("r-gap", "s1", 0, [1]);
    await write("r-gap", "s1", 1, [0]);
    await write("r-gap", "s1", 2, [2]);
    // Two chunks, but one of them is not the next one.
    await write("r-late", "s2", 0, [0, 2]);
    const rows = await client.query(
      "SELECT recording_id FROM session_recording_friction",
    );
    expect(rows.rows).toEqual([]);
    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-gap", "s1", 3),
      recordingInput("r-late", "s2", 2),
    ]);
    expect(details.get("r-gap")?.replay).toBeNull();
    expect(details.get("r-late")?.replay).toBeNull();

    // In-order batches, even listed out of order, are measured.
    await addRecording("r-ok", "s3", at(0), 2);
    await write("r-ok", "s3", 0, [1, 0]);
    const measured = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r-ok", "s3", 2),
    ]);
    expect(measured.get("r-ok")?.replay).toMatchObject({ dead_clicks: 2 });
  });

  it("counts leaving after an error only once the recording has ended", async () => {
    await migrateFriction(client);
    await addRecording("r1", "s1", at(0), 1);
    await replayBatch("r1", "s1", 0, [serverError(5_000)], false);
    let details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1", 1),
    ]);
    expect(details.get("r1")?.replay).toMatchObject({
      http_5xx: 1,
      error_then_leave: 0,
    });

    // Retention finalizes a recording that never sent its final upload.
    await finalizeReplayFriction(recordingInput("r1", "s1", 1), at(60));
    details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1", 1),
    ]);
    expect(details.get("r1")?.replay).toMatchObject({
      http_5xx: 1,
      error_then_leave: 1,
    });
    expect(details.get("r1")?.score).toBe(
      sessionFrictionScore(
        { http_5xx: 1, error_then_leave: 1 },
        REPLAY_FRICTION_SCORE_INPUTS,
      ),
    );
  });

  it("rescores a recording from an upload that stored no new chunks", async () => {
    await migrateFriction(client);
    await addRecording("r1", "s1", at(0), 1);
    await replayBatch("r1", "s1", 0, [serverError(5_000)], false);

    // A retried final upload: every chunk is already stored, but the
    // recording has now ended and its counts grew.
    await recordReplayFriction({
      recordingId: "r1",
      sessionId: "s1",
      ownerEmail: OWNER,
      orgId: ORG,
      priorChunkCount: 1,
      newChunks: [],
      errorCount: 2,
      rageClickCount: 0,
      recordingEnded: true,
      ingestedAt: at(60),
    });
    const details = await getSessionFrictionDetails(SCOPE, [
      { ...recordingInput("r1", "s1", 1), errorCount: 2 },
    ]);
    expect(details.get("r1")?.replay).toMatchObject({
      http_5xx: 1,
      error_then_leave: 1,
    });
    expect(details.get("r1")?.score).toBe(
      sessionFrictionScore(
        { http_5xx: 1, error_then_leave: 1, errors: 2 },
        REPLAY_FRICTION_SCORE_INPUTS,
      ),
    );
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
    await index(
      [...failures(1), runOutcome("s1", 5, { outcome: "stopped" })],
      at(0),
    );
    const unmarked = await client.query(
      "SELECT score FROM analytics_session_friction",
    );
    expect(unmarked.rows[0].score).toBe(
      sessionFrictionScore({ failed_actions: 3 }, EVENT_FRICTION_SCORE_INPUTS),
    );
    // The marker in a later batch brings the earlier stop into the score.
    await index([...failures(10), markedPageview("s1", 20, "/a")], at(9));
    const stored = await client.query(
      "SELECT failed_actions, cancelled_runs, agent_signals_measured, score FROM analytics_session_friction",
    );
    expect(stored.rows).toEqual([
      {
        failed_actions: 6,
        cancelled_runs: 1,
        agent_signals_measured: true,
        score: expect.any(Number),
      },
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
      INSERT INTO error_events (id, issue_id, session_recording_id, client_recording_id, session_id, owner_email, org_id) VALUES
        ('e1', 'issue-a', 'r1', NULL, 's1', '${OWNER}', '${ORG}'),
        ('e2', 'issue-a', NULL, 'client-r1', 's1', '${OWNER}', '${ORG}'),
        ('e3', 'issue-b', 'r1', NULL, NULL, '${OWNER}', '${ORG}'),
        ('e4', 'issue-other', 'r1', 'client-r1', 's1', 'other@example.com', 'org_2'),
        -- The same client recording id under another public key: one
        -- occurrence was linked to that recording, one came from its session.
        ('e5', 'issue-b', 'r-other-key', 'client-r1', 's1', '${OWNER}', '${ORG}'),
        ('e6', 'issue-b', NULL, 'client-r1', 's-other-key', '${OWNER}', '${ORG}')
    `);
    const details = await getSessionFrictionDetails(SCOPE, [
      recordingInput("r1", "s1"),
    ]);
    expect(details.get("r1")?.errorIssues).toEqual([
      { id: "issue-a", title: "TypeError: x is undefined", count: 2 },
      { id: "issue-b", title: "Save failed", count: 1 },
    ]);
  });

  it("falls back to an issue's last recording, and calls an erroring recording issue-free only where no issue was ever captured", async () => {
    await migrateFriction(client);
    for (const id of ["r-last", "r-errors", "r-clean"]) {
      await addRecording(id, `s-${id}`, at(0));
    }
    // Occurrences were trimmed, so only the issue still names its recording.
    await client.query(`
      INSERT INTO error_issues (id, title, owner_email, org_id, last_seen_at, last_session_recording_id) VALUES
        ('issue-c', 'Upload failed', '${OWNER}', '${ORG}', '${at(5)}', 'r-last'),
        ('issue-other', 'Someone else''s issue', 'other@example.com', 'org_2', '${at(6)}', 'r-errors')
    `);
    const details = await getSessionFrictionDetails(SCOPE, [
      { ...recordingInput("r-last", "s-r-last"), errorCount: 1 },
      { ...recordingInput("r-errors", "s-r-errors"), errorCount: 2 },
      recordingInput("r-clean", "s-r-clean"),
      // The owner's personal scope has never captured an issue.
      {
        ...recordingInput("r-personal", "s-r-personal"),
        orgId: null,
        errorCount: 3,
      },
    ]);
    expect(details.get("r-last")?.errorIssues).toEqual([
      { id: "issue-c", title: "Upload failed", count: null },
    ]);
    // Its scope has issues, so its own may have been trimmed: unknown.
    expect(details.get("r-errors")?.errorIssues).toBeNull();
    expect(details.get("r-clean")?.errorIssues).toEqual([]);
    expect(details.get("r-personal")?.errorIssues).toEqual([]);
  });

  it("shows no issue link for a recording whose only errors were console errors", async () => {
    await migrateFriction(client);
    const consoleError = (exception?: boolean) => ({
      type: 5,
      timestamp: 1_000,
      data: {
        tag: SESSION_REPLAY_CONSOLE_EVENT_TAG,
        payload: {
          level: "error",
          source: "console",
          message: "logged",
          ...(exception === undefined ? {} : { exception }),
        },
      },
    });
    for (const id of ["r-logged", "r-captured", "r-old", "r-behind"]) {
      await addRecording(id, `s-${id}`, at(0), 1);
    }
    await replayBatch("r-logged", "s-r-logged", 0, [consoleError(false)]);
    await replayBatch("r-captured", "s-r-captured", 0, [consoleError(true)]);
    await replayBatch("r-old", "s-r-old", 0, [consoleError()]);
    await replayBatch("r-behind", "s-r-behind", 0, [consoleError(false)]);
    // The owner's scope has issues, just none these recordings link to.
    await client.query(`
      INSERT INTO error_issues (id, title, owner_email, org_id) VALUES
        ('issue-a', 'TypeError: x is undefined', '${OWNER}', '${ORG}')
    `);
    const details = await getSessionFrictionDetails(SCOPE, [
      { ...recordingInput("r-logged", "s-r-logged", 1), errorCount: 1 },
      { ...recordingInput("r-captured", "s-r-captured", 1), errorCount: 1 },
      { ...recordingInput("r-old", "s-r-old", 1), errorCount: 1 },
      // A chunk the detector has not seen could hold an exception.
      { ...recordingInput("r-behind", "s-r-behind", 2), errorCount: 1 },
    ]);
    expect(details.get("r-logged")?.errorIssues).toEqual([]);
    expect(details.get("r-captured")?.errorIssues).toBeNull();
    expect(details.get("r-old")?.errorIssues).toBeNull();
    expect(details.get("r-behind")?.errorIssues).toBeNull();
  });

  it("lists friction only for the recordings the viewer can read", async () => {
    await migrateFriction(client);
    await addRecording("r1", "s1", at(0), 1);
    await client.query(
      `INSERT INTO session_recordings (id, client_recording_id, session_id, owner_email, org_id, started_at)
       VALUES ('r-other', 'client-r-other', 's2', 'other@example.com', 'org_2', $1)`,
      [at(0)],
    );
    await replayBatch("r1", "s1", 0, [serverError(1_000)]);

    const friction = await listRecordingFriction(SCOPE, [
      "r1",
      "r1",
      "r-other",
      "r-missing",
    ]);
    expect(Object.keys(friction)).toEqual(["r1"]);
    expect(friction.r1.replay?.http_5xx).toBe(1);
    await expect(listRecordingFriction(SCOPE, [])).resolves.toEqual({});
  });

  it("reports when friction coverage began for the viewer's own tenants", async () => {
    expect(await getSessionFrictionCoverageStart(SCOPE)).toBeNull();
    await migrateFriction(client);
    expect(await getSessionFrictionCoverageStart(SCOPE)).toBeNull();
    await index([pageview("s1", 11, "/a")], at(10));
    expect(await getSessionFrictionCoverageStart(SCOPE)).toBe(at(10));

    // The viewer's personal tenant was never measured, so the org's start
    // would overstate coverage wherever its recordings fall in the range.
    await addRecording("r-personal", "s-personal", at(20), 0, null);
    expect(await getSessionFrictionCoverageStart(SCOPE)).toBeNull();
    expect(await getSessionFrictionCoverageStart(SCOPE, { from: at(21) })).toBe(
      at(10),
    );
    expect(await getSessionFrictionCoverageStart(SCOPE, { to: at(19) })).toBe(
      at(10),
    );
    // Another user's personal recording is not the viewer's tenant.
    await client.query(
      `INSERT INTO session_recordings (id, client_recording_id, session_id, owner_email, org_id, started_at)
       VALUES ('r-other', 'client-r-other', 's-other', 'other@example.com', NULL, $1)`,
      [at(25)],
    );
    expect(await getSessionFrictionCoverageStart(SCOPE, { from: at(21) })).toBe(
      at(10),
    );

    // Personal coverage started later; only sessions after both starts are
    // covered everywhere the viewer looks.
    await index([{ ...pageview("s2", 31, "/a"), orgId: null }], at(30));
    expect(await getSessionFrictionCoverageStart(SCOPE)).toBe(at(30));
    expect(
      await getSessionFrictionCoverageStart({
        userEmail: "other@example.com",
        orgId: "org_2",
      }),
    ).toBeNull();
  });

  it("skips the coverage insert only once the tenant's row is known committed", async () => {
    await migrateFriction(client);
    const coverageRows = async () =>
      (
        await client.query(
          "SELECT tenant_key FROM analytics_session_friction_coverage",
        )
      ).rows;
    await expect(
      db.transaction(async (tx: any) => {
        await recordSessionEventIndex(tx, [pageview("s1", 1, "/a")], at(0));
        throw new Error("ingest rolled back");
      }),
    ).rejects.toThrow("ingest rolled back");
    expect(await coverageRows()).toEqual([]);

    await index([pageview("s1", 2, "/b")], at(1));
    expect(await coverageRows()).toEqual([{ tenant_key: TENANT }]);
    await index([pageview("s1", 3, "/c")], at(2));
    // That batch saw the committed row, so later batches stop inserting it.
    await client.query("DELETE FROM analytics_session_friction_coverage");
    await index([pageview("s1", 4, "/d")], at(3));
    expect(await coverageRows()).toEqual([]);
  });

  it("prunes expired friction but keeps a gap while its session has counts", async () => {
    await migrateFriction(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failInsertsInto("analytics_session_friction");
    await index(
      [actionResponse("s-gap", 1, { action: "save", success: false })],
      at(0),
    );
    await client.query(
      "DROP TRIGGER fail_insert ON analytics_session_friction",
    );
    warn.mockRestore();
    await index(
      [actionResponse("s-old", 1, { action: "save", success: false })],
      at(0),
    );
    const recent = "2026-10-19T00:00:01.000Z";
    await index(
      [
        event({
          eventName: "action.response",
          sessionId: "s-new",
          timestamp: recent,
          properties: JSON.stringify({ action: "save", success: false }),
        }),
      ],
      recent,
    );
    await client.query(
      `INSERT INTO analytics_session_friction_gaps (id, tenant_key, owner_email, org_id, session_id, recorded_at)
       VALUES ('asfg_new', $1, $2, $3, 's-new', $4)`,
      [TENANT, OWNER, ORG, at(0)],
    );
    await replayBatch("r1", "s1", 0, deadClick(1_000));

    await pruneSessionFriction(7, new Date("2026-10-20T00:00:00.000Z"));
    expect(await sessionIds("analytics_session_friction")).toEqual(["s-new"]);
    expect(await sessionIds("analytics_session_trouble")).toEqual(["s-new"]);
    expect(await sessionIds("analytics_session_friction_gaps")).toEqual([
      "s-new",
    ]);
    expect(await sessionIds("session_recording_friction")).toEqual([]);
  });

  it("shows a recording shared from another tenant only its replay friction", async () => {
    await migrateFriction(client);
    const other = { ownerEmail: "other@example.com", orgId: "org_2" };
    await index(
      [
        {
          ...actionResponse("s1", 1, { action: "save", success: false }),
          ...other,
        },
      ],
      at(0),
    );
    await client.query(
      `INSERT INTO session_recordings (id, client_recording_id, session_id, owner_email, org_id, started_at, chunk_count)
       VALUES ('r-shared', 'client-r-shared', 's1', $1, $2, $3, 1)`,
      [other.ownerEmail, other.orgId, at(0)],
    );
    await replayBatch("r-shared", "s1", 0, [serverError(1_000)]);
    const recording = { ...recordingInput("r-shared", "s1", 1), ...other };

    const owner = await getSessionFrictionDetails(
      { userEmail: other.ownerEmail, orgId: other.orgId },
      [recording],
    );
    expect(owner.get("r-shared")?.events).toMatchObject({ failed_actions: 1 });

    const shared = await getSessionFrictionDetails(SCOPE, [recording]);
    expect(shared.get("r-shared")).toMatchObject({
      replay: { http_5xx: 1 },
      events: null,
      troubles: [],
      errorIssues: [],
    });
    // A chunk friction has not read could hold an exception, and the viewer
    // can't tell "no issues" from issues in a scope they can't read.
    const erroring = await getSessionFrictionDetails(SCOPE, [
      { ...recording, chunkCount: 2, errorCount: 1 },
    ]);
    expect(erroring.get("r-shared")?.errorIssues).toBeNull();
    expect(await matching(["failed_actions"])).toEqual([]);
    expect(await matching(["http_5xx"])).toEqual(["r-shared"]);
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
