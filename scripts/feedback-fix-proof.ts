#!/usr/bin/env node
// CI gate for feedback-sweep PRs: every report under the body's `## Reports`
// heading needs a proof line, and every `fix-proof: proven` line is re-run
// here, so a proof that was skipped or pasted from nowhere turns CI red.
//
//   ## Reports
//   - https://app.slack.com/archives/C0.../p123
//     fix-proof: proven, red at 1a2b3c4d5 (exit 1), green at 6e7f8a9b0: pnpm ... vitest run x.spec.ts
//   - https://app.slack.com/archives/C0.../p456
//     visual: <before screenshot url> <after screenshot url>
//
//   PR_BODY="$(gh pr view N --json body -q .body)" node scripts/feedback-fix-proof.ts
//
// Exit 0: every report proven. Exit 1: a report has no proof, or a proof
// did not hold on re-run. Exit 2: could not run.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Report = { link: string; proven: string[]; visual: boolean };

const PROVEN =
  /fix-proof: proven, red at [0-9a-f]+ \(exit \d+\), green at ([0-9a-f]{7,40}): (.+)$/;

export function parseReports(body: string): Report[] | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+Reports\s*$/.test(line));
  if (start === -1) return null;
  const reports: Report[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    const link = /^[-*]\s.*?(https?:\/\/[^\s)>]+)/.exec(line)?.[1];
    if (link) {
      reports.push({ link, proven: [], visual: false });
      continue;
    }
    const report = reports.at(-1);
    if (!report) continue;
    const proof = PROVEN.exec(line.replace(/`/g, "").trim());
    if (proof) report.proven.push(`${proof[1]}\t${proof[2].trim()}`);
    else if (/^\s*visual:\s*\S+/.test(line)) report.visual = true;
  }
  return reports;
}

function main() {
  const body = process.env.PR_BODY;
  if (body === undefined) {
    console.error("feedback-fix-proof: could not run: PR_BODY is not set");
    process.exit(2);
  }
  const reports = parseReports(body);
  if (!reports) {
    console.log(
      "feedback-fix-proof: no `## Reports` section; nothing to check",
    );
    return;
  }
  if (reports.length === 0) {
    console.error(
      "feedback-fix-proof: could not run: `## Reports` lists no report links",
    );
    process.exit(2);
  }

  const missing = reports.filter((r) => r.proven.length === 0 && !r.visual);
  for (const r of missing)
    console.log(
      `NO PROOF: ${r.link} (add a fix-proof or visual: line under it)`,
    );

  let worst = missing.length ? 1 : 0;
  for (const proof of new Set(reports.flatMap((r) => r.proven))) {
    const [fix, command] = proof.split("\t");
    console.log(`\n=== re-running proof for ${fix}: ${command}`);
    // Split on spaces, like fix-proof prints it; a proof command can't rely
    // on shell quoting.
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        resolve(import.meta.dirname, "fix-proof.ts"),
        "--fix",
        fix,
        "--",
        ...command.split(/\s+/),
      ],
      { stdio: "inherit" },
    );
    const status = r.status ?? 2;
    if (status !== 0) worst = Math.max(worst, status === 2 ? 2 : 1);
  }
  if (worst) process.exit(worst);
  console.log(`\nfeedback-fix-proof: all ${reports.length} reports proven`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
