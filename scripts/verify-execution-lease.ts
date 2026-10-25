#!/usr/bin/env tsx
/**
 * Model-check the turn execution lease and durable step journal
 * (verification/execution-lease) with TLC, and check that the code the model
 * describes has not changed since the model was last confirmed against it.
 *
 * Exit codes follow the guard contract: 0 passed, 1 failed (an invariant is
 * violated, a mutation or known finding no longer fails, or covered code
 * drifted), 2 could not run (no Java, the TLA+ tools could not be fetched or
 * verified, or TLC itself errored).
 *
 *   pnpm verify:execution-lease                    everything below
 *   pnpm verify:execution-lease --quick            skip mutations and findings
 *   pnpm verify:execution-lease --update-coverage  re-record covered code after
 *                                                  confirming the model matches
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MODEL_DIR = path.join(REPO_ROOT, "verification", "execution-lease");
const MANIFEST_PATH = path.join(MODEL_DIR, "manifest.json");
const TOOLS_DIR = path.join(REPO_ROOT, ".tmp", "tla");

/** A named function, or the text from one exact anchor through the next. */
type CoveredCode = { file: string; sha256: string } & (
  | { name: string }
  | { from: string; to: string }
);

interface Manifest {
  spec: string;
  tlaTools: { version: string; url: string; sha256: string };
  /** Configs of the current code; each must pass. */
  checks: { config: string }[];
  /** Deliberately broken variants; each must still violate `invariant`. */
  mutations: { config: string; invariant: string; breaks: string }[];
  /** Known bugs in the current code; each must keep violating `invariant`. */
  findings: { config: string; invariant: string; finding: string }[];
  coverage: { syncCommit: string; code: CoveredCode[] };
}

class CouldNotRun extends Error {}

function readManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new CouldNotRun(`missing ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

function findJava(): string {
  // Homebrew's openjdk is keg-only, so it is usually not on PATH.
  const candidates = [
    "java",
    ...["/opt/homebrew/opt", "/usr/local/opt"].flatMap((root) =>
      existsSync(root)
        ? readdirSync(root)
            .filter((name) => name.startsWith("openjdk"))
            .map((name) => path.join(root, name, "bin", "java"))
        : [],
    ),
  ];
  for (const candidate of candidates) {
    // macOS ships a /usr/bin/java stub that exits non-zero without a JDK.
    const probe = spawnSync(candidate, ["-version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  throw new CouldNotRun(
    "no Java runtime found (TLC needs Java 11+). Install one, e.g. `brew install openjdk@21`, or put java on PATH.",
  );
}

async function ensureTlaTools(tools: Manifest["tlaTools"]): Promise<string> {
  const jar = path.join(TOOLS_DIR, `tla2tools-${tools.version}.jar`);
  if (!existsSync(jar)) {
    mkdirSync(TOOLS_DIR, { recursive: true });
    const response = await fetch(tools.url);
    if (!response.ok) {
      throw new CouldNotRun(
        `downloading ${tools.url} failed: HTTP ${response.status}`,
      );
    }
    writeFileSync(jar, Buffer.from(await response.arrayBuffer()));
  }
  const digest = createHash("sha256").update(readFileSync(jar)).digest("hex");
  if (digest !== tools.sha256) {
    throw new CouldNotRun(
      `${path.relative(REPO_ROOT, jar)} has sha256 ${digest}, expected ${tools.sha256}; delete it and rerun`,
    );
  }
  return jar;
}

type TlcOutcome =
  | { kind: "pass"; summary: string }
  | { kind: "violation"; invariant: string; summary: string; trace: string };

function runTlc(java: string, jar: string, spec: string, config: string) {
  const metadir = path.join(REPO_ROOT, ".tmp", "tlc-states");
  const started = Date.now();
  const result = spawnSync(
    java,
    [
      "-Xmx2g",
      "-XX:+UseParallelGC",
      "-cp",
      jar,
      "tlc2.TLC",
      "-workers",
      "2",
      "-cleanup",
      "-metadir",
      metadir,
      "-config",
      path.join(MODEL_DIR, config),
      path.join(MODEL_DIR, spec),
    ],
    { cwd: MODEL_DIR, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  // Progress lines also report distinct states; the final summary is last.
  const states =
    [...output.matchAll(/([\d,]+) distinct states found/g)].at(-1)?.[1] ?? "?";
  const summary = `${states} distinct states, ${seconds}s`;
  if (output.includes("Model checking completed. No error has been found.")) {
    return { kind: "pass", summary } satisfies TlcOutcome;
  }
  const violated = output.match(/Error: Invariant (\w+) is violated/);
  if (violated) {
    const traceStart = output.indexOf("Error: The behavior up to this point");
    return {
      kind: "violation",
      invariant: violated[1]!,
      summary: `${violated[1]} violated (${summary})`,
      trace: traceStart >= 0 ? output.slice(traceStart) : output,
    } satisfies TlcOutcome;
  }
  throw new CouldNotRun(
    `TLC did not finish ${config}:\n${output.slice(-4000)}`,
  );
}

function functionNodes(source: ts.SourceFile, name: string): ts.Node[] {
  const matches: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name?.getText(source) === name
    ) {
      matches.push(node);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
}

function describeCovered(entry: CoveredCode): string {
  return "name" in entry ? entry.name : `region from "${entry.from}"`;
}

function coveredText(entry: CoveredCode): string {
  const absolute = path.join(REPO_ROOT, entry.file);
  if (!existsSync(absolute)) {
    throw new CouldNotRun(`covered file ${entry.file} no longer exists`);
  }
  const text = readFileSync(absolute, "utf8");
  if (!("name" in entry)) {
    const start = text.indexOf(entry.from);
    const end = start < 0 ? -1 : text.indexOf(entry.to, start);
    if (start < 0 || end < 0 || text.indexOf(entry.from, start + 1) >= 0) {
      throw new CouldNotRun(
        `covered ${describeCovered(entry)} in ${entry.file} is missing or not unique; update its anchors`,
      );
    }
    return text.slice(start, end + entry.to.length);
  }
  const source = ts.createSourceFile(
    entry.file,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const matches = functionNodes(source, entry.name);
  if (matches.length !== 1) {
    throw new CouldNotRun(
      `covered function ${entry.name} in ${entry.file} matched ${matches.length} declarations; the coverage record must name exactly one`,
    );
  }
  return matches[0]!.getText(source);
}

function hashCovered(entry: CoveredCode): string {
  return createHash("sha256").update(coveredText(entry)).digest("hex");
}

function updateCoverage(manifest: Manifest): void {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  manifest.coverage.syncCommit = head;
  manifest.coverage.code = manifest.coverage.code.map((entry) => ({
    ...entry,
    sha256: hashCovered(entry),
  }));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Recorded ${manifest.coverage.code.length} covered code entries at ${head.slice(0, 12)}.`,
  );
}

