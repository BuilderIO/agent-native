import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: ReturnType<typeof drizzle>;
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

let client: PGliteClient;
const state = vi.hoisted(() => ({
  caller: "owner@example.com",
  entries: [] as Array<{
    key: string;
    value: Record<string, unknown>;
    session?: string;
  }>,
}));
vi.mock("@agent-native/core/application-state", () => ({
  listAppState: async (prefix: string) =>
    state.entries.filter(
      (entry) =>
        entry.key.startsWith(prefix) &&
        (entry.session ?? "owner@example.com") === state.caller,
    ),
}));

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
  state.entries = [];
  state.caller = "owner@example.com";
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
  it("filters durable and legacy terminal outcomes before the limit", async () => {
    for (let index = 0; index < 60; index++) {
      const id = `rec_${String(index).padStart(2, "0")}`;
      await insert({ id });
      if (index > 0)
        state.entries.push({
          key: `clips-ai-title-terminal-${id}`,
          value: { suppressed: true },
        });
    }
    await insert({ id: "rec_60" });
    state.entries.push({
      key: "clips-ai-request-status-rec_60",
      value: { kind: "generate-metadata", status: "cancelled" },
    });
    expect(
      (await listAutoTitleCandidates("owner@example.com")).map(({ id }) => id),
    ).toEqual(["rec_00"]);
  });

  it("does not use another caller's marker for this owner's candidates", async () => {
    await insert({ id: "rec_01" });
    state.entries.push({
      session: "other@example.com",
      key: "clips-ai-title-terminal-rec_01",
      value: { suppressed: true },
    });
    expect(
      (await listAutoTitleCandidates("owner@example.com")).map(({ id }) => id),
    ).toEqual(["rec_01"]);
  });

  it.each(["failed", "truncated", "cancelled"])(
    "filters legacy terminal %s",
    async (status) => {
      await insert({ id: "rec_01" });
      state.entries.push({
        key: "clips-ai-request-status-rec_01",
        value: { kind: "regenerate-title", status },
      });
      expect(await listAutoTitleCandidates("owner@example.com")).toEqual([]);
    },
  );

  it("keeps completed, unrelated and unsuppressed requests eligible", async () => {
    for (const id of ["rec_01", "rec_02", "rec_03"]) await insert({ id });
    state.entries.push(
      {
        key: "clips-ai-request-status-rec_01",
        value: { kind: "generate-metadata", status: "completed" },
      },
      {
        key: "clips-ai-request-status-rec_02",
        value: { kind: "regenerate-summary", status: "failed" },
      },
      { key: "clips-ai-title-terminal-rec_03", value: { suppressed: false } },
    );
    expect(
      (await listAutoTitleCandidates("owner@example.com")).map(({ id }) => id),
    ).toEqual(["rec_03", "rec_02", "rec_01"]);
  });

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

    expect(candidates.map((c) => c.id)).toEqual(["rec_04", "rec_02", "rec_01"]);
    expect(candidates[2]).toEqual({
      id: "rec_01",
      createdAt: "2026-09-28T12:00:01.000Z",
    });
  });
});
