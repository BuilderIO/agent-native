import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "chat-health.mjs");

test("chat health scores terminal outcomes and excludes running continuations", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-health-terminal-test-"));
  try {
    const templates = join(dirname(script), "../templates");
    const app = join(templates, "chat-health-terminal-fixture");
    const pglite = createRequire(join(templates, "chat/package.json")).resolve(
      "@electric-sql/pglite",
    );
    const preload = join(root, "preload.cjs");
    writeFileSync(
      preload,
      `
const fs = require("node:fs");
const moduleApi = require("node:module");
const { PGlite } = require(${JSON.stringify(pglite)});
const db = new PGlite();
const start = Date.now() - 8_000_000;
const rows = [
  ["ok", "ok", "completed", null, null, 10, 0],
  ["failed", "failed", "errored", "provider_error", "fallback", 40, 0],
  ["truncated", "truncated", "truncated", null, "limit", 60, 0],
  ["user", "user", "aborted", null, "aborted:user", 800, 0],
  ["stalled", "stalled", "errored", "timeout", null, 700, 0],
  ["unknown", "unknown", "expired", null, "unknown_terminal", 30, 0],
  ["continued-old", "continued", "errored", "old_error", null, 50, 0],
  ["continued-new", "continued", "completed", null, null, 20, 100],
  ["running-old", "running", "errored", "old_error", null, 50, 0],
  ["running-new", "running", "running", "active_error", null, 0, 100],
  ["job-excluded", "job-turn", "errored", "job_error", null, 50, 0],
  ["no-turn", null, "errored", "no_turn_error", null, 50, 0],
];
const ready = (async () => {
  await db.exec("CREATE TABLE agent_runs (id text, thread_id text, turn_id text, status text, error_code text, terminal_reason text, started_at bigint, completed_at bigint, heartbeat_at bigint, last_progress_at bigint, worker_generation bigint)");
  await db.exec("CREATE TABLE agent_execution_leases (thread_id text, turn_id text, generation bigint, owner_run_id text, lease_expires_at timestamptz)");
  await db.exec("CREATE TABLE a2a_tasks (status_state text, status_message text, created_at bigint, updated_at bigint)");
  for (const [id, turn, status, code, reason, duration, offset] of rows) {
    const began = start + offset * 1000;
    await db.query("INSERT INTO agent_runs VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [id, "thread", turn, status, code, reason, began, status === "running" ? null : began + duration * 1000, status === "running" ? Date.now() : null, null, null]);
  }
})();
const originalRequire = moduleApi.createRequire;
const originalReaddir = fs.readdirSync;
const originalExists = fs.existsSync;
const originalRead = fs.readFileSync;
fs.readdirSync = (path, ...args) => path === ${JSON.stringify(templates)} ? ["chat-health-terminal-fixture"] : originalReaddir(path, ...args);
fs.existsSync = (path) => path === ${JSON.stringify(join(app, ".env"))} || path === ${JSON.stringify(join(app, "package.json"))} || originalExists(path);
fs.readFileSync = (path, ...args) => path === ${JSON.stringify(join(app, ".env"))} ? "DATABASE_URL=postgres://example.invalid/test\\n" : originalRead(path, ...args);
moduleApi.createRequire = (path) => path === ${JSON.stringify(join(app, "package.json"))} ? () => () => ({
  async unsafe(query, params = []) {
    await ready;
    if (query.includes("pg_stat_activity")) return [{ connections: 0, idle_in_txn: 0, oldest_idle_txn_s: 0, max_same_query: 0 }];
    return (await db.query(query, params)).rows;
  },
  async end() { await db.close(); },
}) : originalRequire(path);
moduleApi.syncBuiltinESMExports();
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        script,
        "--app",
        "chat-health-terminal-fixture",
        "--json",
        "--strict",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.unreachable, []);
    assert.equal(report.apps.length, 1);
    const measured = report.apps[0];
    assert.deepEqual(
      {
        turns: measured.turns,
        ok: measured.ok,
        user_stopped: measured.user_stopped,
        bad: measured.bad,
        scored: measured.scored,
        p50_wait_s: measured.p50_wait_s,
        p90_wait_s: measured.p90_wait_s,
        max_wait_s: measured.max_wait_s,
        stalled: measured.stalled,
        badRate: measured.badRate,
      },
      {
        turns: 7,
        ok: 2,
        user_stopped: 1,
        bad: 4,
        scored: 6,
        p50_wait_s: 60,
        p90_wait_s: 740,
        max_wait_s: 800,
        stalled: 1,
        badRate: 4 / 6,
      },
    );
    assert.deepEqual(
      measured.reasons.sort((a: { reason: string }, b: { reason: string }) =>
        a.reason.localeCompare(b.reason),
      ),
      ["limit", "provider_error", "timeout", "unknown_terminal"].map(
        (reason) => ({ reason, turns: 1 }),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
