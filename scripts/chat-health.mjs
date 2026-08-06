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
const CONNECT_TIMEOUT_S = 20;

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
    return { name, ...totals, reasons };
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
  for (const u of unreachable) {
    console.log(`  ✗ ${u.name}: UNREACHABLE — ${u.error}`);
  }
}

// An app we could not reach is an unknown, not a pass. Report it as a failure
// in strict mode rather than quietly averaging it away.
if (unreachable.length > 0 && strict) process.exit(1);
if (strict && scored.some((r) => r.badRate > BAD_TURN_BUDGET)) process.exit(1);
