#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  diffBaseCommit,
  execGuardCommand,
  readCommitFile,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SOURCE_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;
const EXCLUDED_PATH =
  /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.netlify|\.vercel|\.wrangler|coverage)(\/|$)/;
export const EVENT_CALL =
  /(?:^|[^\w$])(?:[\w$]+\??\.)*?(trackEvent|track)(?:\?\.)?\(\s*["'`]([^"'`]+)["'`]/g;
const RESERVED_EVENT_NAMES = new Set([
  "action.response",
  "app.first_action",
  "http.response",
]);

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function isCanonicalEventName(name) {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name);
}

function isReservedEventName(name) {
  return name.startsWith("$") || RESERVED_EVENT_NAMES.has(name);
}

export function eventNameCounts(source) {
  const counts = new Map();
  for (const match of source.matchAll(EVENT_CALL)) {
    counts.set(match[2], (counts.get(match[2]) ?? 0) + 1);
  }
  return counts;
}

export function namesBeyondBase(headSource, baseSource, names) {
  const head = eventNameCounts(headSource);
  const base = eventNameCounts(baseSource);
  return new Set(
    [...names].filter((name) => (head.get(name) ?? 0) > (base.get(name) ?? 0)),
  );
}

export function renamedFrom(nameStatus) {
  const renames = new Map();
  for (const line of nameStatus.split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) renames.set(to, from);
  }
  return renames;
}

let baseFiles;

function baseFilesOf() {
  if (baseFiles) return baseFiles;
  const commit = diffBaseCommit(REPO_ROOT);
  if (commit === null) {
    console.error("guard:tracking-event-names: no diff base");
    process.exit(2);
  }
  const renames = renamedFrom(
    execGuardCommand(
      "git",
      [
        "-c",
        "core.quotePath=false",
        "diff",
        "--name-status",
        "--find-renames",
        "--diff-filter=R",
        commit,
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    ),
  );
  baseFiles = { commit, renames };
  return baseFiles;
}

function baseSourceOf(relativePath) {
  const { commit, renames } = baseFilesOf();
  const basePath = renames.get(relativePath) ?? relativePath;
  const listed = execGuardCommand(
    "git",
    ["ls-tree", "--name-only", commit, "--", basePath],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return listed.trim() ? readCommitFile(REPO_ROOT, commit, basePath) : "";
}

function relative(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard:tracking-event-names");
  const violations = [];
  let filesChecked = 0;
  let callsChecked = 0;

  for (const [absolutePath, addedLineNumbers] of added) {
    const relativePath = relative(absolutePath);
    if (
      !SOURCE_EXTENSIONS.test(relativePath) ||
      EXCLUDED_PATH.test(relativePath)
    ) {
      continue;
    }

    let source;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch {
      console.error(`guard:tracking-event-names: unreadable ${relativePath}`);
      process.exit(2);
    }

    filesChecked += 1;
    const fileViolations = [];
    for (const match of source.matchAll(EVENT_CALL)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const startLine = lineNumberAt(source, start);
      const endLine = lineNumberAt(source, end);
      const touched = [...addedLineNumbers].some(
        (line) => line >= startLine && line <= endLine,
      );
      if (!touched) continue;

      const name = match[2];
      callsChecked += 1;
      if (isCanonicalEventName(name) || isReservedEventName(name)) continue;
      fileViolations.push({
        file: relativePath,
        line: startLine,
        name,
      });
    }
    if (fileViolations.length === 0) continue;
    const newNames = namesBeyondBase(
      source,
      baseSourceOf(relativePath),
      fileViolations.map((violation) => violation.name),
    );
    violations.push(
      ...fileViolations.filter((violation) => newNames.has(violation.name)),
    );
  }

  if (violations.length === 0) {
    console.log(
      `guard:tracking-event-names: OK (${callsChecked} added tracking call(s) across ${filesChecked} file(s))`,
    );
    return;
  }

  console.error(
    `guard:tracking-event-names: ${violations.length} new non-canonical event name(s):`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} ${violation.name} - use lowercase snake_case`,
    );
  }
  console.error(
    "  Keep provider-reserved names explicit; do not add new legacy aliases.",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
