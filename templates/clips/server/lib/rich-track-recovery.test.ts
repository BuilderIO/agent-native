// guard:allow-unscoped - test fixture, not a request path.
import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import type { DbExec } from "@agent-native/core/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { RETRYABLE_UPLOAD_INTERRUPTION_REASON } from "../../shared/upload-interruption.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
type SqlStatement = { sql: string; args?: unknown[] };
let client: PGliteClient;

const mocks = vi.hoisted(() => ({
  contexts: [] as unknown[],
  drafts: new Map<string, unknown>(),
  finalize: vi.fn(),
  discard: vi.fn(),
  deleteDraft: vi.fn(),
}));

vi.mock("@agent-native/core/db", async (original) => {
  const core = await original<typeof import("@agent-native/core/db")>();
  const exec = {
    execute: async (statement: SqlStatement) =>
      client.query(statement.sql, statement.args ?? []),
  };
  const leaseExec: DbExec = {
    async execute(statement) {
      const text = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);
      let position = 0;
      const numbered = text.replace(/\?/g, () => `$${++position}`);
      const result = await client.query(numbered, [...args]);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  };
  const options = { exec: leaseExec };
  return {
    ...core,
    getDbExec: () => exec,
    claimLease: (table: string, key: string, ttlMs: number) =>
      core.claimLease(table, key, ttlMs, options),
    renewLease: (lease: Parameters<typeof core.renewLease>[0], ttlMs: number) =>
      core.renewLease(lease, ttlMs, options),
    releaseLease: (lease: Parameters<typeof core.releaseLease>[0]) =>
      core.releaseLease(lease, options),
    isLeaseHeld: (table: string, key: string) =>
      core.isLeaseHeld(table, key, options),
  };
});
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (context: unknown, fn: () => unknown) => {
    mocks.contexts.push(context);
    return fn();
  },
}));
vi.mock("../routes/api/uploads/[recordingId]/tracks/finalize.post.js", () => ({
  finalizeRecordingTracks: (...args: unknown[]) => mocks.finalize(...args),
}));
vi.mock("./recording-tracks.js", () => ({
  readRichDraft: async (recordingId: string) =>
    mocks.drafts.get(recordingId) ?? null,
  deleteRichDraft: (...args: unknown[]) => mocks.deleteDraft(...args),
  discardTrackUploads: (...args: unknown[]) => mocks.discard(...args),
}));
vi.mock("./upload-lease.js", () => ({ UPLOAD_LEASE_MS: 60 * 60 * 1000 }));

const { recoverIdleTrackUploads } = await import("./rich-track-recovery.js");

const NOW = Date.parse("2026-11-26T20:00:00.000Z");
const IDLE = NOW - 2 * 60 * 60 * 1000;
const FRESH = NOW - 10 * 60 * 1000;

const draft = (uploadGenerationId: string | null) => ({
  uploadGenerationId,
  status: "recovered",
  tracks: [{ id: "page", startMs: 0, endMs: 9_000, complete: false }],
});

async function recording(row: {
  id: string;
  status?: string;
  mediaFormat?: string;
  owner?: string;
  generation?: string | null;
  trashed?: boolean;
  failureCode?: string | null;
  failureReason?: string | null;
}) {
  await client.query(
    `INSERT INTO recordings (id, owner_email, org_id, status, media_format,
       storage_mode, upload_generation_id, trashed_at, failure_code, failure_reason)
     VALUES ($1, $2, 'org-1', $3, $4, 'own', $5, $6, $7, $8)`,
    [
      row.id,
      row.owner ?? "Owner@example.com",
      row.status ?? "ready",
      row.mediaFormat ?? "flat",
      row.generation ?? null,
      row.trashed ? "2026-11-26T19:00:00.000Z" : null,
      row.failureCode ?? null,
      row.failureReason ?? null,
    ],
  );
}

async function state(
  key: string,
  updatedAt: number,
  sessionId = "owner@example.com",
) {
  await client.query(
    `INSERT INTO application_state (session_id, key, value, updated_at)
     VALUES ($1, $2, '{}', $3)`,
    [sessionId, key, updatedAt],
  );
}

const trackKey = (id: string, track = "page") =>
  `resumable-session-${id}-track-${track}`;
const draftKey = (id: string) => `recording-rich-draft-${id}`;

