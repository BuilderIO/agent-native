import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGED_TEMPLATE_EXCLUDE } from "../packages/core/src/cli/template-layer.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const sourceRoot = join(rootDir, "templates", "chat");
const targetRoot = join(
  rootDir,
  "packages",
  "core",
  "src",
  "templates",
  "chat",
);

if (process.argv.includes("--clean")) {
  // The chat starter's skills are committed under targetRoot and kept current
  // by sync-workspace-core-skills.ts, so remove only what git doesn't track.
  execFileSync("git", ["clean", "-fdxq", "--", targetRoot], { cwd: rootDir });
  process.exit(0);
}

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--", "templates/chat"],
  { cwd: rootDir },
)
  .toString()
  .split("\0")
  .filter(Boolean);

if (trackedFiles.length === 0) {
  throw new Error(`No tracked files found under ${sourceRoot}.`);
}

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });

for (const trackedPath of trackedFiles) {
  const relativePath = relative("templates/chat", trackedPath);
  if (PACKAGED_TEMPLATE_EXCLUDE.test(relativePath)) continue;
  const sourcePath = join(rootDir, trackedPath);
  const targetPath = join(targetRoot, relativePath);
  const stat = lstatSync(sourcePath);

  mkdirSync(dirname(targetPath), { recursive: true });
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(sourcePath), targetPath);
    continue;
  }

  writeFileSync(targetPath, readFileSync(sourcePath));
}
