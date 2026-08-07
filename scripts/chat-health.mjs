#!/usr/bin/env node
// Reports what fraction of real agent-chat turns ended without an answer, per
// hosted app, straight from each app's production database.
//
// This exists because nothing else answers the question. `agent_run_outcome_daily`
// is written by the pruner and read by nobody — `getRunOutcomeCounters()` has no
// production callers — so until now the only detector for "chat is broken again"
// was somebody typing it in Slack. That is how one defect got reported fifteen
// times by nine people across three months.
//
// Two measurement traps this deliberately avoids, both of which have produced
// confidently wrong headlines here before:
//
//   1. Per-RUN counts are not what a user feels. One turn can span several runs
//      as the agent hands off to background work; a turn that recovered on run
//      three was a success, not two failures. Everything below groups by
//      `turn_id` and scores only the FINAL run of each turn.
//   2. Do not read `agent_run_outcome_daily` for a recent window. Completed runs
//      fold into it after 24h but failures only after 7 days, so any window
//      inside the last week shows successes with almost no failures and looks
//      perfect. This reads live `agent_runs` rows instead.
//
// Also separates `aborted:user*` (someone pressed stop — working as intended)
// from everything else, so user-cancelled turns are not counted as breakage.
//
// Credentials come from each `templates/<app>/.env` DATABASE_URL, which is
// gitignored and local-only, so this runs on a workstation rather than in CI.
//
//   node scripts/chat-health.mjs                 # last 24h, every app
//   node scripts/chat-health.mjs --hours 48      # wider window
//   node scripts/chat-health.mjs --json          # machine readable
//   node scripts/chat-health.mjs --app analytics # one app
//   node scripts/chat-health.mjs --strict        # exit 1 if any app is over the bar
//
// --strict is the monitoring mode: a partial outage must not exit 0.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(HERE, "../templates");

// `postgres` is a template dependency, not a root one, so it does not resolve
// from scripts/. Resolve it through a template that depends on it rather than
// hardcoding a .pnpm path, which would break on the next version bump.
function loadPostgres() {
  for (const app of readdirSync(TEMPLATES).sort()) {
    const pkg = `${TEMPLATES}/${app}/package.json`;
    if (!existsSync(pkg)) continue;
    try {
      return createRequire(pkg)("postgres");
    } catch {
      continue;
    }
  }
  throw new Error(
    "Could not resolve the `postgres` driver from any template. Run `pnpm install` first.",
  );
}

const postgres = loadPostgres();

/** Share of non-user-aborted turns that may end badly before --strict fails. */
const BAD_TURN_BUDGET = 0.1;
/** Share of received A2A tasks that may fail or hang before --strict fails. */
const A2A_FAIL_BUDGET = 0.1;
const CONNECT_TIMEOUT_S = 20;
// Thresholds set from a real outage, not intuition. Healthy analytics right now
// reads 0 / 128ms / 1; at the point it went down it read 20 / 6000ms / 56.
const MAX_IDLE_TXN_AGE_S = 60;
const MAX_TRIVIAL_QUERY_MS = 1_000;
const MAX_SAME_QUERY_CONCURRENCY = 10;

