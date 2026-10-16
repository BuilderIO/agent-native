import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

let client: PGliteClient;
let db: ReturnType<typeof drizzle>;
let queries: string[];
const mocks = vi.hoisted(() => ({
  appState: new Map<string, unknown>(),
  writeAppState: vi.fn(),
  isBound: vi.fn(),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async (key: string) => mocks.appState.get(key) ?? null,
  writeAppState: mocks.writeAppState,
}));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/recordings.js", async () => {
  const { eq } = await import("drizzle-orm");
  return {
    getCurrentOwnerEmail: () => "owner@example.com",
    ownerEmailMatches: eq,
  };
});
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  isS3ObjectUrlBoundToRecording: mocks.isBound,
}));
vi.mock("./make-recording-private-for-rewind.js", () => ({
  assertNoDirectRecordingShares: vi.fn(async () => undefined),
}));

import action from "./apply-rewind-extension.js";
import { rewindExtensionKey } from "./request-rewind-extension.js";

async function createTable(table: PgTable) {
  const { name, columns } = getTableConfig(table);
  const definitions = columns.map(
    (column) =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`,
  );
  await client.query(`CREATE TABLE "${name}" (${definitions.join(", ")})`);
}

async function value(sql: string) {
  const { rows } = await client.query(sql);
  return Object.values(rows[0] as Record<string, unknown>)[0];
}

beforeEach(async () => {
  client = await PGlite.create("memory://");
  queries = [];
  db = drizzle(client, {
    logger: { logQuery: (query) => queries.push(query) },
  });
  for (const table of [
    schema.recordings,
    schema.recordingTranscripts,
    schema.recordingComments,
    schema.recordingReactions,
  ]) {
    await createTable(table);
  }
  await client.query(`
    INSERT INTO recordings (id, owner_email, visibility, duration_ms, video_url, storage_mode, edits_json, chapters_json)
    VALUES
      ('rec_1', 'owner@example.com', 'private', 10000, 'https://storage.example/rec_1/original.mp4', 'own', '{}', '[{"startMs":2000,"title":"Made-up chapter"}]'),
      ('pre_1', 'owner@example.com', 'private', 30000, 'https://storage.example/pre_1/pre-roll.mp4', 'own', '{}', '[]')
  `);
  await client.query(`
    INSERT INTO recording_transcripts (recording_id, segments_json)
    VALUES ('rec_1', '[{"startMs":1000,"endMs":4000,"text":"Made-up words."}]')
  `);
  await client.query(
    `INSERT INTO recording_comments (id, recording_id, video_timestamp_ms) VALUES ('c_1', 'rec_1', 5000)`,
  );
  await client.query(
    `INSERT INTO recording_reactions (id, recording_id, video_timestamp_ms) VALUES ('r_1', 'rec_1', 6000)`,
  );
  mocks.appState.clear();
  mocks.writeAppState.mockReset().mockImplementation(async (key, value) => {
    mocks.appState.set(key, value);
  });
  mocks.isBound.mockReset().mockResolvedValue(true);
  mocks.appState.set(rewindExtensionKey("rec_1"), {
    requestId: "req_1",
    recordingId: "rec_1",
    preRollRecordingId: "pre_1",
    seconds: 30,
    status: "ready",
    requestedAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  });
});

afterEach(async () => {
  await client.close();
});

function apply(videoUrl: string) {
  return action.run({
    recordingId: "rec_1",
    requestId: "req_1",
    preRollRecordingId: "pre_1",
    videoUrl,
    durationMs: 40_000,
    addedMs: 30_000,
  });
}

async function expectShiftedOnce() {
  expect(
    await value(
      `SELECT video_timestamp_ms FROM recording_comments WHERE id = 'c_1'`,
    ),
  ).toBe(35_000);
  expect(
    await value(
      `SELECT video_timestamp_ms FROM recording_reactions WHERE id = 'r_1'`,
    ),
  ).toBe(36_000);
  expect(
    JSON.parse(
      String(
        await value(
          `SELECT segments_json FROM recording_transcripts WHERE recording_id = 'rec_1'`,
        ),
      ),
    ),
  ).toMatchObject([{ startMs: 31_000, endMs: 34_000 }]);
  expect(
    JSON.parse(
      String(
        await value(`SELECT chapters_json FROM recordings WHERE id = 'rec_1'`),
      ),
    ),
  ).toMatchObject([{ startMs: 32_000 }]);
  expect(
    await value(`SELECT duration_ms FROM recordings WHERE id = 'rec_1'`),
  ).toBe(40_000);
}

describe("apply-rewind-extension", () => {
  it("shifts the timeline once when two applies of one request race", async () => {
    // Both applies pass every check before either one's transaction starts.
    let arrived = 0;
    let release!: () => void;
    const bothChecked = new Promise<void>((resolve) => (release = resolve));
    mocks.isBound.mockImplementation(async () => {
      if (++arrived === 2) release();
      await bothChecked;
      return true;
    });

    const results = await Promise.all([
      apply("https://storage.example/rec_1/rewind.mp4"),
      apply("https://storage.example/rec_1/rewind-again.mp4"),
    ]);

    expect(results.map((result) => result.request.status)).toEqual([
      "applied",
      "applied",
    ]);
    // PGlite runs one transaction at a time; on Postgres the row lock is
    // what makes the second apply wait for the first.
    expect(
      queries.filter((query) => /from "recordings" .*for update/i.test(query)),
    ).toHaveLength(2);
    await expectShiftedOnce();
  });

  it("finishes a retry after an apply that committed but wasn't marked applied", async () => {
    mocks.writeAppState.mockRejectedValueOnce(new Error("state store down"));
    await expect(
      apply("https://storage.example/rec_1/rewind.mp4"),
    ).rejects.toThrow("state store down");
    expect(mocks.appState.get(rewindExtensionKey("rec_1"))).toMatchObject({
      status: "ready",
    });

    const result = await apply(
      "https://storage.example/rec_1/rewind-again.mp4",
    );

    expect(result.request.status).toBe("applied");
    expect(mocks.appState.get(rewindExtensionKey("rec_1"))).toMatchObject({
      status: "applied",
    });
    await expectShiftedOnce();
    expect(
      await value(`SELECT video_url FROM recordings WHERE id = 'rec_1'`),
    ).toBe("https://storage.example/rec_1/rewind.mp4");
  });
});
