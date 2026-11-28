import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: ReturnType<typeof drizzle>;
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

let client: PGliteClient;

const mocks = vi.hoisted(() => ({
  shared: false,
  email: "me@example.com",
  editorIds: [] as string[],
  inaccessibleThreads: [] as string[],
  appState: [] as Array<{ key: string; value: unknown }>,
  otherAppState: [] as Array<{ key: string; value: unknown }>,
  runRefs: new Map<string, { threadId: string; turnId: string }>(),
  turnRuns: new Map<string, string[]>(),
  runStatuses: new Map<string, string>(),
  runEvents: new Map<
    string,
    Array<{
      runId: string;
      seq: number;
      event: {
        type: string;
        error?: string;
        errorCode?: string;
        recoverable?: boolean;
        providerRetryable?: boolean;
      };
    }>
  >(),
  runReadError: null as Error | null,
  beforeCompare: null as (() => void) | null,
  compare: vi.fn(),
  compareMany: vi.fn(),
  readRun: vi.fn(),
}));

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  return { getDb: () => db, schema };
});
vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => {
  const entries = () =>
    mocks.email === "me@example.com" ? mocks.appState : mocks.otherAppState;
  return {
    listAppState: async (prefix: string) =>
      structuredClone(
        entries().filter((entry) => entry.key.startsWith(prefix)),
      ),
    readAppState: async (key: string) =>
      structuredClone(
        entries().find((entry) => entry.key === key)?.value ?? null,
      ),
    compareAndSetManyAppState: async (
      operations: Array<{
        key: string;
        expectedValue: unknown;
        nextValue: unknown;
      }>,
    ) => {
      mocks.compareMany(operations);
      mocks.beforeCompare?.();
      const current = entries();
      if (
        operations.some(
          ({ key, expectedValue }) =>
            JSON.stringify(
              current.find((entry) => entry.key === key)?.value ?? null,
            ) !== JSON.stringify(expectedValue),
        )
      )
        return false;
      for (const { key, nextValue } of operations) {
        const entry = current.find((item) => item.key === key);
        if (entry) entry.value = structuredClone(nextValue);
        else current.push({ key, value: structuredClone(nextValue) });
      }
      return true;
    },
    compareAndSetAppState: async (
      key: string,
      expected: unknown,
      next: unknown,
    ) => {
      mocks.compare(key, expected, next);
      mocks.beforeCompare?.();
      const entry = entries().find((item) => item.key === key);
      if (!entry || JSON.stringify(entry.value) !== JSON.stringify(expected))
        return false;
      entry.value = structuredClone(next);
      return true;
    },
  };
});
vi.mock("@agent-native/core/server", () => ({
  callerHasThreadAccess: async (
    email: string,
    threadId: string,
    role: string,
    context: unknown,
    scope: unknown,
  ) => {
    if (
      email !== mocks.email ||
      role !== "owner" ||
      JSON.stringify(scope) !== JSON.stringify({ sourceAppId: "clips" })
    )
      return false;
    return !mocks.inaccessibleThreads.includes(threadId);
  },
  getRunTurnRef: async (id: string) => {
    mocks.readRun(id);
    if (mocks.runReadError) throw mocks.runReadError;
    return mocks.runRefs.get(id) ?? null;
  },
  getCurrentTurnRunIdsForThread: async (threadId: string, turnId: string) => {
    mocks.readRun(`${threadId}/${turnId}`);
    if (mocks.runReadError) throw mocks.runReadError;
    return mocks.turnRuns.get(`${threadId}/${turnId}`) ?? [];
  },
  getRunStatus: async (id: string) => {
    mocks.readRun(id);
    if (mocks.runReadError) throw mocks.runReadError;
    return mocks.runStatuses.get(id) ?? null;
  },
  getCurrentTurnRunEventsForThread: async (
    threadId: string,
    turnId: string,
  ) => {
    if (mocks.runReadError) throw mocks.runReadError;
    return mocks.runEvents.get(`${threadId}/${turnId}`) ?? [];
  },
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.email,
  getRequestOrgId: () => undefined,
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (
    table: { ownerEmail: unknown; id: unknown },
    _shares: unknown,
    _ctx: unknown,
    role?: string,
  ) => {
    if (role !== "editor" && mocks.shared) return sql`true`;
    const editorIds = sql.join(
      mocks.editorIds.map((id) => sql`${id}`),
      sql`, `,
    );
    return mocks.editorIds.length
      ? sql`(${table.ownerEmail} = ${mocks.email} or ${table.id} in (${editorIds}))`
      : sql`${table.ownerEmail} = ${mocks.email}`;
  },
}));