/** Reasons this app's database looks pressured, or [] when it looks fine. */
function dbPressureWarnings(p) {
  if (!p) return [];
  const out = [];
  if (p.idle_in_txn > 0 && p.oldest_idle_txn_s > MAX_IDLE_TXN_AGE_S) {
    out.push(
      `${p.idle_in_txn} idle-in-transaction (oldest ${p.oldest_idle_txn_s}s) — workers killed mid-transaction still holding locks`,
    );
  }
  if (p.trivial_query_ms > MAX_TRIVIAL_QUERY_MS) {
    out.push(
      `SELECT 1 took ${p.trivial_query_ms}ms — the database itself is slow, not the app`,
    );
  }
  if (p.max_same_query >= MAX_SAME_QUERY_CONCURRENCY) {
    out.push(
      `${p.max_same_query} concurrent copies of one query — a hot path is stampeding`,
    );
  }
  return out;
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const strict = args.includes("--strict");
const asJson = args.includes("--json");
const hours = Number(flag("hours", "24"));
const onlyApp = flag("app", null);

if (!Number.isFinite(hours) || hours <= 0) {
  console.error(`--hours must be a positive number, got ${flag("hours", "")}`);
  process.exit(1);
}

/** Apps are discovered from disk so a new template is covered automatically. */
function discoverApps() {
  const apps = [];
  for (const name of readdirSync(TEMPLATES).sort()) {
    if (onlyApp && name !== onlyApp) continue;
    const envPath = `${TEMPLATES}/${name}/.env`;
    if (!existsSync(envPath)) continue;
    const url = /^DATABASE_URL=(.*)$/m
      .exec(readFileSync(envPath, "utf8"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (url) apps.push({ name, url });
  }
  return apps;
}

// Scores the LAST run of every interactive turn in the window. `job-%` ids are
// scheduled automations, which fail in completely different ways and would
// swamp the number people actually experience.
const TURN_OUTCOME_SQL = `
WITH final_run AS (
  SELECT DISTINCT ON (turn_id)
    turn_id, status, error_code, terminal_reason
  FROM agent_runs
  WHERE id NOT LIKE 'job-%'
    AND turn_id IS NOT NULL
    AND started_at > $1
  ORDER BY turn_id, started_at DESC
)
SELECT
  count(*)::int AS turns,
  count(*) FILTER (WHERE status = 'completed')::int AS ok,
  count(*) FILTER (WHERE terminal_reason LIKE 'aborted:user%')::int AS user_stopped,
  count(*) FILTER (
    WHERE status <> 'completed'
      AND coalesce(terminal_reason, '') NOT LIKE 'aborted:user%'
  )::int AS bad
FROM final_run`;

const TURN_REASONS_SQL = `
WITH final_run AS (
  SELECT DISTINCT ON (turn_id)
    turn_id, status, error_code, terminal_reason
  FROM agent_runs
  WHERE id NOT LIKE 'job-%'
    AND turn_id IS NOT NULL
    AND started_at > $1
  ORDER BY turn_id, started_at DESC
)
SELECT coalesce(error_code, terminal_reason, '(none)') AS reason, count(*)::int AS turns
FROM final_run
WHERE status <> 'completed'
  AND coalesce(terminal_reason, '') NOT LIKE 'aborted:user%'
GROUP BY 1
ORDER BY turns DESC
LIMIT 5`;

// Inbound app-to-app work, from the receiving app's own task table — the
// authoritative record. The CALLER's `agent_call` events carry no failure
// reason at all, so a caller-side view can only say "it failed", never why.
//
// Latency is reported alongside the failure rate because for A2A they are the
// same complaint: a failed task usually takes LONGER than a successful one
// (the remote agent runs until it runs out of time), so callers wait minutes
// to be told it did not work.
const A2A_SQL = `
SELECT
  count(*)::int AS tasks,
  count(*) FILTER (WHERE status_state = 'completed')::int AS ok,
  count(*) FILTER (WHERE status_state = 'failed')::int AS failed,
  count(*) FILTER (WHERE status_state NOT IN ('completed','failed'))::int AS unfinished,
  coalesce(round(percentile_cont(0.5) WITHIN GROUP (
    ORDER BY (updated_at - created_at) / 1000.0
  ) FILTER (WHERE status_state = 'completed'))::int, 0) AS p50_ok_s,
  coalesce(round(percentile_cont(0.9) WITHIN GROUP (
    ORDER BY (updated_at - created_at) / 1000.0
  ) FILTER (WHERE status_state = 'completed'))::int, 0) AS p90_ok_s,
  coalesce(round(avg((updated_at - created_at) / 1000.0)
    FILTER (WHERE status_state = 'failed'))::int, 0) AS avg_fail_s
FROM a2a_tasks
WHERE created_at > $1`;

// `status_message` is an A2A message envelope; the human sentence is the first
// `text` part. Trimmed to a prefix so distinct causes group together instead of
// splintering on ids and token counts embedded later in the sentence.
const A2A_REASONS_SQL = `
SELECT
  left(regexp_replace(coalesce(status_message, '(none)'),
       '.*"text":"([^"]{0,60}).*', '\\1'), 60) AS reason,
  count(*)::int AS tasks
FROM a2a_tasks
WHERE status_state = 'failed' AND created_at > $1
GROUP BY 1 ORDER BY tasks DESC LIMIT 4`;

// Database pressure — the three signals that preceded a real outage and that
// nothing here was watching.
//
// Analytics degraded for hours before it fell over, and every check we had said
// UP until the moment it said DOWN. What was actually true, and visible the
// whole time in pg_stat_activity:
//
//   - 11-20 connections stuck `idle in transaction` up to 283s, left behind by
//     serverless workers killed mid-transaction. They hold locks; nothing
//     reaped them.
//   - `SELECT 1` drifting from ~0.2s to 6s as those locks accumulated.
//   - 47-56 concurrent copies of one unprojected query, each dragging a JSON
//     blob per row.
//
// None of that is "down". All of it is the hour before down. A monitor that
// only distinguishes 200 from 500 cannot see any of it.
const DB_PRESSURE_SQL = `
SELECT
  count(*)::int AS connections,
  count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_txn,
  coalesce(round(max(extract(epoch from (now() - state_change)))
    FILTER (WHERE state = 'idle in transaction'))::int, 0) AS oldest_idle_txn_s,
  coalesce((
    SELECT max(c) FROM (
      SELECT count(*)::int AS c FROM pg_stat_activity
      WHERE state = 'active' AND query <> '' GROUP BY left(query, 60)
    ) q
  ), 0)::int AS max_same_query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()`;

async function measure({ name, url }, since) {
  const sql = postgres(url, {
    ssl: "require",
    max: 1,
    idle_timeout: 5,
    connect_timeout: CONNECT_TIMEOUT_S,
    onnotice: () => {},
  });
  try {
    const [totals] = await sql.unsafe(TURN_OUTCOME_SQL, [since]);
    const reasons = await sql.unsafe(TURN_REASONS_SQL, [since]);
    // Not every app receives A2A work, and an older one may predate the table.
    // "No a2a_tasks table" is a real, different answer from "zero tasks", so it
    // is carried as null rather than folded into a zero.
    let a2a = null;
    try {
      const [t] = await sql.unsafe(A2A_SQL, [since]);
      const r = await sql.unsafe(A2A_REASONS_SQL, [since]);
      a2a = { ...t, reasons: r };
    } catch {
      a2a = null;
    }
    // Timed, because latency on a trivial query IS the signal: it drifted from
    // ~0.2s to 6s during the incident while every other check still said UP.
    let dbPressure = null;
    try {
      const t0 = Date.now();
      const [p] = await sql.unsafe(DB_PRESSURE_SQL);
      dbPressure = { ...p, trivial_query_ms: Date.now() - t0 };
    } catch {
      dbPressure = null;
    }
    return { name, ...totals, reasons, a2a, dbPressure };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const apps = discoverApps();
if (apps.length === 0) {
  // Never exit 0 having measured nothing — a silent empty run is
  // indistinguishable from a clean one, which is the failure this file exists
  // to stop repeating.
  console.error(
    onlyApp
      ? `No templates/${onlyApp}/.env with a DATABASE_URL. Nothing was measured.`
      : "No templates/*/.env contained a DATABASE_URL. Nothing was measured.",
  );
  process.exit(1);
}

const since = Date.now() - hours * 3_600_000;
const settled = await Promise.allSettled(
  apps.map((app) => measure(app, since)),
);

const results = [];
const unreachable = [];
settled.forEach((outcome, i) => {
  if (outcome.status === "fulfilled") results.push(outcome.value);
  else
    unreachable.push({
      name: apps[i].name,
      error: String(outcome.reason?.message ?? outcome.reason),
    });
});

const scored = results
  .map((r) => {
    const scored = r.turns - r.user_stopped;
    return { ...r, badRate: scored > 0 ? r.bad / scored : 0, scored };
  })
  .sort((a, b) => b.badRate - a.badRate);

const fleet = scored.reduce(
  (acc, r) => ({
    turns: acc.turns + r.turns,
    bad: acc.bad + r.bad,
    scored: acc.scored + r.scored,
  }),
  { turns: 0, bad: 0, scored: 0 },
);
const fleetRate = fleet.scored > 0 ? fleet.bad / fleet.scored : 0;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        hours,
        since,
        fleet: { ...fleet, badRate: fleetRate },
        apps: scored,
        unreachable,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `Agent chat turns, last ${hours}h (excludes user-stopped turns)\n`,
  );
  console.log(
    `  ${"app".padEnd(11)}${"turns".padStart(6)}${"ok".padStart(6)}${"bad".padStart(6)}${"bad%".padStart(7)}  top reasons`,
  );
  for (const r of scored) {
    const pct = `${(r.badRate * 100).toFixed(0)}%`;
    const top = r.reasons
      .slice(0, 3)
      .map((x) => `${x.reason}(${x.turns})`)
      .join(" ");
    const mark = r.badRate > BAD_TURN_BUDGET ? "!" : " ";
    console.log(
      `${mark} ${r.name.padEnd(11)}${String(r.turns).padStart(6)}${String(r.ok).padStart(6)}${String(r.bad).padStart(6)}${pct.padStart(7)}  ${top}`,
    );
  }
  console.log(
    `\n  fleet: ${fleet.bad}/${fleet.scored} turns ended without an answer (${(fleetRate * 100).toFixed(1)}%)`,
  );

  const withA2a = scored.filter((r) => r.a2a && r.a2a.tasks > 0);
  if (withA2a.length > 0) {
    console.log(`\nApp-to-app (A2A) tasks received, last ${hours}h\n`);
    console.log(
      `  ${"app".padEnd(11)}${"tasks".padStart(6)}${"ok".padStart(5)}${"fail".padStart(6)}${"stuck".padStart(6)}${"fail%".padStart(7)}${"p50s".padStart(6)}${"p90s".padStart(6)}${"failAvgs".padStart(9)}  top reasons`,
    );
    for (const r of withA2a.sort(
      (a, b) => b.a2a.failed / b.a2a.tasks - a.a2a.failed / a.a2a.tasks,
    )) {
      const a = r.a2a;
      const rate = a.tasks > 0 ? (a.failed + a.unfinished) / a.tasks : 0;
      const top = a.reasons
        .slice(0, 2)
        .map((x) => `${x.reason.trim()}(${x.tasks})`)
        .join(" | ");
      const mark = rate > A2A_FAIL_BUDGET ? "!" : " ";
      console.log(
        `${mark} ${r.name.padEnd(11)}${String(a.tasks).padStart(6)}${String(a.ok).padStart(5)}${String(a.failed).padStart(6)}${String(a.unfinished).padStart(6)}${`${(rate * 100).toFixed(0)}%`.padStart(7)}${String(a.p50_ok_s).padStart(6)}${String(a.p90_ok_s).padStart(6)}${String(a.avg_fail_s).padStart(9)}  ${top}`,
      );
    }
    const at = withA2a.reduce(
      (acc, r) => ({
        tasks: acc.tasks + r.a2a.tasks,
        failed: acc.failed + r.a2a.failed + r.a2a.unfinished,
      }),
      { tasks: 0, failed: 0 },
    );
    console.log(
      `\n  fleet: ${at.failed}/${at.tasks} A2A tasks did not complete (${((at.failed / Math.max(at.tasks, 1)) * 100).toFixed(1)}%)`,
    );
    console.log(
      "  failAvgs is how long a caller waits before being told it failed.",
    );
  }

  const pressured = scored
    .map((r) => ({ name: r.name, warns: dbPressureWarnings(r.dbPressure) }))
    .filter((x) => x.warns.length > 0);
  if (pressured.length > 0) {
    console.log(
      `\nDatabase pressure — the hour before an outage looks like this\n`,
    );
    for (const { name, warns } of pressured) {
      for (const w of warns) console.log(`! ${name.padEnd(11)} ${w}`);
    }
  }

  for (const u of unreachable) {
    console.log(`  ✗ ${u.name}: UNREACHABLE — ${u.error}`);
  }
}

// An app we could not reach is an unknown, not a pass. Report it as a failure
// in strict mode rather than quietly averaging it away.
if (strict && scored.some((r) => dbPressureWarnings(r.dbPressure).length > 0)) {
  process.exit(1);
}
if (unreachable.length > 0 && strict) process.exit(1);
if (strict && scored.some((r) => r.badRate > BAD_TURN_BUDGET)) process.exit(1);
if (
  strict &&
  scored.some(
    (r) =>
      r.a2a &&
      r.a2a.tasks > 0 &&
      (r.a2a.failed + r.a2a.unfinished) / r.a2a.tasks > A2A_FAIL_BUDGET,
  )
) {
  process.exit(1);
}
