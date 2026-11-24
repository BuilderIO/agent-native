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

describe("server-side AI request reconciliation", () => {
  const statusKey = (id: string) => `clips-ai-request-status-${id}`;
  const receipt = (id: string, runId: string | undefined = `run-${id}`) => ({
    kind: "generate-metadata",
    status: "working",
    requestedAt: "2026-09-28T12:00:00.000Z",
    operationId: `operation-${id}`,
    threadId: `thread-${id}`,
    turnId: `turn-${id}`,
    ...(runId ? { runId } : {}),
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
    if (status === "completed") {
      mocks.runEvents.set(`${state.threadId}/${state.turnId}`, [
        { runId: `run-${id}`, seq: 1, event: { type: "done" } },
      ]);
    }
    return state;
  };

  it("reconciles a durably completed run", async () => {
    const original = await seed("rec", "completed");
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([]);
    expect(mocks.appState[0].value).toEqual({
      ...original,
      status: "completed",
      updatedAt: expect.any(String),
    });
    expect(mocks.compare).toHaveBeenCalledWith(
      statusKey("rec"),
      original,
      mocks.appState[0].value,
    );
  });

  it.each(["aborted", "truncated", "errored"])(
    "keeps a potentially recoverable %s run active without erasing its message",
    async (runStatus) => {
      const original = {
        ...(await seed("rec", runStatus)),
        message: "Verify your email before continuing",
      };
      mocks.appState[0].value = original;
      expect((await listAiRequests.run({})).activeSessions).toEqual([
        expect.objectContaining(original),
      ]);
      expect(mocks.appState[0].value).toEqual(original);
      expect(mocks.compare).not.toHaveBeenCalled();
    },
  );

  it.each(["absent", "auto_continue"])(
    "keeps a completed chunk active when final evidence is %s",
    async (terminalEvent) => {
      const original = await seed("rec", "completed");
      mocks.runEvents.delete(`${original.threadId}/${original.turnId}`);
      if (terminalEvent === "auto_continue") {
        mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
          { runId: "run-rec", seq: 1, event: { type: "auto_continue" } },
        ]);
      }
      expect((await listAiRequests.run({})).activeSessions).toEqual([
        expect.objectContaining(original),
      ]);
      expect(mocks.appState[0].value).toEqual(original);
      expect(mocks.compare).not.toHaveBeenCalled();
    },
  );

  it("preserves existing detail when a final completion is reconciled", async () => {
    const original = {
      ...(await seed("rec", "completed")),
      message: "Verify your email before continuing",
    };
    mocks.appState[0].value = original;
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      { runId: "run-rec", seq: 1, event: { type: "done" } },
    ]);
    expect((await listAiRequests.run({})).activeSessions).toEqual([]);
    expect(mocks.appState[0].value).toEqual({
      ...original,
      status: "completed",
      updatedAt: expect.any(String),
    });
  });

  it("reconciles an explicitly terminal verification error and atomically suppresses auto-title", async () => {
    const original = await seed("rec", "errored");
    await client.query(
      "update recordings set title_source = 'default', title = 'Untitled recording' where id = 'rec'",
    );
    await client.query(
      "insert into recording_transcripts (recording_id, status, full_text, segments_json) values ('rec', 'ready', 'Example transcript', '[]')",
    );
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      {
        runId: "run-rec",
        seq: 1,
        event: {
          type: "error",
          error: "An email must be verified",
          errorCode: "email_verification_required",
          providerRetryable: false,
        },
      },
    ]);
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([]);
    expect(result.titleCandidates).toEqual([]);
    expect(
      mocks.appState.find((entry) => entry.key === statusKey("rec"))?.value,
    ).toEqual({
      ...original,
      status: "failed",
      message:
        "AI is paused until an email address in this workspace is verified. Check the inbox for the verification link, then retry.",
      updatedAt: expect.any(String),
    });
    expect(
      mocks.appState.find(
        (entry) => entry.key === "clips-ai-title-terminal-rec",
      )?.value,
    ).toEqual({
      kind: original.kind,
      status: "failed",
      requestedAt: original.requestedAt,
      suppressed: true,
    });
    expect(mocks.compareMany).toHaveBeenCalledOnce();
  });

  it("settles a non-title verification failure without creating a title marker", async () => {
    const original = {
      ...(await seed("rec", "errored")),
      kind: "regenerate-chapters",
    };
    mocks.appState[0].value = original;
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      {
        runId: "run-rec",
        seq: 1,
        event: {
          type: "error",
          error: "An email must be verified",
          errorCode: "email_verification_required",
          recoverable: false,
        },
      },
    ]);
    expect((await listAiRequests.run({})).activeSessions).toEqual([]);
    expect(mocks.appState[0].value).toMatchObject({
      status: "failed",
      message:
        "AI is paused until an email address in this workspace is verified. Check the inbox for the verification link, then retry.",
    });
    expect(
      mocks.appState.find(
        (entry) => entry.key === "clips-ai-title-terminal-rec",
      ),
    ).toBeUndefined();
  });

  it("leaves the status unchanged if the suppression marker races", async () => {
    const original = await seed("rec", "errored");
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      {
        runId: "run-rec",
        seq: 1,
        event: {
          type: "error",
          error: "An email must be verified",
          errorCode: "email_verification_required",
          providerRetryable: false,
        },
      },
    ]);
    mocks.beforeCompare = () => {
      mocks.appState.push({
        key: "clips-ai-title-terminal-rec",
        value: { suppressed: true, requestedAt: "newer" },
      });
    };
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([expect.objectContaining(original)]);
    expect(mocks.appState[0].value).toEqual(original);
    expect(mocks.appState[1].value).toEqual({
      suppressed: true,
      requestedAt: "newer",
    });
  });

  it.each([
    "missing",
    "ambiguous",
    "recoverable",
    "wrong-code",
    "continuation",
    "successor",
  ])(
    "keeps verification errors active when evidence is %s",
    async (scenario) => {
      const original = await seed("rec", "errored");
      const event = {
        type: "error",
        error: "An email must be verified",
        errorCode: "email_verification_required",
        providerRetryable: false,
      };
      if (scenario !== "missing") {
        mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
          {
            runId: "run-rec",
            seq: 1,
            event:
              scenario === "ambiguous"
                ? { ...event, providerRetryable: undefined }
                : scenario === "recoverable"
                  ? { ...event, recoverable: true }
                  : scenario === "wrong-code"
                    ? { ...event, errorCode: "timeout" }
                    : event,
          },
          ...(scenario === "continuation"
            ? [{ runId: "run-rec", seq: 2, event: { type: "auto_continue" } }]
            : []),
        ]);
      }
      if (scenario === "successor") {
        mocks.turnRuns.set(`${original.threadId}/${original.turnId}`, [
          "run-rec",
          "run-next",
        ]);
        mocks.runStatuses.set("run-next", "running");
      }
      expect((await listAiRequests.run({})).activeSessions).toEqual([
        expect.objectContaining(original),
      ]);
      expect(mocks.appState[0].value).toEqual(original);
      expect(mocks.compareMany).not.toHaveBeenCalled();
    },
  );

  it("does not reconcile a verification failure for a viewer or another user's thread", async () => {
    mocks.shared = true;
    const viewer = await seed("viewer", "errored", "owner@example.com");
    const otherThread = await seed("other", "errored");
    mocks.inaccessibleThreads = [otherThread.threadId];
    for (const [id, state] of [
      ["viewer", viewer],
      ["other", otherThread],
    ] as const) {
      mocks.runEvents.set(`${state.threadId}/${state.turnId}`, [
        {
          runId: `run-${id}`,
          seq: 1,
          event: {
            type: "error",
            error: "An email must be verified",
            errorCode: "email_verification_required",
            recoverable: false,
          },
        },
      ]);
    }
    expect((await listAiRequests.run({})).activeSessions).toHaveLength(2);
    expect(mocks.compareMany).not.toHaveBeenCalled();
    expect(mocks.readRun).not.toHaveBeenCalled();
  });

  it("does not suppress or overwrite a newer request when verification settlement races", async () => {
    const original = await seed("rec", "errored");
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      {
        runId: "run-rec",
        seq: 1,
        event: {
          type: "error",
          error: "An email must be verified",
          errorCode: "email_verification_required",
          recoverable: false,
        },
      },
    ]);
    const newer = {
      ...original,
      operationId: "new-operation",
      threadId: "new-thread",
      turnId: "new-turn",
    };
    mocks.beforeCompare = () => {
      mocks.appState[0].value = newer;
    };
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([expect.objectContaining(newer)]);
    expect(mocks.appState[0].value).toEqual(newer);
    expect(
      mocks.appState.find(
        (entry) => entry.key === "clips-ai-title-terminal-rec",
      ),
    ).toBeUndefined();
  });

  it("finds a receipt without a run ID and uses the newest same-turn continuation", async () => {
    const original = await seed("rec", "completed");
    mocks.appState[0].value = receipt("rec", "");
    mocks.turnRuns.set(`${original.threadId}/${original.turnId}`, [
      "run-rec",
      "run-next",
    ]);
    mocks.runStatuses.set("run-next", "running");
    expect((await listAiRequests.run({})).activeSessions).toHaveLength(1);
    expect(mocks.compare).not.toHaveBeenCalled();
    mocks.runStatuses.set("run-next", "completed");
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      { runId: "run-rec", seq: 1, event: { type: "auto_continue" } },
      { runId: "run-next", seq: 1, event: { type: "done" } },
    ]);
    expect((await listAiRequests.run({})).activeSessions).toEqual([]);
    expect(mocks.appState[0].value).toMatchObject({
      status: "completed",
      runId: "run-next",
    });
  });

  it.each([
    "missing",
    "wrong-thread",
    "wrong-turn",
    "missing-from-turn",
    "unknown-status",
  ])("leaves an unverified run active: %s", async (reason) => {
    const original = await seed("rec", "completed");
    if (reason === "missing") mocks.runRefs.delete("run-rec");
    if (reason === "wrong-thread")
      mocks.runRefs.set("run-rec", {
        threadId: "other",
        turnId: original.turnId,
      });
    if (reason === "wrong-turn")
      mocks.runRefs.set("run-rec", {
        threadId: original.threadId,
        turnId: "other",
      });
    if (reason === "missing-from-turn")
      mocks.turnRuns.set(`${original.threadId}/${original.turnId}`, []);
    if (reason === "unknown-status") mocks.runStatuses.delete("run-rec");
    expect((await listAiRequests.run({})).activeSessions).toEqual([
      expect.objectContaining(original),
    ]);
    expect(mocks.appState[0].value).toEqual(original);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("keeps a receipt without any durable run available for browser monitoring", async () => {
    await seed("rec", "completed");
    const original = receipt("rec", "");
    mocks.appState[0].value = original;
    mocks.turnRuns.clear();
    expect((await listAiRequests.run({})).activeSessions).toEqual([
      expect.objectContaining(original),
    ]);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("leaves a truncated continuation boundary to the browser monitor", async () => {
    const original = await seed("rec", "truncated");
    mocks.runEvents.set(`${original.threadId}/${original.turnId}`, [
      { runId: "run-rec", seq: 1, event: { type: "auto_continue" } },
    ]);
    expect((await listAiRequests.run({})).activeSessions).toEqual([
      expect.objectContaining(original),
    ]);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("does not settle a predecessor when a continuation appears during the read", async () => {
    const original = await seed("rec", "completed");
    let reads = 0;
    mocks.readRun.mockImplementation((id: string) => {
      if (id === "run-rec" && ++reads === 2) {
        mocks.turnRuns.set(`${original.threadId}/${original.turnId}`, [
          "run-rec",
          "run-next",
        ]);
      }
    });
    expect((await listAiRequests.run({})).activeSessions).toEqual([
      expect.objectContaining(original),
    ]);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("does not settle a run whose durable status changes during the read", async () => {
    const original = await seed("rec", "completed");
    let reads = 0;
    mocks.readRun.mockImplementation((id: string) => {
      if (id === `${original.threadId}/${original.turnId}` && ++reads === 2) {
        mocks.runStatuses.set("run-rec", "running");
      }
    });
    expect((await listAiRequests.run({})).activeSessions).toEqual([
      expect.objectContaining(original),
    ]);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("does not treat an unreadable durable run as a terminal result", async () => {
    const original = await seed("rec", "completed");
    mocks.runReadError = new Error("run store unavailable");
    await expect(listAiRequests.run({})).rejects.toThrow(
      "run store unavailable",
    );
    expect(mocks.appState[0].value).toEqual(original);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer receipt after a compare-and-set race", async () => {
    const original = await seed("rec", "completed");
    const newer = {
      ...original,
      operationId: "new-operation",
      requestedAt: "2026-09-29T12:00:00.000Z",
      threadId: "new-thread",
      turnId: "new-turn",
    };
    mocks.beforeCompare = () => {
      mocks.appState[0].value = newer;
    };
    const result = await listAiRequests.run({});
    expect(mocks.appState[0].value).toEqual(newer);
    expect(result.activeSessions).toEqual([expect.objectContaining(newer)]);
  });

  it("does not inspect a receipt pointing at another user's thread", async () => {
    const original = await seed("rec", "completed");
    mocks.inaccessibleThreads = [original.threadId];
    expect((await listAiRequests.run({})).activeSessions).toEqual([
      expect.objectContaining(original),
    ]);
    expect(mocks.readRun).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("does not inspect sessions for inaccessible or expired recordings", async () => {
    await seed("private", "completed", "owner@example.com");
    await seed("expired", "completed", "owner@example.com");
    mocks.editorIds = ["expired"];
    await client.query(
      "update recordings set expires_at = '2000-01-01T00:00:00Z' where id = 'expired'",
    );
    const result = await listAiRequests.run({});
    expect(result.activeSessions).toEqual([]);
    expect(mocks.readRun).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("reconciles editor-authorized recordings only in the caller's app state", async () => {
    mocks.shared = true;
    mocks.editorIds = ["editor"];
    await seed("owned", "completed");
    await seed("editor", "completed", "owner@example.com");
    const viewer = await seed("viewer", "completed", "owner@example.com");
    const other = receipt("owned");
    mocks.otherAppState = [{ key: statusKey("owned"), value: other }];
    const result = await listAiRequests.run({});
    expect(
      mocks.appState.map((entry) => (entry.value as { status: string }).status),
    ).toEqual(["completed", "completed", "working"]);
    expect(result.activeSessions).toEqual([
      expect.objectContaining({ recordingId: "viewer", ...viewer }),
    ]);
    expect(mocks.otherAppState[0].value).toEqual(other);
    expect(mocks.readRun).not.toHaveBeenCalledWith("run-viewer");
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