import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";

import listAiRequests from "./list-ai-requests";

async function insertRecording(id: string, title: string, owner: string) {
  await client.query(
    `INSERT INTO recordings (id, owner_email, title, title_source, status, created_at)
     VALUES ($1, $2, $3, 'manual', 'ready', '2026-09-28T12:00:00.000Z')`,
    [id, owner, title],
  );
}

beforeEach(async () => {
  client = await PGlite.create("memory://");
  db = drizzle(client);
  await client.query(`CREATE TABLE recordings (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL,
    title_source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
    expires_at TEXT, trashed_at TEXT
  )`);
  await client.query(`CREATE TABLE recording_transcripts (
    recording_id TEXT PRIMARY KEY, status TEXT NOT NULL,
    full_text TEXT NOT NULL, segments_json TEXT NOT NULL
  )`);
  await client.query(`CREATE TABLE application_state (
    session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (session_id, key)
  )`);
  mocks.appState = [];
  mocks.otherAppState = [];
  mocks.shared = false;
  mocks.email = "me@example.com";
  mocks.editorIds = [];
  mocks.inaccessibleThreads = [];
  mocks.runRefs.clear();
  mocks.turnRuns.clear();
  mocks.runStatuses.clear();
  mocks.runEvents.clear();
  mocks.runReadError = null;
  mocks.beforeCompare = null;
  mocks.compare.mockReset();
  mocks.compareMany.mockReset();
  mocks.readRun.mockReset();
});

afterEach(async () => {
  await client.close();
});

describe("list-ai-requests title candidates", () => {
  const seed = async () => {
    await client.query(
      `INSERT INTO recordings (id, owner_email, title, title_source, status, created_at)
       VALUES ('rec_c', 'me@example.com', 'Untitled recording', 'default', 'ready', '2026-09-28T12:00:00.000Z')`,
    );
    await client.query(
      `INSERT INTO recording_transcripts (recording_id, status, full_text, segments_json)
       VALUES ('rec_c', 'ready', 'Hello world this is a clip', '[]')`,
    );
  };

  it("lists candidates", async () => {
    await seed();
    const result = (await listAiRequests.run({})) as Record<string, unknown>;
    expect(result.titleCandidates).toHaveLength(1);
  });
});

