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
  listAppState: async () => mocks.appState,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "me@example.com",
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (table: { ownerEmail: unknown }) =>
    sql`${table.ownerEmail} = 'me@example.com'`,
}));

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
      titleCandidates: [],
    });
  });
});
