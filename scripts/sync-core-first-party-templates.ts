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
  rmSync(targetRoot, { recursive: true, force: true });
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
  if (/\.(?:spec|test)\.(?:ts|tsx)$/.test(relativePath)) continue;
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
