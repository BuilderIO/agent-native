#!/usr/bin/env node
// Blocks until every check on a PR's current head has finished, printing
// nothing while it waits, then prints one summary.
//
//   pnpm ci:wait <pr> [--interval <seconds>] [--max-minutes <minutes>]
//
// Exit 0: no check failed (a cancelled check is listed, not counted as a
// pass). Exit 1: a check failed. Exit 2: couldn't tell
// (gh unreadable, PR not open, no checks reported, or out of time).
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type Check = { name: string; bucket: string; link: string };

export type Verdict =
  | { done: false }
  | { done: true; exit: 0 | 1; summary: string };

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
  return { done: true, exit: failed.length ? 1 : 0, summary: lines.join("\n") };
}

const NO_CHECKS_GRACE_MS = 10 * 60_000;

export type Options = { pr: string; intervalMs: number; maxMs: number };

export function parseArgs(argv: string[]): Options | null {
  const values: Record<string, number> = {
    "--interval": 60,
    "--max-minutes": 120,
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
    maxMs: (values["--max-minutes"] ?? 120) * 60_000,
  };
}

function gh(args: string[], timeout: number): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
}

function readPr(
  pr: string,
  timeout: number,
): { state: string; head: string; checks: Check[] } {
  const view = () =>
    JSON.parse(
      gh(["pr", "view", pr, "--json", "state,headRefOid"], timeout),
    ) as {
      state: string;
      headRefOid: string;
    };
  const before = view();
  let checks: Check[] = [];
  try {
    checks = JSON.parse(
      gh(["pr", "checks", pr, "--json", "name,bucket,link"], timeout),
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

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(
      "usage: pnpm ci:wait <pr> [--interval <seconds>] [--max-minutes <minutes>]",
    );
    process.exit(2);
  }
  const { pr, intervalMs } = options;
  const started = Date.now();
  const deadline = started + options.maxMs;

  let misses = 0;
  let last: { head: string; checks: Check[] } | null = null;
  // Measured per head: a push resets it, so a new head gets its own grace.
  let emptySince = started;
  for (;;) {
    try {
      const { state, head, checks } = readPr(
        pr,
        Math.max(1000, deadline - Date.now()),
      );
      misses = 0;
      if (state !== "OPEN") {
        console.log(`PR #${pr} is ${state}; nothing to wait for.`);
        process.exit(2);
      }
      if (checks.length || head !== last?.head) emptySince = Date.now();
      last = { head, checks };
      const verdict = judge(checks, head);
      if (verdict.done) {
        console.log(verdict.summary);
        process.exit(verdict.exit);
      }
    } catch (error) {
      if (++misses >= 3) {
        console.error(`gh failed 3 times in a row: ${String(error)}`);
        process.exit(2);
      }
    }
    if (!last?.checks.length && Date.now() - emptySince > NO_CHECKS_GRACE_MS) {
      console.log("No checks were reported for this head within 10 minutes.");
      process.exit(2);
    }
    if (Date.now() + intervalMs > deadline) {
      const pending = last?.checks.filter((c) => c.bucket === "pending") ?? [];
      console.log(
        `Out of time with ${pending.length} checks still running: ${pending.map((c) => c.name).join(", ")}`,
      );
      process.exit(2);
    }
    execFileSync("sleep", [String(intervalMs / 1000)]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
