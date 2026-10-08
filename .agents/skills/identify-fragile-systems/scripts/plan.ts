import { readFileSync, writeFileSync } from "node:fs";

import { ScriptError } from "./lib.ts";

export interface PlanMeta {
  fingerprint: string;
  title: string;
  area: string;
  systems: string[];
  paths: string[];
  verdict: string;
  confidence: string;
  score: number | null;
  windowCommits: number | null;
  lookbackFixes: number | null;
  runId: string;
  jira: string | null;
  summary: string;
}

export const TODO = "TODO(agent)";

const LIST_KEYS = new Set(["systems", "paths"]);
const NUMBER_KEYS = new Set(["score", "windowCommits", "lookbackFixes"]);

export function readPlan(file: string): { meta: PlanMeta; body: string } {
  const text = readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new ScriptError(`${file} has no frontmatter block`);
  const raw: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of match[1].split("\n")) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (raw[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const pair = /^(\w+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    listKey = LIST_KEYS.has(pair[1]) ? pair[1] : null;
    raw[pair[1]] = listKey ? [] : unquote(pair[2]);
  }
  const str = (k: string) =>
    typeof raw[k] === "string" ? (raw[k] as string) : "";
  const num = (k: string) =>
    str(k) === "" || str(k) === "null" ? null : Number(str(k));
  const meta: PlanMeta = {
    fingerprint: str("fingerprint"),
    title: str("title"),
    area: str("area") || "Framework",
    systems: (raw.systems as string[]) ?? [],
    paths: (raw.paths as string[]) ?? [],
    verdict: str("verdict"),
    confidence: str("confidence"),
    score: num("score"),
    windowCommits: num("windowCommits"),
    lookbackFixes: num("lookbackFixes"),
    runId: str("runId"),
    jira: str("jira") && str("jira") !== "null" ? str("jira") : null,
    summary: str("summary"),
  };
  for (const key of ["fingerprint", "title", "runId", "summary"] as const) {
    if (!meta[key])
      throw new ScriptError(`${file}: frontmatter is missing ${key}`);
  }
  return { meta, body: match[2] };
}

export function writePlan(file: string, meta: PlanMeta, body: string): void {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else if (NUMBER_KEYS.has(key) || value === null) {
      lines.push(`${key}: ${value ?? "null"}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---", "");
  writeFileSync(file, `${lines.join("\n")}${body.replace(/^\n+/, "")}`);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      throw new ScriptError(
        `frontmatter value is not valid JSON-quoted text: ${trimmed}`,
      );
    }
  }
  return trimmed;
}
