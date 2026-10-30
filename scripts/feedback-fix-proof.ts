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
// Visual-only evidence is not machine proof. A passing run names each report
// that still needs a human to inspect its before/after screenshots before merge.
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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Report = {
  link: string;
  proven: string[];
  visual: [before: string, after: string] | null;
};
type VisualReport = Report & {
  visual: [before: string, after: string];
};

const PROVEN =
  /fix-proof: proven, red at [0-9a-f]+ \(exit \d+\), green at ([0-9a-f]{7,40}): (.+)$/;

const TEST_FILE =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./@-]+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const WORKSPACE = /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/;

export function parseProofCommand(command: string): string[] | null {
  const args = command.split(/\s+/);
  if (args.some((arg) => !arg || /[;&|`$<>]/.test(arg))) return null;
  // Codex shells often lack pnpm on PATH, so local proofs say `corepack pnpm`;
  // CI has pnpm itself.
  if (args[0] === "corepack" && args[1] === "pnpm") args.shift();

  const nodeTestPath = args[2];
  if (
    args[0] === "node" &&
    args[1] === "--test" &&
    args.length === 3 &&
    nodeTestPath !== undefined &&
    TEST_FILE.test(nodeTestPath)
  )
    return args;

  if (args[0] !== "pnpm") return null;
  let index = 1;
  if (args[index] === "--filter") {
    const workspace = args[index + 1];
    if (!workspace || !WORKSPACE.test(workspace)) return null;
    index += 2;
  }
  const testPath = args[index + 3];
  if (
    args[index] !== "exec" ||
    args[index + 1] !== "vitest" ||
    !["run", "--run"].includes(args[index + 2] ?? "") ||
    !testPath ||
    !TEST_FILE.test(testPath)
  )
    return null;
  const options = args.slice(index + 4);
  if (options.some((arg) => !/^--maxWorkers=\d+$/.test(arg))) return null;
  return args;
}

export function isTrackedRepositoryTest(
  args: string[],
  cwd = process.cwd(),
): boolean {
  const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (rootResult.error || rootResult.status !== 0) {
    throw new Error("Could not determine the repository root.", {
      cause: rootResult.error,
    });
  }
  const root = rootResult.stdout.trim();
  if (!root) throw new Error("Git returned an empty repository root.");

  let workspaceRoot = root;
  let testPath: string;
  if (args[0] === "node") {
    const nodeTestPath = args[2];
    if (!nodeTestPath) return false;
    testPath = nodeTestPath;
  } else {
    let index = 1;
    if (args[index] === "--filter") {
      const workspace = args[index + 1];
      if (!workspace) return false;
      const files = spawnSync(
        "git",
        ["ls-files", "-z", "--", "package.json", "**/package.json"],
        { cwd: root, encoding: "utf8" },
      );
      if (files.error || files.status !== 0) {
        throw new Error("Could not list tracked workspace manifests.", {
          cause: files.error,
        });
      }
      const matches: string[] = [];
      for (const file of files.stdout.split("\0").filter(Boolean)) {
        const manifest = resolve(root, file);
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "name" in parsed &&
          parsed.name === workspace
        ) {
          matches.push(dirname(manifest));
        }
      }
      if (matches.length !== 1) return false;
      const match = matches[0];
      if (!match) return false;
      workspaceRoot = match;
      index += 2;
    }
    const vitestPath = args[index + 3];
    if (!vitestPath) return false;
    testPath = vitestPath;
  }

  const candidate = resolve(workspaceRoot, testPath);
  let realRoot: string;
  let realCandidate: string;
  try {
    if (!existsSync(candidate)) return false;
    realRoot = realpathSync(workspaceRoot);
    realCandidate = realpathSync(candidate);
  } catch (error) {
    throw new Error("Could not resolve the proof test path.", { cause: error });
  }
  if (!realCandidate.startsWith(`${realRoot}${sep}`)) return false;

  const repoPath = relative(root, candidate);
  if (repoPath.startsWith(`..${sep}`)) return false;
  const tracked = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", repoPath],
    { cwd: root, stdio: "ignore" },
  );
  if (tracked.error) {
    throw new Error("Could not verify whether the proof test is tracked.", {
      cause: tracked.error,
    });
  }
  if (tracked.status === 0) return true;
  if (tracked.status === 1) return false;
  throw new Error("Git failed to verify whether the proof test is tracked.");
}

export function parseReports(body: string): Report[] | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  // Everything after the first Reports heading is the Reports section, so
  // sweep PRs put it last. No later heading, fence, or other Markdown can
  // end it early, and a stray link fails as NO PROOF, the safe direction.
  const start = lines.findIndex((line) =>
    /^ {0,3}#{1,6}\s+Reports\b/i.test(line),
  );
  if (start === -1) return null;
  const reports: Report[] = [];
  for (const line of lines.slice(start + 1)) {
    // A line that is only a proof or a visual pair, even as a list item,
    // belongs to the report above it.
    const evidence = line
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^`/, "");
    // Every URL on any other line starts a report, whatever its format; a
    // proof later on that line covers each of them. A detail link read as a
    // report fails as NO PROOF, which is the safe direction. URLs inside the
    // proof's own command are not reports.
    const at = line.indexOf("fix-proof: proven");
    const onLine = /^(fix-proof|visual):/.test(evidence)
      ? []
      : [
          ...(at === -1 ? line : line.slice(0, at)).matchAll(
            /https?:\/\/[^\s)>]+/g,
          ),
        ].map(([link]): Report => ({ link, proven: [], visual: null }));
    reports.push(...onLine);
    const targets = onLine.length ? onLine : reports.slice(-1);
    const proof =
      at === -1 ? null : PROVEN.exec(line.slice(at).replace(/`\s*$/, ""));
    const visual = /^visual:\s*(https?:\/\/\S+)\s+(https?:\/\/\S+)\s*$/.exec(
      evidence.replace(/`\s*$/, ""),
    );
    for (const report of targets) {
      if (proof) report.proven.push(`${proof[1]}\t${proof[2].trim()}`);
      if (visual) report.visual = [visual[1], visual[2]];
    }
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
  const visualOnly = reports.filter(
    (r): r is VisualReport => r.proven.length === 0 && r.visual !== null,
  );
  for (const r of missing)
    console.log(
      `NO PROOF: ${r.link} (add a fix-proof or visual: line under it)`,
    );
  for (const r of visualOnly) {
    const [before, after] = r.visual;
    console.log(
      `HUMAN VALIDATION REQUIRED BEFORE MERGE: ${r.link} (inspect before ${before} and after ${after})`,
    );
  }

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
    const commandArgs = parseProofCommand(command ?? "");
    if (!commandArgs) {
      console.error(
        `feedback-fix-proof: could not run: unsupported proof command; use a repository Vitest test or node --test <test-file>: ${command}`,
      );
      worst = Math.max(worst, 2);
      continue;
    }
    let trackedTest: boolean;
    try {
      trackedTest = isTrackedRepositoryTest(commandArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `feedback-fix-proof: could not run: unable to verify the repository test: ${message}`,
      );
      worst = Math.max(worst, 2);
      continue;
    }
    if (!trackedTest) {
      console.error(
        `feedback-fix-proof: could not run: the proof test must be tracked inside its repository workspace: ${command}`,
      );
      worst = Math.max(worst, 2);
      continue;
    }
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
        ...commandArgs,
      ],
      { stdio: "inherit" },
    );
    const status = r.status ?? 2;
    if (status !== 0) worst = Math.max(worst, status === 2 ? 2 : 1);
  }
  if (worst) process.exit(worst);
  if (visualOnly.length) {
    console.log(
      `\nfeedback-fix-proof: ${reports.length - visualOnly.length} reports machine-proven; ${visualOnly.length} require human visual validation before merge`,
    );
  } else {
    console.log(
      `\nfeedback-fix-proof: all ${reports.length} reports machine-proven`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
