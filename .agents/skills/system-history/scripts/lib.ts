// History-specific helpers: commit classification and path-to-system grouping.
import { loadSkillConfig } from "../../fragility-common/lib/cli.ts";

export interface HistoryConfig {
  baseBranch: string;
  windowHours: number;
  lookbackDays: number;
  regressionDays: number;
  reFixDays: number;
  minWindowCommits: number;
  maxHotSystems: number;
  systemDepth: Record<string, number>;
  ignoreSubjects: string[];
  ignorePaths: string[];
  mechanicalPaths: string[];
}

export function loadHistoryConfig(): HistoryConfig {
  return loadSkillConfig<HistoryConfig>(import.meta.url);
}

export type CommitKind =
  | "fix"
  | "revert"
  | "feat"
  | "refactor"
  | "perf"
  | "test"
  | "docs"
  | "ci"
  | "chore"
  | "other";

const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:/;
const FIX_WORDS =
  /\b(fix(es|ed)?|bug|regression|hotfix|repair|restore|prevent|harden|unbreak|broken|crash|flak(y|e))\b/i;
// This repo writes most subjects as plain imperative sentences ("Keep X on Y"),
// so the leading verb carries the intent that a conventional prefix would.
const FIX_VERBS =
  /^(fix|keep|preserve|stop|stabili[sz]e|honou?r|prevent|restore|recover|handle|avoid|guard|retry|unblock|correct|repair|ensure|survive|tolerate|resume|unstick|dedupe)\b/i;
const FEAT_VERBS =
  /^(add|offer|introduce|support|bundle|enable|expose|build|create|launch|ship|let|allow)\b/i;
const REFACTOR_VERBS =
  /^(split|extract|consolidate|rename|unify|replace|simplify|migrate|move|share|centrali[sz]e|collapse|delete|remove)\b/i;

export function classifySubject(subject: string): CommitKind {
  if (/^revert\b/i.test(subject)) return "revert";
  const type = CONVENTIONAL.exec(subject)?.[1]?.toLowerCase();
  if (type === "fix" || type === "hotfix") return "fix";
  if (type === "feat") return FIX_WORDS.test(subject) ? "fix" : "feat";
  if (
    type &&
    ["refactor", "perf", "test", "docs", "ci", "chore"].includes(type)
  ) {
    return type as CommitKind;
  }
  const sentence = subject.replace(/^[A-Za-z][\w /-]{0,24}:\s+/, "");
  if (FIX_VERBS.test(sentence)) return "fix";
  if (
    /^make\b/i.test(sentence) &&
    /\b(reliabl[ey]|work|stable|safe|consistent|correct)/i.test(sentence)
  ) {
    return "fix";
  }
  if (FIX_WORDS.test(sentence)) return "fix";
  if (FEAT_VERBS.test(sentence)) return "feat";
  if (REFACTOR_VERBS.test(sentence)) return "refactor";
  return "other";
}

export function prNumber(subject: string): number | null {
  const match = /\(#(\d+)\)\s*$/.exec(subject) ?? /#(\d+)/.exec(subject);
  return match ? Number(match[1]) : null;
}

export function systemOf(file: string, config: HistoryConfig): string {
  const parts = file.split("/");
  const dirs = parts.slice(0, -1);
  const depth = config.systemDepth[parts[0]] ?? config.systemDepth.default;
  if (dirs.length >= depth) return dirs.slice(0, depth).join("/");
  const stem = parts[parts.length - 1]
    .replace(/\.(test|spec)(?=\.)/, "")
    .replace(/\.[^.]+$/, "");
  return [...dirs, stem].join("/");
}

export function compile(patterns: string[]): (value: string) => boolean {
  const regexes = patterns.map((p) => new RegExp(p));
  return (value) => regexes.some((r) => r.test(value));
}
