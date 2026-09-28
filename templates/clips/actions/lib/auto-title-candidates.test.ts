import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: ReturnType<typeof drizzle>;
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

let client: PGliteClient;

vi.mock("../../server/db/index.js", async () => {
  const schema = await import("../../server/db/schema.js");
  return { getDb: () => db, schema };
});

import { listAutoTitleCandidates } from "./auto-title-candidates";

type Row = {
  id: string;
  owner?: string;
  title?: string;
  titleSource?: string;
  status?: string;
  trashedAt?: string | null;
  transcript?: {
    status?: string;
    fullText?: string;
    segmentsJson?: string;
  } | null;
};

async function insert(row: Row) {
  await client.query(
    `INSERT INTO recordings (id, owner_email, title, title_source, status, created_at, trashed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.id,
      row.owner ?? "Owner@Example.com",
      row.title ?? "Untitled recording",
      row.titleSource ?? "default",
      row.status ?? "ready",
      `2026-09-28T12:00:${row.id.slice(-2)}.000Z`,
      row.trashedAt ?? null,
    ],
  );
  if (row.transcript === null) return;
  await client.query(
    `INSERT INTO recording_transcripts (recording_id, status, full_text, segments_json)
     VALUES ($1, $2, $3, $4)`,
    [
      row.id,
      row.transcript?.status ?? "ready",
      row.transcript?.fullText ?? "hello world",
      row.transcript?.segmentsJson ?? "[]",
    ],
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
});

afterEach(async () => {
  await client.close();
});

describe("listAutoTitleCandidates", () => {
  it("returns only the owner's ready, untitled clips with transcript text", async () => {
    await insert({ id: "rec_01" });
    await insert({ id: "rec_02", titleSource: "context", title: "Chrome" });
    await insert({
      id: "rec_03",
      titleSource: "manual",
      title: "Untitled recording",
    });
    await insert({
      id: "rec_04",
      transcript: {
        fullText: "",
        segmentsJson: '[{"startMs":0,"text":"hi"}]',
      },
    });
    await insert({ id: "rec_10", titleSource: "manual", title: "Planning" });
    await insert({
      id: "rec_11",
      titleSource: "ai",
      title: "Demo walkthrough",
    });
    await insert({ id: "rec_12", status: "processing" });
    await insert({ id: "rec_13", trashedAt: "2026-09-28T12:30:00.000Z" });
    await insert({ id: "rec_14", transcript: { status: "pending" } });
    await insert({
      id: "rec_15",
      transcript: { fullText: "   ", segmentsJson: '[{"text":""}]' },
    });
    await insert({ id: "rec_16", transcript: null });
    await insert({ id: "rec_17", owner: "someone@example.com" });

    const candidates = await listAutoTitleCandidates("owner@example.com");

    expect(candidates.map((c) => c.id)).toEqual([
      "rec_04",
      "rec_03",
      "rec_02",
      "rec_01",
    ]);
    expect(candidates[3]).toEqual({
      id: "rec_01",
      createdAt: "2026-09-28T12:00:01.000Z",
    });
  });
});
