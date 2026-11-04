// Files the fragility skills exchange through the run directory. Each skill
// writes only its own files and reads the others through these types.
import path from "node:path";

import { readJson, readJsonOr, runDir, writeJson } from "./cli.ts";

export const ARTIFACTS = {
  bug: "bug.json",
  commits: "commits.json",
  analysis: "analysis.json",
  targets: "targets.json",
  findings: "findings.json",
  findingMatches: "finding-matches.json",
  findingResults: "finding-results.json",
  decisions: "decisions.json",
  verdicts: "verdict.json",
} as const;

export function artifact(id: string, name: keyof typeof ARTIFACTS): string {
  return path.join(runDir(id), ARTIFACTS[name]);
}

/** Written by bug-trace's bug-intake. */
export interface BugReport {
  runId: string;
  source: {
    kind: "github-issue" | "github-pr" | "jira" | "file" | "text";
    ref: string;
    url: string | null;
  };
  title: string;
  body: string;
  comments: { author: string; body: string }[];
  reportedAt: string | null;
  intakeAt: string;
}

export function readBug(id: string): BugReport | null {
  return readJsonOr<BugReport | null>(artifact(id, "bug"), null);
}

/** Written by system-history's analyze: one entry per system it scored. */
export interface Target {
  system: string;
  /** Focus files first, then the system's most-fixed files. */
  files: string[];
  score: number;
  verdict: string;
  windowCommits: number | null;
  lookbackFixes: number;
  weeklyFixes: number[];
}

export function readTargets(id: string): Target[] {
  return readJson<Target[]>(artifact(id, "targets"));
}

/** Appended by findings-upsert for every applied ticket action. */
export interface FindingResult {
  action: string;
  key: string;
  url: string;
  plan?: string;
  system?: string;
  /** The bug report a sighting linked, when there was one. */
  source?: string | null;
  at: string;
}

export function readFindingResults(id: string): FindingResult[] {
  return readJsonOr<FindingResult[]>(artifact(id, "findingResults"), []);
}

export function appendFindingResult(id: string, result: FindingResult): void {
  writeJson(artifact(id, "findingResults"), [
    ...readFindingResults(id),
    result,
  ]);
}