describe("list-ai-requests", () => {
  it("fills each accessible request's current title from its recording", async () => {
    await insertRecording("rec_mine", "Quarterly planning", "me@example.com");
    await insertRecording("rec_titled", "Live title", "me@example.com");
    await insertRecording("rec_theirs", "Private", "them@example.com");
    mocks.appState = [
      {
        key: "clips-ai-request-rec_mine",
        value: { kind: "regenerate-chapters", recordingId: "rec_mine" },
      },
      {
        key: "clips-ai-request-rec_titled",
        value: {
          kind: "regenerate-title",
          recordingId: "rec_titled",
          currentTitle: "Title when queued",
        },
      },
      {
        key: "clips-ai-request-rec_theirs",
        value: { kind: "remove-silences", recordingId: "rec_theirs" },
      },
    ];

    const result = await listAiRequests.run({});

    expect(result).toEqual({
      requests: [
        {
          kind: "regenerate-chapters",
          recordingId: "rec_mine",
          currentTitle: "Quarterly planning",
        },
        {
          kind: "regenerate-title",
          recordingId: "rec_titled",
          currentTitle: "Title when queued",
        },
      ],
      activeSessions: [],
      titleCandidates: [],
    });
  });

  it("recovers accepted filler sessions and filters their consumed queue entries", async () => {
    await insertRecording("rec_filler", "Filler cleanup", "me@example.com");
    const requestedAt = "2026-09-28T12:00:00.000Z";
    mocks.appState = [
      {
        key: "clips-ai-request-rec_filler",
        value: {
          kind: "remove-filler-words",
          recordingId: "rec_filler",
          requestedAt,
        },
      },
      {
        key: "clips-ai-request-status-rec_filler",
        value: {
          kind: "remove-filler-words",
          status: "working",
          requestedAt,
          operationId: "operation-1",
          threadId: "thread-1",
          turnId: "turn-1",
          runId: "run-1",
        },
      },
    ];

    const result = await (listAiRequests as any).run({});

    expect(result.requests).toEqual([]);
    expect(result.activeSessions).toEqual([
      {
        recordingId: "rec_filler",
        kind: "remove-filler-words",
        status: "working",
        requestedAt,
        operationId: "operation-1",
        threadId: "thread-1",
        turnId: "turn-1",
        runId: "run-1",
      },
    ]);
  });

  it("keeps a working filler request dispatchable until its receipt is persisted", async () => {
    await insertRecording("rec_filler", "Filler cleanup", "me@example.com");
    const requestedAt = "2026-09-28T12:00:00.000Z";
    mocks.appState = [
      {
        key: "clips-ai-request-rec_filler",
        value: {
          kind: "remove-filler-words",
          recordingId: "rec_filler",
          requestedAt,
        },
      },
      {
        key: "clips-ai-request-status-rec_filler",
        value: {
          kind: "remove-filler-words",
          status: "working",
          requestedAt,
          operationId: "operation-1",
        },
      },
    ];

    const result = await (listAiRequests as any).run({});

    expect(result.requests).toHaveLength(1);
    expect(result.activeSessions).toEqual([]);
  });

  it("only lists queued workflow requests to their requester", async () => {
    await insertRecording("rec_mine", "My workflow", "me@example.com");
    await insertRecording("rec_other", "Other workflow", "me@example.com");
    const requestedAt = "2026-09-28T12:00:00.000Z";
    mocks.appState = [
      {
        key: "clips-ai-request-rec_mine",
        value: {
          kind: "generate-workflow",
          recordingId: "rec_mine",
          requestedAt,
        },
      },
      {
        key: "clips-ai-request-rec_other",
        value: {
          kind: "generate-workflow",
          recordingId: "rec_other",
          requestedAt,
        },
      },
      {
        key: "clips-workflow-rec_mine",
        value: {
          status: "generating",
          requestedAt,
          requestedBy: "me@example.com",
        },
      },
      {
        key: "clips-workflow-rec_other",
        value: {
          status: "generating",
          requestedAt,
          requestedBy: "someone@example.com",
        },
      },
    ];

    const result = await listAiRequests.run({});

    expect(result.requests).toEqual([
      expect.objectContaining({
        kind: "generate-workflow",
        recordingId: "rec_mine",
      }),
    ]);
  });

  it("recovers working sessions for every queued request kind", async () => {
    await insertRecording("rec_chapters", "Chapters", "me@example.com");
    const requestedAt = "2026-09-28T12:00:00.000Z";
    mocks.appState = [
      {
        key: "clips-ai-request-status-rec_chapters",
        value: {
          kind: "regenerate-chapters",
          status: "working",
          requestedAt,
          operationId: "operation-2",
          threadId: "thread-2",
          turnId: "turn-2",
        },
      },
    ];

    const result = await (listAiRequests as any).run({});

    expect(result.activeSessions).toEqual([
      expect.objectContaining({
        recordingId: "rec_chapters",
        kind: "regenerate-chapters",
        operationId: "operation-2",
      }),
    ]);
  });

  it("recovers only generating workflows that have a background session tab", async () => {
    await insertRecording("rec_flow", "Workflow", "me@example.com");
    await insertRecording("rec_legacy", "Legacy", "me@example.com");
    const requestedAt = "2026-09-28T12:00:00.000Z";
    const tabId = "clips-workflow:rec_flow:2026:req-1:run";
    mocks.appState = [
      {
        key: "clips-workflow-rec_flow",
        value: { status: "generating", requestedAt, requestId: "req-1", tabId },
      },
      {
        key: "clips-workflow-rec_legacy",
        value: {
          status: "generating",
          requestedAt,
          requestId: "req-2",
          tabId: "clips-workflow:rec_legacy:2026:req-2:chat-abc",
        },
      },
      {
        key: "clips-workflow-rec_done",
        value: { status: "ready", requestedAt, requestId: "req-0", tabId },
      },
    ];

    const result = await (listAiRequests as any).run({});

    expect(result.activeSessions).toEqual([
      {
        recordingId: "rec_flow",
        kind: "generate-workflow",
        requestedAt,
        requestId: "req-1",
        operationId: tabId,
        threadId: tabId,
        turnId: backgroundAgentTurnIdForReceipt(tabId, tabId),
      },
    ]);
  });
});

