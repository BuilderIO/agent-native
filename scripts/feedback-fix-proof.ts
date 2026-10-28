#!/usr/bin/env node
// CI gate for feedback-sweep PRs: every report under the body's `Reports`
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
//   ... feedback-fix-proof.ts --has-reports   prints has_reports=true|false
//
// The workflow runs --has-reports on every PR, before installing anything,
// so this parser is the only rule for which PRs get checked.
//
// Each proof's fix commit must be on this branch and not on its base
// (BASE_SHA, or the merge-base with origin/main).
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
  const start = lines.findIndex((line) =>
    /^ {0,3}#{1,6}\s+Reports\b/i.test(line),
  );
  if (start === -1) return null;
  // Subheadings (### Sentry) group reports; only a heading at the same level
  // or higher ends the section.
  const level = /#+/.exec(lines[start])![0].length;
  const reports: Report[] = [];
  for (const line of lines.slice(start + 1)) {
    const heading = /^ {0,3}(#{1,6})\s/.exec(line);
    if (heading && heading[1].length <= level) break;
    // A line that is only a proof or a visual pair, even as a list item,
    // belongs to the report above it.
    const evidence = line
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^`/, "");
    // Any other line with a URL starts a report, whatever its format, and
    // may carry its proof on the same line. A detail link read as a report
    // fails as NO PROOF, which is the safe direction.
    const link = /^(fix-proof|visual):/.test(evidence)
      ? undefined
      : /(https?:\/\/[^\s)>]+)/.exec(line)?.[1];
    if (link) reports.push({ link, proven: [], visual: false });
    const report = reports.at(-1);
    if (!report) continue;
    const at = line.indexOf("fix-proof: proven");
    const proof =
      at === -1 ? null : PROVEN.exec(line.slice(at).replace(/`\s*$/, ""));
    if (proof) report.proven.push(`${proof[1]}\t${proof[2].trim()}`);
    if (/^visual:\s*https?:\/\/\S+\s+https?:\/\/\S+/.test(evidence))
      report.visual = true;
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
  if (process.argv.includes("--has-reports")) {
    console.log(`has_reports=${reports !== null}`);
    return;
  }
  if (!reports) {
    console.log("feedback-fix-proof: no `Reports` heading; nothing to check");
    return;
  }
  if (reports.length === 0) {
    console.error(
      "feedback-fix-proof: could not run: the `Reports` heading lists no report links",
    );
    process.exit(2);
  }

  const missing = reports.filter((r) => r.proven.length === 0 && !r.visual);
  for (const r of missing)
    console.log(
      `NO PROOF: ${r.link} (add a fix-proof or visual: line under it)`,
    );

  const base =
    process.env.BASE_SHA ||
    spawnSync("git", ["merge-base", "HEAD", "origin/main"], {
      encoding: "utf8",
    }).stdout.trim();
  if (!base) {
    console.error(
      "feedback-fix-proof: could not run: set BASE_SHA or fetch origin/main",
    );
    process.exit(2);
  }
  const isAncestor = (a: string, b: string) =>
    spawnSync("git", ["merge-base", "--is-ancestor", a, b]).status === 0;

  let worst = missing.length ? 1 : 0;
  for (const proof of new Set(reports.flatMap((r) => r.proven))) {
    const [fix, command] = proof.split("\t");
    if (!isAncestor(fix, "HEAD") || isAncestor(fix, base)) {
      console.log(`NOT IN THIS PR: proof commit ${fix} is not on this branch`);
      worst = Math.max(worst, 1);
      continue;
    }
    console.log(`\n=== re-running proof for ${fix}: ${command}`);
    // fix-proof refuses arguments with whitespace, so splitting on it
    // round-trips the command it printed.
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