function expectViolation(
  outcome: TlcOutcome,
  expected: { config: string; invariant: string },
): string | null {
  if (
    outcome.kind === "violation" &&
    outcome.invariant === expected.invariant
  ) {
    return null;
  }
  const got =
    outcome.kind === "violation" ? `${outcome.invariant} instead` : "a pass";
  return `${expected.config} should violate ${expected.invariant} but gave ${got}`;
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  const manifest = readManifest();
  if (args.has("--update-coverage")) {
    updateCoverage(manifest);
    return 0;
  }

  const problems: string[] = [];
  const drifted = manifest.coverage.code.filter(
    (entry) => hashCovered(entry) !== entry.sha256,
  );
  for (const entry of drifted) {
    problems.push(
      `covered code changed since ${manifest.coverage.syncCommit.slice(0, 12)}: ${entry.file} ${describeCovered(entry)}`,
    );
  }

  const java = findJava();
  const jar = await ensureTlaTools(manifest.tlaTools);
  for (const check of manifest.checks) {
    const outcome = runTlc(java, jar, manifest.spec, check.config);
    console.log(`${check.config}: ${outcome.kind} (${outcome.summary})`);
    if (outcome.kind === "violation") {
      problems.push(`${check.config}: ${outcome.summary}`);
      console.log(outcome.trace);
    }
  }
  if (!args.has("--quick")) {
    for (const mutation of manifest.mutations) {
      const outcome = runTlc(java, jar, manifest.spec, mutation.config);
      console.log(`${mutation.config}: ${outcome.kind} (${outcome.summary})`);
      const problem = expectViolation(outcome, mutation);
      if (problem) {
        problems.push(
          `${problem}, so the check may no longer catch: ${mutation.breaks}`,
        );
      }
    }
    for (const finding of manifest.findings) {
      const outcome = runTlc(java, jar, manifest.spec, finding.config);
      console.log(`${finding.config}: ${outcome.kind} (${outcome.summary})`);
      const problem = expectViolation(outcome, finding);
      if (problem) {
        problems.push(
          `${problem} (${finding.finding}); if the code was fixed, move it to checks and update NOTES.md`,
        );
      }
    }
  }

  if (problems.length === 0) {
    console.log("verify-execution-lease: passed.");
    return 0;
  }
  console.error(`verify-execution-lease: ${problems.length} problem(s).`);
  for (const problem of problems) console.error(`  ${problem}`);
  if (drifted.length > 0) {
    console.error(
      "\nRe-read the drifted code against verification/execution-lease, update the model if the protocol changed, then run with --update-coverage.",
    );
  }
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const detail =
      error instanceof CouldNotRun
        ? error.message
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error);
    console.error(`verify-execution-lease: could not run: ${detail}`);
    process.exit(2);
  },
);
