import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SOURCE_HEAD_BYTES,
  sourceHeadSha256,
} from "../../shared/source-fingerprint.js";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { getDb: () => mocks.db, schema };
});

import {
  findUploadedSourceRecording,
  recordSourceHeadFromFirstChunk,
} from "./source-fingerprint.js";

// Only the recordings columns these helpers read or write, plus migration
// v100's column and index as server/plugins/db.ts declares them.
const RECORDINGS_DDL = `
  CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'org-1',
    owner_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploading',
    trashed_at TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );
  ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source_head_sha256 TEXT;
  CREATE INDEX IF NOT EXISTS recordings_source_head_idx ON recordings (source_head_sha256) WHERE source_head_sha256 IS NOT NULL;
`;

let client: Awaited<ReturnType<typeof PGlite.create>>;

async function seed(row: {
  id: string;
  ownerEmail?: string;
  status?: string;
  trashedAt?: string | null;
  createdAt?: string;
  sha256?: string | null;
}) {
  await client.query(
    `INSERT INTO recordings (id, owner_email, status, trashed_at, created_at, source_head_sha256)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.id,
      row.ownerEmail ?? "owner@example.com",
      row.status ?? "ready",
      row.trashedAt ?? null,
      row.createdAt ?? "2026-11-01T00:00:00.000Z",
      row.sha256 ?? null,
    ],
  );
}

async function storedSha256(id: string) {
  const result = await client.query(
    `SELECT source_head_sha256 FROM recordings WHERE id = $1`,
    [id],
  );
  const row = result.rows[0] as { source_head_sha256: string | null };
  return row.source_head_sha256;
}

function fileBytes(length: number, seed = 1) {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 256);
}

beforeAll(async () => {
  client = await PGlite.create("memory://");
  await client.exec(RECORDINGS_DDL);
  mocks.db = drizzle(client);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec(`DELETE FROM recordings`);
});

describe("sourceHeadSha256", () => {
  it("hashes only the first megabyte, or all of a shorter file", async () => {
    const file = fileBytes(SOURCE_HEAD_BYTES + 10);
    expect(await sourceHeadSha256(file)).toBe(
      await sourceHeadSha256(file.subarray(0, SOURCE_HEAD_BYTES)),
    );
    expect(await sourceHeadSha256(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("findUploadedSourceRecording", () => {
  it("finds the owner's newest ready clip with the fingerprint", async () => {
    const sha256 = "a".repeat(64);
    await seed({ id: "older", sha256, createdAt: "2026-10-01T00:00:00.000Z" });
    await seed({ id: "newer", sha256, createdAt: "2026-10-24T00:00:00.000Z" });

    await expect(
      findUploadedSourceRecording("Owner@Example.com", sha256),
    ).resolves.toEqual({
      id: "newer",
      organizationId: "org-1",
      status: "ready",
    });
  });

  it("ignores other owners, trashed clips and clips that could still fail", async () => {
    const sha256 = "b".repeat(64);
    await seed({ id: "theirs", sha256, ownerEmail: "other@example.com" });
    await seed({
      id: "trashed",
      sha256,
      trashedAt: "2026-10-25T00:00:00.000Z",
    });
    await seed({ id: "uploading", sha256, status: "uploading" });
    await seed({ id: "processing", sha256, status: "processing" });
    await seed({ id: "failed", sha256, status: "failed" });
    await seed({ id: "different", sha256: "c".repeat(64) });

    await expect(
      findUploadedSourceRecording("owner@example.com", sha256),
    ).resolves.toBeNull();
  });
});

describe("recordSourceHeadFromFirstChunk", () => {
  it("stores the fingerprint of a first chunk that covers the head", async () => {
    await seed({ id: "rec-1", status: "uploading" });
    const chunk = fileBytes(SOURCE_HEAD_BYTES + 5);

    await recordSourceHeadFromFirstChunk({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      index: 0,
      bytes: chunk,
      isFinal: false,
    });

    expect(await storedSha256("rec-1")).toBe(await sourceHeadSha256(chunk));
  });

  it("stores a short file sent as one final chunk", async () => {
    await seed({ id: "rec-1", status: "uploading" });
    const file = fileBytes(4096);

    await recordSourceHeadFromFirstChunk({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      index: 0,
      bytes: file,
      isFinal: true,
    });

    expect(await storedSha256("rec-1")).toBe(await sourceHeadSha256(file));
  });

  it("skips later chunks and a live recording's short first chunk", async () => {
    await seed({ id: "rec-1", status: "uploading" });
    for (const input of [
      { index: 0, bytes: fileBytes(4096), isFinal: false },
      { index: 1, bytes: fileBytes(SOURCE_HEAD_BYTES), isFinal: false },
    ]) {
      await recordSourceHeadFromFirstChunk({
        recordingId: "rec-1",
        ownerEmail: "owner@example.com",
        ...input,
      });
    }

    expect(await storedSha256("rec-1")).toBeNull();
  });

  it("fails the chunk when the fingerprint cannot be stored", async () => {
    const realDb = mocks.db;
    const outage = new Error("database unavailable");
    mocks.db = {
      update: () => {
        throw outage;
      },
    };
    try {
      await expect(
        recordSourceHeadFromFirstChunk({
          recordingId: "rec-1",
          ownerEmail: "owner@example.com",
          index: 0,
          bytes: fileBytes(SOURCE_HEAD_BYTES),
          isFinal: false,
        }),
      ).rejects.toBe(outage);
    } finally {
      mocks.db = realDb;
    }
  });

  it("replaces an earlier fingerprint with the uploaded bytes' and never touches another owner's row", async () => {
    await seed({ id: "rec-1", status: "uploading", sha256: "d".repeat(64) });
    await seed({
      id: "rec-2",
      status: "uploading",
      ownerEmail: "other@example.com",
    });
    const chunk = fileBytes(SOURCE_HEAD_BYTES, 7);

    for (const recordingId of ["rec-1", "rec-2"]) {
      await recordSourceHeadFromFirstChunk({
        recordingId,
        ownerEmail: "owner@example.com",
        index: 0,
        bytes: chunk,
        isFinal: false,
      });
    }

    expect(await storedSha256("rec-1")).toBe(await sourceHeadSha256(chunk));
    expect(await storedSha256("rec-2")).toBeNull();
  });
});
