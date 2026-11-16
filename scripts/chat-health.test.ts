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
    if (query.includes("FROM a2a_tasks")) return [{ tasks: 0, failed: 0, unfinished: 0 }];
    if (query.includes("percentile_cont")) return [{ turns: 1, ok: 1, bad: 0, user_stopped: 0, stalled: 0, p50_wait_s: 0, p90_wait_s: 0, max_wait_s: 0 }];
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