// oracle-change: run termination no longer proves the requested change or an atomic failure.
describe("AI request monitoring", () => {
  const statusKey = (id: string) => `clips-ai-request-status-${id}`;
  const receipt = (id: string) => ({
    kind: "generate-metadata",
    status: "working",
    requestedAt: "2026-09-28T12:00:00.000Z",
    operationId: `operation-${id}`,
    threadId: `thread-${id}`,
    turnId: `turn-${id}`,
    runId: `run-${id}`,
    message: "working",
  });
  const seed = async (id: string, status: string, owner = "me@example.com") => {
    await insertRecording(id, id, owner);
    const state = receipt(id);
    mocks.appState.push({ key: statusKey(id), value: state });
    mocks.runRefs.set(`run-${id}`, {
      threadId: state.threadId,
      turnId: state.turnId,
    });
    mocks.turnRuns.set(`${state.threadId}/${state.turnId}`, [`run-${id}`]);
    mocks.runStatuses.set(`run-${id}`, status);
    return state;
  };

  it("keeps a completed run active when no requested change was proven", async () => {
    const original = await seed("rec", "completed");
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      { runId: "run-rec", seq: 1, event: { type: "done" } },
    ]);
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([expect.objectContaining(original)]);
    expect(mocks.appState[0].value).toEqual(original);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("does not settle a verification failure while a same-turn successor can race", async () => {
    const original = await seed("rec", "errored");
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      {
        runId: "run-rec",
        seq: 1,
        event: {
          type: "error",
          error: "Verify email",
          errorCode: "email_verification_required",
          providerRetryable: false,
        },
      },
    ]);
    mocks.beforeCompare = () => {
      mocks.turnRuns.set(`${original.threadId}/${original.turnId}`, [
        "run-rec",
        "run-next",
      ]);
      mocks.runStatuses.set("run-next", "running");
    };
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([expect.objectContaining(original)]);
    expect(mocks.appState).toEqual([
      { key: statusKey("rec"), value: original },
    ]);
    expect(mocks.compareMany).not.toHaveBeenCalled();
  });

  it("does not replace an existing title-suppression marker when listing a failure", async () => {
    const original = await seed("rec", "errored");
    const marker = { suppressed: true, requestedAt: "newer-request" };
    mocks.appState.push({ key: "clips-ai-title-terminal-rec", value: marker });
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      {
        runId: "run-rec",
        seq: 1,
        event: {
          type: "error",
          error: "Verify email",
          errorCode: "email_verification_required",
          providerRetryable: false,
        },
      },
    ]);
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([expect.objectContaining(original)]);
    expect(mocks.appState).toEqual([
      { key: statusKey("rec"), value: original },
      { key: "clips-ai-title-terminal-rec", value: marker },
    ]);
  });

  it("lists only caller-scoped, accessible sessions without mutating either user's state", async () => {
    await seed("owned", "completed");
    await seed("private", "errored", "owner@example.com");
    const other = receipt("owned");
    mocks.otherAppState = [{ key: statusKey("owned"), value: other }];
    const before = structuredClone(mocks.appState);
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([
      expect.objectContaining({ recordingId: "owned" }),
    ]);
    expect(mocks.appState).toEqual(before);
    expect(mocks.otherAppState).toEqual([
      { key: statusKey("owned"), value: other },
    ]);
  });
});

it("withholds queued content from expired nonowners while preserving owner work", async () => {
  mocks.shared = true;
  await insertRecording(
    "expired-shared",
    "Fake expired title",
    "owner@example.test",
  );
  await insertRecording("expired-owned", "Fake owner title", "me@example.com");
  await insertRecording("live-shared", "Fake live title", "owner@example.test");
  await client.query(
    "update recordings set expires_at = '2000-01-01T00:00:00Z' where id != 'live-shared'",
  );
  mocks.appState = ["expired-shared", "expired-owned", "live-shared"].map(
    (recordingId) => ({
      key: `clips-ai-request-${recordingId}`,
      value: {
        kind: "regenerate-chapters",
        recordingId,
        transcript: "Fake queued transcript",
      },
    }),
  );
  expect(
    (await listAiRequests.run({})).requests.map(
      (request) => request.recordingId,
    ),
  ).toEqual(["expired-owned", "live-shared"]);
});
