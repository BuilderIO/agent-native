#!/usr/bin/env node
// Blocks until every check on a PR's current head has finished, printing
// nothing while it waits, then prints one summary.
//
//   pnpm ci:wait <pr> [--interval 60] [--max-minutes 120]
//
// Exit 0: no check failed. Exit 1: a check failed. Exit 2: couldn't tell
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

function gh(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readPr(pr: string): { state: string; head: string; checks: Check[] } {
  const view = JSON.parse(
    gh(["pr", "view", pr, "--json", "state,headRefOid"]),
  ) as { state: string; headRefOid: string };
  let checks: Check[] = [];
  try {
    checks = JSON.parse(
      gh(["pr", "checks", pr, "--json", "name,bucket,link"]),
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
  return { state: view.state, head: view.headRefOid, checks };
}

function main(): void {
  const args = process.argv.slice(2);
  const pr = args.find((a) => /^\d+$/.test(a));
  const option = (name: string, fallback: number) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : Number(args[i + 1]);
  };
  const intervalMs = option("--interval", 60) * 1000;
  const deadline = Date.now() + option("--max-minutes", 120) * 60_000;
  if (!pr) {
    console.error(
      "usage: pnpm ci:wait <pr> [--interval 60] [--max-minutes 120]",
    );
    process.exit(2);
  }

  let misses = 0;
  let last: { head: string; checks: Check[] } | null = null;
  for (;;) {
    try {
      const { state, head, checks } = readPr(pr);
      misses = 0;
      if (state !== "OPEN") {
        console.log(`PR #${pr} is ${state}; nothing to wait for.`);
        process.exit(2);
      }
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
    if (Date.now() + intervalMs > deadline) {
      const pending = last?.checks.filter((c) => c.bucket === "pending") ?? [];
      console.log(
        last?.checks.length
          ? `Out of time with ${pending.length} checks still running: ${pending.map((c) => c.name).join(", ")}`
          : "Out of time: no checks were ever reported for this PR.",
      );
      process.exit(2);
    }
    execFileSync("sleep", [String(intervalMs / 1000)]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
