import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  bqRequest,
  appendBigQueryRows,
  bindRadarPostgresParams,
  collectPostgresRows,
  ensurePrivateRadarCacheDirectory,
  getRadarBigQueryScanBudget,
  isReadOnlySql,
  parseBigQueryTimestamp,
  parseRadarBigQueryTableParts,
  radarCliExitCode,
  radarRunCliExitCode,
  radarJsonbParam,
  recordRadarBigQueryDryRunBytes,
  RadarQueryError,
  setRadarBigQueryScanBudget,
} from "./query.ts";

describe("radar query safety", () => {
  it("enforces the weekly cumulative BigQuery scan budget", () => {
    setRadarBigQueryScanBudget(0.00000001);
    try {
      recordRadarBigQueryDryRunBytes(8);
      expect(getRadarBigQueryScanBudget()).toMatchObject({
        maxBytes: 10,
        reservedBytes: 8,
        exceeded: false,
      });
      expect(() => recordRadarBigQueryDryRunBytes(3)).toThrow(
        /report-wide --max-total-gb/,
      );
      expect(getRadarBigQueryScanBudget()).toMatchObject({
        reservedBytes: 8,
        exceeded: true,
      });
    } finally {
      setRadarBigQueryScanBudget(undefined);
    }
  });

  it("binds explicit JSONB parameters through postgres.js JSON serialization", () => {
    const roster = [{ email: "recipient@example.test", app: "clips" }];
    const json = vi.fn((value: unknown) => ({ type: 3802, value }));
    const params = bindRadarPostgresParams(
      [radarJsonbParam(roster), "org-1"],
      json,
    );

    expect(params).toEqual([{ type: 3802, value: roster }, "org-1"]);
    expect(json).toHaveBeenCalledExactlyOnceWith(roster);
  });

  it("rejects malformed configured BigQuery table references instead of defaulting", () => {
    expect(parseRadarBigQueryTableParts(undefined)).toEqual([]);
    expect(parseRadarBigQueryTableParts("analytics.events")).toEqual([
      "analytics",
      "events",
    ]);
    expect(parseRadarBigQueryTableParts("project.analytics.events")).toEqual([
      "project",
      "analytics",
      "events",
    ]);
    expect(() => parseRadarBigQueryTableParts("events")).toThrow(
      RadarQueryError,
    );
    expect(() =>
      parseRadarBigQueryTableParts("project.analytics.events.extra"),
    ).toThrow(RadarQueryError);
    expect(() => parseRadarBigQueryTableParts("project..events")).toThrow(
      RadarQueryError,
    );
  });

  it("caps BigQuery results by serialized bytes before accumulating pages", () => {
    const accumulator = { rows: [] as Record<string, unknown>[], bytes: 0 };
    appendBigQueryRows(accumulator, [{ value: "a" }], { maxBytes: 20 });
    expect(accumulator.rows).toEqual([{ value: "a" }]);
    expect(accumulator.bytes).toBeGreaterThan(0);
    expect(() =>
      appendBigQueryRows(accumulator, [{ value: "a long value" }], {
        maxBytes: accumulator.bytes + 1,
      }),
    ).toThrow(/BigQuery result exceeded/);
    expect(accumulator.rows).toHaveLength(1);
  });

  it("accepts one select or CTE and ignores keywords inside quoted literals", () => {
    expect(
      isReadOnlySql(
        "SELECT 'delete -- this word is data' AS note; -- trailing comment",
      ),
    ).toBe(true);
    expect(isReadOnlySql("WITH rows AS (SELECT 1) SELECT * FROM rows")).toBe(
      true,
    );
    expect(isReadOnlySql("SELECT CASE WHEN true THEN 1 ELSE 0 END AS ok")).toBe(
      true,
    );
    expect(
      isReadOnlySql("SELECT $$; UPDATE app_secrets SET x=1$$ AS note"),
    ).toBe(true);
    expect(isReadOnlySql("SELECT $é$literal$é$ AS note")).toBe(false);
    expect(isReadOnlySql("SELECT $tagé$literal$tagé$ AS note")).toBe(false);
  });

  it("rejects mutating tokens and transaction control hidden after a literal comment marker", () => {
    expect(
      isReadOnlySql("SELECT 1; UPDATE app_secrets SET encrypted_value='x'"),
    ).toBe(false);
    expect(
      isReadOnlySql("SELECT 'x--'; COMMIT; UPDATE app_secrets SET x=1"),
    ).toBe(false);
    expect(
      isReadOnlySql(
        "WITH changed AS (DELETE FROM t RETURNING *) SELECT * FROM changed",
      ),
    ).toBe(false);
    expect(isReadOnlySql("SELECT pg_read_file('/etc/passwd')")).toBe(false);
    expect(isReadOnlySql("SELECT set_config('x', 'y', true)")).toBe(false);
    expect(isReadOnlySql("SELECT nextval('sequence')")).toBe(false);
    expect(isReadOnlySql("SELECT pg_stat_reset()")).toBe(false);
    expect(
      isReadOnlySql("SELECT pg_logical_slot_get_changes('slot', NULL, NULL)"),
    ).toBe(false);
    expect(
      isReadOnlySql(
        "SELECT pg_logical_slot_get_binary_changes('slot', NULL, NULL)",
      ),
    ).toBe(false);
    expect(
      isReadOnlySql("SELECT pg_replication_slot_advance('slot', NULL)"),
    ).toBe(false);
    for (const sql of [
      "SELECT pg_logical_slot_peek_changes('slot', NULL, NULL)",
      "SELECT pg_logical_slot_peek_binary_changes('slot', NULL, NULL)",
      "SELECT pg_create_physical_replication_slot('slot')",
      "SELECT pg_create_logical_replication_slot('slot', 'pgoutput')",
      "SELECT pg_drop_replication_slot('slot')",
      "SELECT pg_copy_physical_replication_slot('source', 'target')",
      "SELECT pg_copy_logical_replication_slot('source', 'target')",
      "SELECT pg_sync_replication_slots()",
      "SELECT pg_replication_origin_create('origin')",
      "SELECT pg_replication_origin_drop('origin')",
      "SELECT pg_replication_origin_session_setup('origin')",
      "SELECT pg_replication_origin_session_reset()",
      "SELECT pg_replication_origin_xact_setup('0/0', now())",
      "SELECT pg_replication_origin_xact_reset()",
    ]) {
      expect(isReadOnlySql(sql), sql).toBe(false);
    }
    expect(isReadOnlySql("SELECT pg_advisory_unlock_shared(1, 2)")).toBe(false);
    expect(isReadOnlySql("SELECT pg_advisory_xact_lock_shared(1, 2)")).toBe(
      false,
    );
    expect(isReadOnlySql("SELECT pg_try_advisory_xact_lock(1, 2)")).toBe(false);
    expect(isReadOnlySql("SELECT pg_try_advisory_xact_lock_shared(1, 2)")).toBe(
      false,
    );
    expect(isReadOnlySql("SELECT pg_advisory_unlock_all()")).toBe(false);
    expect(isReadOnlySql("SELECT \"pg_read_file\"('/etc/passwd')")).toBe(false);
    expect(
      isReadOnlySql(String.raw`SELECT U&"pg\005fread_file"('/etc/passwd')`),
    ).toBe(false);
    expect(isReadOnlySql('SELECT "pg_advisory_unlock_shared"(1, 2)')).toBe(
      false,
    );
    expect(isReadOnlySql('SELECT "delete" FROM records')).toBe(true);
    expect(isReadOnlySql('"select" SELECT 1')).toBe(false);
    expect(
      isReadOnlySql("SELECT * FROM dblink('remote', 'UPDATE t SET x=1')"),
    ).toBe(false);
    expect(isReadOnlySql("SELECT dblink_connect('remote', 'dbname=x')")).toBe(
      false,
    );
    expect(isReadOnlySql("SELECT 1; SELECT 2")).toBe(false);
  });

  it("rejects large-object, remote-query, and server-admin side effects", () => {
    for (const sql of [
      "SELECT lo_import('/etc/passwd')",
      "SELECT lo_export(42, '/tmp/radar-output')",
      "SELECT \"lo_export\"(42, '/tmp/radar-output')",
      "SELECT lo_creat(-1)",
      "SELECT lo_create(42)",
      "SELECT lo_unlink(42)",
      "SELECT lo_from_bytea(0, decode('00', 'hex'))",
      "SELECT lo_put(42, 0, decode('00', 'hex'))",
      "SELECT lowrite(1, decode('00', 'hex'))",
      "SELECT dblink_disconnect('remote')",
      "SELECT dblink_send_query('remote', 'UPDATE records SET value = 1')",
      "SELECT dblink_cancel_query('remote')",
      "SELECT pg_backup_start('radar')",
      "SELECT pg_backup_stop()",
      "SELECT pg_promote()",
      "SELECT pg_wal_replay_pause()",
      "SELECT pg_wal_replay_resume()",
      "SELECT pg_log_standby_snapshot()",
      "SELECT pg_log_backend_memory_contexts(pg_backend_pid())",
    ]) {
      expect(isReadOnlySql(sql), sql).toBe(false);
    }
  });

  it("rejects any executable token after the trailing statement terminator", () => {
    expect(isReadOnlySql("SELECT 1; -- trailing comment")).toBe(true);
    expect(isReadOnlySql("SELECT 1; 'second statement'")).toBe(false);
    expect(isReadOnlySql("SELECT 1; $$second statement$$")).toBe(false);
    expect(isReadOnlySql('SELECT 1; "second statement"')).toBe(false);
    expect(isReadOnlySql('"select" SELECT 1')).toBe(false);
    expect(isReadOnlySql("SELECT * FROM `project.dataset.update`")).toBe(true);
  });

  it("makes the task cache private and rejects symlinked cache parents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "radar-cache-test-"));
    try {
      const repoTmp = path.join(root, ".tmp");
      const radarTmp = path.join(repoTmp, "first-touch-radar");
      const cache = path.join(radarTmp, "cache");
      fs.mkdirSync(cache, { recursive: true, mode: 0o755 });
      fs.chmodSync(repoTmp, 0o700);
      fs.chmodSync(radarTmp, 0o755);
      fs.chmodSync(cache, 0o755);

      expect(ensurePrivateRadarCacheDirectory(root)).toBe(cache);
      expect(fs.statSync(radarTmp).mode & 0o777).toBe(0o700);
      expect(fs.statSync(cache).mode & 0o777).toBe(0o700);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    const symlinkRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "radar-cache-symlink-test-"),
    );
    const danglingRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "radar-cache-dangling-test-"),
    );
    const target = fs.mkdtempSync(
      path.join(os.tmpdir(), "radar-cache-target-test-"),
    );
    try {
      fs.symlinkSync(target, path.join(symlinkRoot, ".tmp"), "dir");
      expect(() => ensurePrivateRadarCacheDirectory(symlinkRoot)).toThrow(
        RadarQueryError,
      );
      const danglingTarget = path.join(danglingRoot, "outside");
      fs.symlinkSync(danglingTarget, path.join(danglingRoot, ".tmp"), "dir");
      expect(() => ensurePrivateRadarCacheDirectory(danglingRoot)).toThrow(
        RadarQueryError,
      );
      expect(fs.existsSync(danglingTarget)).toBe(false);
    } finally {
      fs.rmSync(symlinkRoot, { recursive: true, force: true });
      fs.rmSync(danglingRoot, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("applies a finite abort signal to each BigQuery request", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({}),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await bqRequest("https://example.test", "test-token");
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(request?.signal).toBeInstanceOf(AbortSignal);
      expect(request?.signal?.aborted).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops reading a BigQuery response before parsing an oversized page", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("123456789"),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        bqRequest("https://example.test", "test-token", undefined, 8),
      ).rejects.toThrow("BigQuery response exceeded the 8-byte safety cap");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails a completed BigQuery job that reports an error result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ status: { errorResult: { reason: "badQuery" } } }),
      ),
    );
    try {
      await expect(
        bqRequest("https://example.test", "test-token"),
      ).rejects.toThrow("BigQuery query job completed with an error.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("streams PostgreSQL rows and fails explicitly at row and byte caps", async () => {
    async function* batches() {
      yield [{ value: "a" }];
      yield [{ value: "b" }];
    }

    await expect(
      collectPostgresRows(batches(), { maxRows: 1, maxBytes: 100 }),
    ).rejects.toThrow(RadarQueryError);
    await expect(
      collectPostgresRows(batches(), { maxRows: 10, maxBytes: 2 }),
    ).rejects.toThrow(RadarQueryError);
    await expect(
      collectPostgresRows(batches(), { maxRows: 2, maxBytes: 100 }),
    ).resolves.toHaveLength(2);
  });

  it("normalizes BigQuery REST timestamp seconds to ISO timestamps", () => {
    expect(parseBigQueryTimestamp("1792972800.25")).toBe(
      "2026-10-26T00:00:00.250Z",
    );
    expect(parseBigQueryTimestamp("2026-10-26T00:00:00Z")).toBe(
      "2026-10-26T00:00:00.000Z",
    );
    expect(() => parseBigQueryTimestamp("not-a-timestamp")).toThrow(
      RadarQueryError,
    );
  });

  it("preserves the query helper exit contract", () => {
    expect(radarCliExitCode(new RadarQueryError("missing", 2))).toBe(2);
    expect(radarCliExitCode(new RadarQueryError("query failed", 1))).toBe(1);
    expect(radarCliExitCode(new Error("unknown"))).toBe(1);
    expect(radarRunCliExitCode(new RadarQueryError("query failed", 1))).toBe(2);
    expect(radarRunCliExitCode(new Error("unknown"))).toBe(2);
  });
});
