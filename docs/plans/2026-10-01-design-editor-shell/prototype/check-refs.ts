// Checks that every code reference in ../requirements.json and ../README.md
// still points at a real file (and, with :line, a line that exists).
// Exit 0: all found. Exit 1: some missing. Exit 2: could not run (no git).
// Run: node docs/plans/2026-10-01-design-editor-shell/prototype/check-refs.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

let tracked: string[];
try {
  tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
} catch (error) {
  console.error(`check-refs could not list files: ${(error as Error).message}`);
  process.exit(2);
}

// A ref is a file name with a code extension, optionally with :line or :start-end.
// It must start with a word character (so `.spec.ts` globs don't count) and end at
// the extension (so `com.agent-native.cssVar` doesn't read as a .css file).
const REF =
  /(?<![\w.*/-])(\w[\w@.-]*(?:\/[\w@.[\]$-]+)*\.(?:tsx|ts|css|mjs|md))(?![\w-])(?::(\d+)(?:-\d+)?)?/g;
// The plan's scope, used to settle a bare file name that exists in several places.
const SCOPE = "templates/design/";

const sources = [
  ["requirements.json", readFileSync(join(here, "../requirements.json"), "utf8")],
  ["README.md", readFileSync(join(here, "../README.md"), "utf8")],
] as const;

const missing: string[] = [];
const ambiguous: string[] = [];
let found = 0;

for (const [source, text] of sources) {
  for (const match of text.matchAll(REF)) {
    const [ref, path, line] = match;
    const all = path.includes("/")
      ? tracked.filter((file) => file === path || file.endsWith(`/${path}`))
      : tracked.filter((file) => file.split("/").pop() === path);
    const scoped = all.filter((file) => file.startsWith(SCOPE));
    const matches = all.length > 1 && scoped.length > 0 ? scoped : all;
    if (matches.length === 0) {
      missing.push(`${source}: ${ref} (no such file)`);
      continue;
    }
    if (matches.length > 1 && !line) {
      ambiguous.push(`${source}: ${ref} (${matches.length} files)`);
      continue;
    }
    if (line) {
      const lineCount = (file: string) =>
        readFileSync(join(repoRoot, file), "utf8").split("\n").length;
      if (!matches.some((file) => lineCount(file) >= Number(line))) {
        missing.push(`${source}: ${ref} (file is shorter than line ${line})`);
        continue;
      }
    }
    found += 1;
  }
}

console.log(`${found} references found.`);
if (ambiguous.length) {
  console.log(`${ambiguous.length} match more than one file, so they were not checked:`);
  for (const entry of ambiguous) console.log(`  ${entry}`);
}
if (missing.length) {
  console.error(`${missing.length} references are missing:`);
  for (const entry of missing) console.error(`  ${entry}`);
  process.exit(1);
}