describe("recoverIdleTrackUploads", () => {
  beforeAll(async () => {
    client = await PGlite.create("memory://");
    await client.exec(`
      CREATE TABLE recordings (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        status TEXT NOT NULL,
        media_format TEXT NOT NULL,
        storage_mode TEXT,
        upload_generation_id TEXT,
        trashed_at TEXT,
        failure_code TEXT,
        failure_reason TEXT
      );
      CREATE TABLE application_state (
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (session_id, key)
      );
      CREATE TABLE clips_backfill_leases (
        lease_key TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        expires_at BIGINT NOT NULL
      );
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.contexts.length = 0;
    mocks.drafts.clear();
    await client.exec(
      "TRUNCATE recordings, application_state, clips_backfill_leases",
    );
    mocks.finalize.mockResolvedValue({ ok: true, mediaFormat: "rich" });
    mocks.discard.mockResolvedValue([]);
    mocks.deleteDraft.mockResolvedValue(undefined);
  });

  it("finalizes a finished recording's idle tracks from the recorder's draft, as its owner", async () => {
    await recording({ id: "rec-1", generation: "gen-1" });
    await state(trackKey("rec-1"), IDLE);
    await state(draftKey("rec-1"), IDLE);
    mocks.drafts.set("rec-1", draft("gen-1"));

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 1,
      discarded: 0,
      failed: 0,
    });
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "rec-1",
        input: draft("gen-1"),
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    );
    expect(mocks.contexts).toEqual([{ userEmail: "owner@example.com" }]);
    expect(mocks.deleteDraft).toHaveBeenCalledWith("rec-1");
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("waits while any of the recording's track uploads or its draft moved within the hour", async () => {
    await recording({ id: "rec-1" });
    await state(trackKey("rec-1", "screen"), IDLE);
    await state(trackKey("rec-1", "mic"), FRESH);
    await recording({ id: "rec-2" });
    await state(trackKey("rec-2"), IDLE);
    await state(draftKey("rec-2"), FRESH);

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 0,
    });
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("leaves recordings still uploading, trashed, taken down or waiting to resume", async () => {
    await recording({ id: "uploading", status: "uploading" });
    await recording({ id: "processing", status: "processing" });
    await recording({ id: "trashed", trashed: true });
    await recording({ id: "taken-down", failureCode: "taken_down" });
    await recording({
      id: "interrupted",
      status: "failed",
      failureReason: `${RETRYABLE_UPLOAD_INTERRUPTION_REASON} Last error: offline`,
    });
    for (const id of [
      "uploading",
      "processing",
      "trashed",
      "taken-down",
      "interrupted",
    ]) {
      await state(trackKey(id), IDLE);
    }

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 0,
    });
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("discards what failed recordings, rich ones and drafts of an older upload left behind", async () => {
    await recording({ id: "failed", status: "failed", failureReason: "Nope" });
    await recording({ id: "rich", mediaFormat: "rich" });
    await recording({ id: "no-draft" });
    await recording({ id: "old-draft", generation: "gen-2" });
    await recording({ id: "draft-only" });
    await state(trackKey("failed"), IDLE);
    await state(trackKey("rich"), IDLE);
    await state(trackKey("no-draft"), IDLE);
    await state(trackKey("old-draft"), IDLE);
    mocks.drafts.set("old-draft", draft("gen-1"));
    await state(draftKey("draft-only"), IDLE);
    mocks.finalize.mockResolvedValue({
      ok: true,
      mediaFormat: "flat",
      tracksStopped: true,
    });
    mocks.drafts.set("draft-only", draft(null));

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 5,
      failed: 0,
    });
    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: "draft-only" }),
    );
    expect(
      mocks.discard.mock.calls
        .map(([recording]) => String(recording.id))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["draft-only", "failed", "no-draft", "old-draft", "rich"]);
    expect(mocks.discard).toHaveBeenCalledWith(
      { id: "rich", ownerEmail: "owner@example.com", storageMode: "own" },
      { stillHeld: expect.any(Function) },
    );
    expect(mocks.deleteDraft).toHaveBeenCalledTimes(5);
    const { rows } = await client.query(
      "SELECT lease_key FROM clips_backfill_leases",
    );
    expect(rows).toEqual([]);
  });

  it("keeps what it couldn't settle, and tries it again only an hour later", async () => {
    await recording({ id: "rec-1" });
    await state(trackKey("rec-1"), IDLE);
    mocks.drafts.set("rec-1", draft(null));
    mocks.finalize.mockResolvedValueOnce({ ok: false, retryable: true });
    await recording({ id: "rec-2", status: "failed", failureReason: "Nope" });
    await state(trackKey("rec-2"), IDLE);
    mocks.discard.mockResolvedValueOnce(["unfinished page track upload"]);
    await recording({ id: "rec-3", status: "failed", failureReason: "Nope" });
    await state(trackKey("rec-3"), IDLE);
    mocks.discard.mockRejectedValueOnce(new Error("storage is down"));

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 3,
    });
    expect(mocks.deleteDraft).not.toHaveBeenCalled();

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 0,
    });
    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(mocks.discard).toHaveBeenCalledTimes(2);

    await client.query("UPDATE clips_backfill_leases SET expires_at = 0");
    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 1,
      discarded: 2,
      failed: 0,
    });
  });

  it("gives the next recording its turn while one it couldn't settle waits", async () => {
    await recording({ id: "rec-a" });
    await state(trackKey("rec-a"), IDLE);
    mocks.drafts.set("rec-a", draft(null));
    mocks.finalize.mockResolvedValue({
      ok: false,
      redactionPending: true,
      retryable: true,
    });
    await recording({ id: "rec-b", status: "failed", failureReason: "Nope" });
    await state(trackKey("rec-b"), IDLE);

    await expect(
      recoverIdleTrackUploads({ now: NOW, limit: 1 }),
    ).resolves.toEqual({ recovered: 0, discarded: 0, failed: 1 });
    await expect(
      recoverIdleTrackUploads({ now: NOW, limit: 1 }),
    ).resolves.toEqual({ recovered: 0, discarded: 1, failed: 0 });
    expect(mocks.discard).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rec-b" }),
      { stillHeld: expect.any(Function) },
    );
  });

  it("keeps finalize's lease while it discards, and stops once it loses it", async () => {
    await recording({ id: "rec-1", status: "failed", failureReason: "Nope" });
    await state(trackKey("rec-1"), IDLE);
    const lease = async () =>
      (
        await client.query(
          "SELECT holder, expires_at FROM clips_backfill_leases WHERE lease_key = 'rich-finalize:rec-1'",
        )
      ).rows[0] as { holder: string; expires_at: string } | undefined;
    const held: boolean[] = [];
    mocks.discard.mockImplementationOnce(
      async (
        _recording: unknown,
        options: { stillHeld: () => Promise<boolean> },
      ) => {
        const before = await lease();
        await client.query(
          "UPDATE clips_backfill_leases SET expires_at = $1 WHERE lease_key = 'rich-finalize:rec-1'",
          [Date.now() + 1_000],
        );
        held.push(await options.stillHeld());
        expect(Number((await lease())?.expires_at)).toBeGreaterThan(
          Date.now() + 60_000,
        );
        await client.query(
          "UPDATE clips_backfill_leases SET holder = 'route' WHERE lease_key = 'rich-finalize:rec-1'",
        );
        held.push(await options.stillHeld());
        expect(before).toBeDefined();
        return ["unfinished page track upload of rec-1"];
      },
    );

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 1,
    });
    expect(held).toEqual([true, false]);
    expect((await lease())?.holder).toBe("route");
  });

  it("leaves the tracks to a finalize already running for the recording", async () => {
    await recording({ id: "rec-1", status: "failed", failureReason: "Nope" });
    await state(trackKey("rec-1"), IDLE);
    await client.query(
      "INSERT INTO clips_backfill_leases (lease_key, holder, expires_at) VALUES ('rich-finalize:rec-1', 'route', $1)",
      [Date.now() + 60_000],
    );

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 1,
    });
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("checks each recording again before acting on it, and again before discarding", async () => {
    await recording({ id: "rec-1" });
    await state(trackKey("rec-1"), IDLE);
    mocks.drafts.set("rec-1", draft(null));
    await recording({ id: "rec-2" });
    await state(trackKey("rec-2"), IDLE);
    mocks.drafts.set("rec-2", draft(null));
    await recording({ id: "rec-3", status: "failed", failureReason: "Nope" });
    await state(trackKey("rec-3"), IDLE);
    const stopped = { ok: true, mediaFormat: "flat", tracksStopped: true };
    mocks.finalize
      .mockImplementationOnce(async () => {
        await state(trackKey("rec-1", "mic"), FRESH);
        await client.query(
          "UPDATE application_state SET updated_at = $1 WHERE key = $2",
          [FRESH, trackKey("rec-3")],
        );
        return stopped;
      })
      .mockImplementationOnce(async () => {
        await client.query(
          "UPDATE recordings SET upload_generation_id = 'gen-9' WHERE id = 'rec-2'",
        );
        return stopped;
      });

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 0,
    });
    expect(mocks.finalize).toHaveBeenCalledTimes(2);
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("never acts on a recording through keys in another account's state", async () => {
    await recording({ id: "rec-1", owner: "someone@example.com" });
    await state(trackKey("rec-1"), IDLE, "owner@example.com");
    await state(draftKey("rec-1"), IDLE, "owner@example.com");
    mocks.drafts.set("rec-1", draft(null));

    await expect(recoverIdleTrackUploads({ now: NOW })).resolves.toEqual({
      recovered: 0,
      discarded: 0,
      failed: 0,
    });
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});
