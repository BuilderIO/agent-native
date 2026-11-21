import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "chat-health.mjs");

// The fake driver advances a deterministic clock independently for the two
// queries, so the test distinguishes their timings without a wall-clock sleep.
const driver = `
const fs = require("node:fs");
let now = 100000;
Date.now = () => now;
module.exports = () => ({
  async unsafe(query) {
    fs.appendFileSync(process.env.QUERY_LOG, query + "\\n---\\n");
    if (query.trim() === "SELECT 1") {
      now += Number(process.env.SELECT_MS);
      if (process.env.FAIL_QUERY === "select") throw new Error("select failed");
      return [{ "?column?": 1 }];
    }
    if (query.includes("pg_stat_activity")) {
      now += Number(process.env.PRESSURE_MS);
      if (process.env.FAIL_QUERY === "pressure") throw new Error("pressure failed");
      return [{ connections: 8, idle_in_txn: 0, oldest_idle_txn_s: 0, max_same_query: 1 }];
    }
    if (query.includes("FROM a2a_tasks")) return [{ tasks: 0, failed: 0, unfinished: 0, input_required: 0 }];
    if (query.includes("percentile_cont")) return [{ turns: 1, ok: 1, bad: 0, user_stopped: 0, stalled: 0, stale_running: 0, p50_wait_s: 0, p90_wait_s: 0, max_wait_s: 0 }];
    return [];
  },
  async end() {},
});
`;

