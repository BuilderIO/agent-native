#!/usr/bin/env node
// Blocks until every check on a PR's current head has finished, printing
// nothing while it waits, then prints one summary.
//
//   pnpm ci:wait <pr> [--interval <seconds>] [--max-minutes <minutes>]
//
// Exit 0: every check passed or was skipped. Exit 1: a check failed. Exit 2:
// couldn't tell (a check was cancelled, gh unreadable, PR not open, no checks
// reported, or out of time). The default limit is 9 minutes so one call fits a
// 10-minute shell cap; if it runs out with checks still going, run it again.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type Check = { name: string; bucket: string; link: string };

export type Verdict =
  | { done: false }
  | { done: true; exit: 0 | 1 | 2; summary: string };

export function judge(checks: Check[], head: string): Verdict {
  if (checks.length === 0 || checks.some((c) => c.bucket === "pending"))
    return { done: false };
  const count = (bucket: string) =>
    checks.filter((c) => c.bucket === bucket).length;
  const failed = checks.filter((c) => c.bucket === "fail");
  const cancelled = checks.filter((c) => c.bucket === "cancel");
  const lines = [
    `head ${head.slice(0, 12)}: ${count("pass")} passed, ${failed.length} failed, ${cancelled.length} cancelled, ${count("skipping")} skipped`,
    ...failed.map((c) => `FAILED ${c.name} ${c.link}`),
    ...cancelled.map((c) => `CANCELLED ${c.name} ${c.link}`),
  ];
  return {
    done: true,
    exit: failed.length ? 1 : cancelled.length ? 2 : 0,
    summary: lines.join("\n"),
  };
}

const NO_CHECKS_GRACE_MS = 5 * 60_000;

export type Options = { pr: string; intervalMs: number; maxMs: number };

export function parseArgs(argv: string[]): Options | null {
  const values: Record<string, number> = {
    "--interval": 60,
    "--max-minutes": 9,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg in values) {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) return null;
      values[arg] = value;
    } else positional.push(arg);
  }
  const [pr] = positional;
  if (positional.length !== 1 || !pr || !/^\d+$/.test(pr)) return null;
  return {
    pr,
    intervalMs: (values["--interval"] ?? 60) * 1000,
    maxMs: (values["--max-minutes"] ?? 9) * 60_000,
  };
}

function gh(args: string[], deadline: number): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: Math.max(1000, deadline - Date.now()),
  });
}

function readPr(
  pr: string,
  deadline: number,
): { state: string; head: string; checks: Check[] } {
  const view = () =>
    JSON.parse(
      gh(["pr", "view", pr, "--json", "state,headRefOid"], deadline),
    ) as {
      state: string;
      headRefOid: string;
    };
  const before = view();
  let checks: Check[] = [];
  try {
    checks = JSON.parse(
      gh(["pr", "checks", pr, "--json", "name,bucket,link"], deadline),
    ) as Check[];
  } catch (error) {
    // gh exits non-zero while checks are pending or failing, but still prints
    // the JSON; "no checks reported" means CI hasn't registered them yet.
    const out = String((error as { stdout?: string }).stdout ?? "").trim();
    if (out.startsWith("[")) checks = JSON.parse(out) as Check[];
    else if (
      !/no checks reported/i.test(String((error as { stderr?: string }).stderr))
    )
      throw error;
  }
  // A push between the two reads would pair these checks with the wrong
  // commit, so treat it as nothing reported yet.
  if (view().headRefOid !== before.headRefOid) checks = [];
  return { state: before.state, head: before.headRefOid, checks };
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(
      "usage: pnpm ci:wait <pr> [--interval <seconds>] [--max-minutes <minutes>]",
    );
    return 2;
  }
  const { pr, intervalMs } = options;
  const started = Date.now();
  const deadline = started + options.maxMs;

  let misses = 0;
  let last: { head: string; checks: Check[] } | null = null;
  // Measured per head: a push resets it, so a new head gets its own grace.
  let emptySince = started;
  // A workflow can register after the others finish, so a finished set only
  // counts once two polls in a row see the same one.
  let settled = "";
  for (;;) {
    try {
      const { state, head, checks } = readPr(pr, deadline);
      misses = 0;
      if (state !== "OPEN") {
        console.log(`PR #${pr} is ${state}; nothing to wait for.`);
        return 2;
      }
      if (checks.length || head !== last?.head) emptySince = Date.now();
      last = { head, checks };
      const verdict = judge(checks, head);
      const key = verdict.done
        ? `${head} ${checks
            .map((c) => `${c.name}:${c.bucket}`)
            .sort()
            .join(",")}`
        : "";
      const confirmed = verdict.done && key === settled;
      settled = key;
      if (verdict.done && confirmed) {
        console.log(verdict.summary);
        return verdict.exit;
      }
    } catch (error) {
      if (++misses >= 3) {
        console.error(`gh failed 3 times in a row: ${String(error)}`);
        return 2;
      }
    }
    if (!last?.checks.length && Date.now() - emptySince > NO_CHECKS_GRACE_MS) {
      console.log("No checks were reported for this head within 5 minutes.");
      return 2;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      const final = last ? judge(last.checks, last.head) : null;
      if (final?.done) {
        console.log(final.summary);
        return final.exit;
      }
      const pending = last?.checks.filter((c) => c.bucket === "pending") ?? [];
      console.log(
        `Out of time with ${pending.length} checks still running: ${pending.map((c) => c.name).join(", ")}`,
      );
      return 2;
    }
    execFileSync("sleep", [String(Math.min(intervalMs, left) / 1000)]);
  }
}

// Exit by setting exitCode, not by calling exit: the summary goes to a pipe,
// and an immediate exit can cut it off before it drains.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exitCode = main();
