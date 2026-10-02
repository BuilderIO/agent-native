// Checks the plan against the code and against itself:
// - every anchor in a requirement's refs (path[:line][#symbol]) points at a real
//   file, and its symbol is still within WINDOW lines of the cited line;
// - every file mentioned in the text or README.md still exists;
// - requirements.md matches requirements.json (rebuild with build.ts);
// - every decided requirement is named under Decisions in README.md, every open
//   question is listed under Open questions, and README.md names no unknown ids.
// Exit 0: all good. Exit 1: problems listed. Exit 2: could not run (no git).
// Run: node docs/plans/2026-10-01-design-editor-shell/prototype/check-refs.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRequirements, planDir, requirementsMarkdown } from "./lib.ts";

const WINDOW = 30;
const repoRoot = join(planDir, "../../..");

let tracked: string[];
try {
  tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
} catch (error) {
  console.error(`check-refs could not list files: ${(error as Error).message}`);
  process.exit(2);
}

const areas = loadRequirements();
const items = areas.flatMap((area) => area.items);
const readme = readFileSync(join(planDir, "README.md"), "utf8");
const problems: string[] = [];
const cache = new Map<string, string[]>();
const fileLines = (path: string) => {
  if (!cache.has(path)) {
    cache.set(path, readFileSync(join(repoRoot, path), "utf8").split("\n"));
  }
  return cache.get(path) as string[];
};

// 1. Anchors.
let anchors = 0;
for (const item of items) {
  for (const ref of item.refs ?? []) {
    const match = ref.match(/^([^:#]+)(?::(\d+))?(?:#(.+))?$/);
    if (!match) {
      problems.push(`${item.id}: unreadable ref "${ref}"`);
      continue;
    }
    const [, path, lineText, symbol] = match;
    if (!existsSync(join(repoRoot, path))) {
      problems.push(`${item.id}: ${path} does not exist`);
      continue;
    }
    const text = fileLines(path);
    const line = lineText ? Number(lineText) : null;
    if (line !== null && line > text.length) {
      problems.push(`${item.id}: ${path} has ${text.length} lines, not ${line}`);
      continue;
    }
    if (symbol) {
      const hits = text.flatMap((row, index) =>
        row.includes(symbol) ? [index + 1] : [],
      );
      if (hits.length === 0) {
        problems.push(`${item.id}: "${symbol}" is no longer in ${path}`);
        continue;
      }
      if (line !== null) {
        const nearest = hits.reduce((a, b) =>
          Math.abs(b - line) < Math.abs(a - line) ? b : a,
        );
        if (Math.abs(nearest - line) > WINDOW) {
          problems.push(
            `${item.id}: "${symbol}" moved from ${path}:${line} to :${nearest}`,
          );
          continue;
        }
      }
    }
    anchors += 1;
  }
}

// 2. File names mentioned in prose. They must start with a word character (so
// `.spec.ts` globs don't count) and end at the extension.
const FILE_REF =
  /(?<![\w.*/-])(\w[\w@.-]*(?:\/[\w@.[\]$-]+)*\.(?:tsx|ts|css|mjs|md))(?![\w-])/g;
const prose = [
  ...items.flatMap((item) => [item.today, item.change, item.prototype]),
  readme,
].filter((text): text is string => Boolean(text));
let mentions = 0;
for (const text of prose) {
  for (const [, path] of text.matchAll(FILE_REF)) {
    const found = path.includes("/")
      ? tracked.some((file) => file === path || file.endsWith(`/${path}`))
      : tracked.some((file) => file.split("/").pop() === path);
    if (!found) {
      problems.push(`mentioned file ${path} does not exist`);
      continue;
    }
    mentions += 1;
  }
}

// 3. requirements.md is current.
const markdownPath = join(planDir, "requirements.md");
if (
  !existsSync(markdownPath) ||
  readFileSync(markdownPath, "utf8") !== requirementsMarkdown(areas)
) {
  problems.push("requirements.md is out of date: run prototype/build.ts");
}

// 4. README.md agrees with the statuses.
const section = (title: string) => {
  const start = readme.indexOf(`## ${title}`);
  if (start === -1) return "";
  const next = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
};
const decisions = section("Decisions");
const questions = section("Open questions");
for (const item of items) {
  if (item.status === "decided" && !decisions.includes(item.id)) {
    problems.push(`${item.id} is decided but no entry under Decisions names it`);
  }
  if (item.status === "question" && !questions.includes(item.id)) {
    problems.push(`${item.id} is a question but isn't listed under Open questions`);
  }
}
const known = new Set(items.map((item) => item.id));
for (const [id] of readme.matchAll(/\b[A-Z]{2,5}-\d{2}\b/g)) {
  if (!known.has(id)) problems.push(`README.md names ${id}, which isn't a requirement`);
}

console.log(`${anchors} anchors and ${mentions} file mentions checked.`);
if (problems.length) {
  console.error(`${problems.length} problems:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("Plan, requirements, and code references agree.");