function runHealth(options: {
  selectMs: number;
  pressureMs: number;
  fail?: string;
  json?: boolean;
  strict?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), "chat-health-test-"));
  try {
    const scripts = join(root, "scripts");
    const app = join(root, "templates", "demo");
    const module = join(app, "node_modules", "postgres");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(module, { recursive: true });
    copyFileSync(script, join(scripts, "chat-health.mjs"));
    writeFileSync(join(app, "package.json"), "{}");
    writeFileSync(
      join(app, ".env"),
      "DATABASE_URL=postgres://example.invalid/test\n",
    );
    writeFileSync(join(module, "index.js"), driver);
    const queryLog = join(root, "queries.txt");
    const result = spawnSync(
      process.execPath,
      [
        join(scripts, "chat-health.mjs"),
        "--app",
        "demo",
        ...(options.strict === false ? [] : ["--strict"]),
        ...(options.json ? ["--json"] : []),
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          QUERY_LOG: queryLog,
          SELECT_MS: String(options.selectMs),
          PRESSURE_MS: String(options.pressureMs),
          FAIL_QUERY: options.fail ?? "",
        },
      },
    );
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      queries: readFileSync(queryLog, "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("chat health separates terminal turns from stale running turns", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-health-sql-test-"));
  try {
    const templates = join(dirname(script), "../templates");
    const app = join(templates, "chat-health-test-fixture");
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
  ["failed", "failed", "errored", "provider_error", null, 40, 0],
  ["truncated", "truncated", "truncated", null, "limit", 60, 0],
  ["user", "user", "aborted", null, "aborted:user", 20, 0],
  ["stalled", "stalled", "errored", "timeout", null, 700, 0],
  ["unknown", "unknown", "expired", null, "unknown_terminal", 30, 0],
  ["running", "running", "running", null, null, 4000, 0],
  ["old", "retried", "errored", "old_error", null, 50, 0],
  ["new", "retried", "running", "active_error", null, 7890, 100],
  ["leased", "leased", "running", null, null, 4000, 0],
  ["leased-generation", "leased-generation", "running", null, null, 4000, 0],
  ["generation", "generation", "running", null, null, 4000, 0],
  ["no-heartbeat", "no-heartbeat", "running", null, null, 4000, 0],
  ["thread", "thread", "running", null, null, 4000, 0],
  ["expired", "expired", "running", null, null, 4000, 0],
  ["owner", "owner", "running", null, null, 4000, 0],
  ["progress", "progress", "running", null, null, 4000, 0],
];
const ready = (async () => {
  await db.exec("CREATE TABLE agent_runs (id text, thread_id text, turn_id text, status text, error_code text, terminal_reason text, started_at bigint, completed_at bigint, heartbeat_at bigint, last_progress_at bigint, worker_generation bigint)");
  if (process.env.CASE !== "missing-lease-table") {
    await db.exec("CREATE TABLE agent_execution_leases (thread_id text NOT NULL, turn_id text NOT NULL, generation bigint NOT NULL, owner_run_id text NOT NULL, lease_expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (thread_id, turn_id))");
  }
  if (process.env.CASE.startsWith("a2a-")) {
    await db.exec("CREATE TABLE a2a_tasks (status_state text, status_message text, created_at bigint, updated_at bigint)");
    const scenario = process.env.CASE.slice(4);
    const states = scenario === "waiting-only" ? ["input-required"] : [
      ...Array(7).fill("completed"),
      ...(scenario === "waiting" ? ["input-required"] : []),
      ...(scenario === "mixed" ? [...Array(20).fill("input-required"), "failed"] : []),
      ...(scenario === "statuses" ? ["submitted", "working", "processing", "canceled", "future-state"] : []),
    ];
    for (const state of states) {
      await db.query("INSERT INTO a2a_tasks VALUES ($1, $2, $3, $4)", [state, state === "failed" ? "provider failed" : null, start, start + 1000]);
    }
  }
  for (const [id, turn, status, code, reason, duration, offset] of rows) {
    if (process.env.CASE.startsWith("a2a-")) continue;
    if (process.env.CASE === "stale-only" && id !== "running") continue;
    if (process.env.CASE === "fresh-only" && id !== "new") continue;
    if (process.env.CASE === "leased-only" && id !== "leased" && id !== "leased-generation") continue;
    const began = start + offset * 1000;
    const ended = began + duration * 1000;
    await db.query("INSERT INTO agent_runs VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [id, "thread", turn, status, code, reason, began, status === "running" ? null : ended, status === "running" && id !== "no-heartbeat" ? ended : null, id === "progress" ? Date.now() - 10000 : null, id === "generation" || id === "leased-generation" ? 1 : null]);
  }
  if (process.env.CASE !== "missing-lease-table") {
    for (const [turn, generation, owner, seconds] of [
      ["leased", 2, "leased", 60],
      ["leased-generation", 1, "leased-generation", 60],
      ["generation", 2, "generation", 60],
      ["expired", 1, "expired", -60],
      ["owner", 1, "another-run", 60],
    ]) {
      await db.query("INSERT INTO agent_execution_leases (thread_id, turn_id, generation, owner_run_id, lease_expires_at) VALUES ($1, $2, $3, $4, clock_timestamp() + $5 * interval '1 second')", ["thread", turn, generation, owner, seconds]);
    }
    await db.query("INSERT INTO agent_execution_leases (thread_id, turn_id, generation, owner_run_id, lease_expires_at) VALUES ('another-thread', 'thread', 1, 'thread', clock_timestamp() + interval '1 minute')");
  }
})();
const originalRequire = moduleApi.createRequire;
const originalReaddir = fs.readdirSync;
const originalExists = fs.existsSync;
const originalRead = fs.readFileSync;
fs.readdirSync = (path, ...args) => path === ${JSON.stringify(templates)} ? ["chat-health-test-fixture"] : originalReaddir(path, ...args);
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
    const run = (scenario = "", ...flags: string[]) => {
      const result = spawnSync(
        process.execPath,
        [
          "--require",
          preload,
          script,
          "--app",
          "chat-health-test-fixture",
          ...flags,
        ],
        { encoding: "utf8", env: { PATH: process.env.PATH, CASE: scenario } },
      );
      if (result.error) throw result.error;
      return result;
    };
    const waiting = run("a2a-waiting", "--json", "--strict");
    const waitingReport = JSON.parse(waiting.stdout);
    const waitingText = run("a2a-waiting", "--strict");
    assert.deepEqual(
      {
        tasks: waitingReport.apps[0].a2a.tasks,
        ok: waitingReport.apps[0].a2a.ok,
        failed: waitingReport.apps[0].a2a.failed,
        unfinished: waitingReport.apps[0].a2a.unfinished,
        input_required: waitingReport.apps[0].a2a.input_required,
        scored: waitingReport.apps[0].a2a.scored,
        failRate: waitingReport.apps[0].a2a.failRate,
      },
      {
        tasks: 8,
        ok: 7,
        failed: 0,
        unfinished: 0,
        input_required: 1,
        scored: 7,
        failRate: 0,
      },
      `JSON exit ${waiting.status}; text exit ${waitingText.status}\n${waitingText.stdout}`,
    );
    assert.equal(waiting.status, 0, waiting.stderr);
    assert.deepEqual(waitingReport.unreachable, []);
    assert.equal(waitingText.status, 0, waitingText.stderr);
    assert.match(waitingText.stdout, /waiting\s+other\s+fail%/);
    assert.match(
      waitingText.stdout,
      /chat-health-test-fixture\s+8\s+7\s+0\s+1\s+0\s+0%/,
    );
    assert.match(waitingText.stdout, /0\/7 A2A tasks/);
    assert.match(waitingText.stdout, /0\.0%/);

    const waitingOnly = run("a2a-waiting-only", "--json", "--strict");
    assert.equal(waitingOnly.status, 0, waitingOnly.stderr);
    const waitingOnlyA2a = JSON.parse(waitingOnly.stdout).apps[0].a2a;
    assert.equal(waitingOnlyA2a.input_required, 1);
    assert.equal(waitingOnlyA2a.scored, 0);
    assert.equal(waitingOnlyA2a.failRate, 0);
    const waitingOnlyText = run("a2a-waiting-only", "--strict");
    assert.equal(waitingOnlyText.status, 0, waitingOnlyText.stderr);
    assert.match(waitingOnlyText.stdout, /0\/0 A2A tasks/);

    const mixed = run("a2a-mixed", "--json", "--strict");
    assert.equal(mixed.status, 1, mixed.stderr);
    const mixedA2a = JSON.parse(mixed.stdout).apps[0].a2a;
    assert.equal(mixedA2a.input_required, 20);
    assert.equal(mixedA2a.failed, 1);
    assert.equal(mixedA2a.unfinished, 0);
    assert.equal(mixedA2a.scored, 8);
    assert.equal(mixedA2a.failRate, 1 / 8);
    assert.deepEqual(mixedA2a.reasons, [
      { reason: "provider failed", tasks: 1 },
    ]);
    const mixedText = run("a2a-mixed", "--strict");
    assert.equal(mixedText.status, 1, mixedText.stderr);
    assert.match(mixedText.stdout, /1\/8 A2A tasks/);
    assert.match(mixedText.stdout, /12\.5%/);

    const statuses = run("a2a-statuses", "--json", "--strict");
    assert.equal(statuses.status, 1, statuses.stderr);
    const statusesA2a = JSON.parse(statuses.stdout).apps[0].a2a;
    assert.equal(statusesA2a.tasks, 12);
    assert.equal(statusesA2a.unfinished, 5);
    assert.equal(statusesA2a.input_required, 0);
    assert.equal(statusesA2a.scored, 12);
    assert.equal(statusesA2a.failRate, 5 / 12);

    const result = run("", "--json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.unreachable.length, 0);
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
        stale_running: measured.stale_running,
        stallRate: measured.stallRate,
        badRate: measured.badRate,
      },
      {
        turns: 6,
        ok: 1,
        user_stopped: 1,
        bad: 4,
        scored: 5,
        p50_wait_s: 35,
        p90_wait_s: 380,
        max_wait_s: 700,
        stalled: 1,
        stale_running: 6,
        stallRate: 7 / 11,
        badRate: 0.8,
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
    assert.deepEqual(report.fleet, {
      turns: 6,
      bad: 4,
      stalled: 1,
      stale_running: 6,
      scored: 5,
      badRate: 0.8,
    });

    const staleOnly = run("stale-only", "--json", "--strict");
    assert.equal(staleOnly.status, 1, staleOnly.stderr);
    const staleReport = JSON.parse(staleOnly.stdout);
    assert.equal(staleReport.unreachable.length, 0);
    assert.equal(staleReport.apps[0].turns, 0);
    assert.equal(staleReport.apps[0].bad, 0);
    assert.equal(staleReport.apps[0].badRate, 0);
    assert.equal(staleReport.apps[0].stale_running, 1);
    assert.equal(staleReport.apps[0].stallRate, 1);
    assert.deepEqual(staleReport.apps[0].reasons, []);

    for (const scenario of ["fresh-only", "leased-only"]) {
      const healthy = run(scenario, "--json", "--strict");
      assert.equal(healthy.status, 0, healthy.stderr);
      const app = JSON.parse(healthy.stdout).apps[0];
      assert.equal(app.turns, 0);
      assert.equal(app.stale_running, 0);
      assert.equal(app.stallRate, 0);
      assert.equal(app.badRate, 0);
    }

    const text = run("stale-only");
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /stale.running/i);
    assert.match(text.stdout, /terminal/i);

    const missingLeaseTable = run("missing-lease-table", "--json", "--strict");
    assert.equal(missingLeaseTable.status, 1, missingLeaseTable.stderr);
    const missingReport = JSON.parse(missingLeaseTable.stdout);
    assert.equal(missingReport.apps.length, 0);
    assert.equal(missingReport.unreachable.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("chat health times SELECT 1 separately from the pressure query", () => {
  const slowPressure = runHealth({
    selectMs: 25,
    pressureMs: 6000,
    json: true,
  });
  assert.equal(
    JSON.parse(slowPressure.stdout).apps[0].dbPressure.trivial_query_ms,
    25,
  );
  assert.equal(JSON.parse(slowPressure.stdout).apps[0].dbPressureError, null);
  assert.equal(slowPressure.status, 0, slowPressure.stderr);
  assert.match(slowPressure.queries, /SELECT 1\n---/);
  assert.match(slowPressure.queries, /pg_stat_activity/);

  const atThreshold = runHealth({ selectMs: 1000, pressureMs: 20 });
  assert.equal(atThreshold.status, 0, atThreshold.stderr);
  assert.doesNotMatch(atThreshold.stdout, /SELECT 1 took/);

  const slowSelect = runHealth({ selectMs: 1001, pressureMs: 20 });
  assert.equal(slowSelect.status, 1, slowSelect.stderr);
  assert.deepEqual(
    slowSelect.stdout.split("\n").filter((line) => line.startsWith("! demo")),
    ["! demo        SELECT 1 took 1001ms"],
  );
});

test("chat health reports failed pressure probes and fails strict mode", () => {
  for (const fail of ["select", "pressure"]) {
    for (const strict of [true, false]) {
      const options = { selectMs: 25, pressureMs: 20, fail, strict };
      const text = runHealth(options);
      assert.equal(text.status, strict ? 1 : 0, text.stderr);
      assert.match(
        text.stdout,
        new RegExp(`! demo +database pressure unmeasured: ${fail} failed`),
      );

      const json = runHealth({ ...options, json: true });
      assert.equal(json.status, strict ? 1 : 0, json.stderr);
      const app = JSON.parse(json.stdout).apps[0];
      assert.equal(app.dbPressure, null);
      assert.equal(app.dbPressureError, `${fail} failed`);
    }
  }
});
