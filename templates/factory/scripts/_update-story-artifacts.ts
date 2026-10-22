import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  computeCoverage,
  renderCoverage,
} from "../server/workflow/stories/coverage.js";
import { runAllStories } from "../server/workflow/stories/proof-kit.js";
import { STORIES } from "../server/workflow/stories/registry.js";
import type { ScenarioSummary } from "../server/workflow/testing/story-data.js";

// Runs every scenario of every story through the real engine, writes what the
// stories named on the command line (all of them by default) came to as their
// `expect.json`, and rewrites `COVERAGE.md`. Read the diff before committing: a
// changed expectation is a changed behavior. `--print` shows them instead of
// writing.
//
//   pnpm stories:update [story-key ...] [--print]

const WIDTH = 80;

/** A value on one line, spaced the way prettier spaces JSON. */
function flat(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(flat).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    return entries.length === 0
      ? "{}"
      : `{ ${entries.map(([key, entry]) => `${JSON.stringify(key)}: ${flat(entry)}`).join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

/** JSON laid out like prettier would: a value on one line when it fits, spread out when it does not. */
function formatJson(value: unknown, indent = 0, used = 0): string {
  const line = flat(value);
  if (
    typeof value !== "object" ||
    value === null ||
    indent + used + line.length <= WIDTH
  ) {
    return line;
  }
  const pad = " ".repeat(indent + 2);
  if (Array.isArray(value)) {
    return `[\n${value
      .map((entry) => `${pad}${formatJson(entry, indent + 2)}`)
      .join(",\n")}\n${" ".repeat(indent)}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return `{\n${entries
    .map(([key, entry]) => {
      const head = `${JSON.stringify(key)}: `;
      return `${pad}${head}${formatJson(entry, indent + 2, head.length)}`;
    })
    .join(",\n")}\n${" ".repeat(indent)}}`;
}

const args = process.argv.slice(2);
const print = args.includes("--print");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const selected = Object.values(STORIES).filter(
  (story) => wanted.length === 0 || wanted.includes(story.key),
);
if (selected.length === 0) {
  console.error(
    `No story matches ${wanted.join(", ")}. Keys: ${Object.keys(STORIES).join(", ")}`,
  );
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "../server/workflow/stories");
const written: string[] = [];
const runs = await runAllStories();
for (const story of selected) {
  const expectations: Record<string, ScenarioSummary> = {};
  for (const [name, { summary }] of Object.entries(runs[story.key])) {
    expectations[name] = summary;
  }
  const text = `${formatJson(expectations)}\n`;
  if (print) {
    console.log(`// ${story.folder}/expect.json\n${text}`);
  } else {
    const file = path.join(root, story.folder, "expect.json");
    writeFileSync(file, text);
    written.push(file);
    console.log(
      `${story.folder}/expect.json: ${Object.keys(expectations).length} scenarios`,
    );
  }
}
const coverage = renderCoverage(computeCoverage(runs));
if (!print) {
  const file = path.join(root, "COVERAGE.md");
  writeFileSync(file, coverage);
  written.push(file);
  // The repo formats what it writes; do it here so a rerun changes nothing.
  execFileSync("pnpm", ["exec", "oxfmt", ...written], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: "ignore",
  });
  console.log("COVERAGE.md written");
}
