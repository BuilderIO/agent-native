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
  appState: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  return { getDb: () => db, schema };
});
vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  listAppState: async (prefix: string) =>
    mocks.appState.filter((entry) => entry.key.startsWith(prefix)),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "me@example.com",
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (table: { ownerEmail: unknown }) =>
    sql`${table.ownerEmail} = 'me@example.com'`,
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
    trashed_at TEXT
  )`);
  await client.query(`CREATE TABLE recording_transcripts (
    recording_id TEXT PRIMARY KEY, status TEXT NOT NULL,
    full_text TEXT NOT NULL, segments_json TEXT NOT NULL
  )`);
  mocks.appState = [];
});

afterEach(async () => {
  await client.close();
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

    const result = await (listAiRequests as any).run({});

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

  it("recovers a generating workflow that has a background session tab", async () => {
    await insertRecording("rec_flow", "Workflow", "me@example.com");
    const requestedAt = "2026-09-28T12:00:00.000Z";
    const tabId = "clips-workflow:rec_flow:2026:req-1:run";
    mocks.appState = [
      {
        key: "clips-workflow-rec_flow",
        value: { status: "generating", requestedAt, requestId: "req-1", tabId },
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
