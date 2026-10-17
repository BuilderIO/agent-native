#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const EXCLUDED = /(^|\/)learnings\.md$|^(bridge|data)\//;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const messageFlag = Math.max(argv.indexOf("-m"), argv.indexOf("--message"));
const explicitMessage = messageFlag >= 0 ? argv[messageFlag + 1] : undefined;
export const MIN_FREE_DISK_BYTES = 500 * 1024 * 1024;

export function freeDiskBytes(root) {
  const stats = statfsSync(root);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function assertFreeDisk(
  root = REPO_ROOT,
  minimumBytes = MIN_FREE_DISK_BYTES,
) {
  let freeBytes;
  try {
    freeBytes = freeDiskBytes(root);
  } catch (error) {
    throw new Error(
      `could not read free disk space for ${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Number.isFinite(freeBytes) || freeBytes < minimumBytes) {
    throw new Error(
      `only ${Math.round(freeBytes / 1024 / 1024)} MiB free on ${root}; need at least ${Math.round(minimumBytes / 1024 / 1024)} MiB before publishing`,
    );
  }
  return freeBytes;
}

function git(args, { allowFailure = false, raw = false } = {}) {
  try {
    const out = execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", allowFailure ? "ignore" : "pipe"],
    });
    return raw ? out : out.trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error.stderr?.toString().trim() || error.message;
    console.error(`ship-push: git ${args.join(" ")} failed:\n${detail}`);
    process.exit(1);
  }
}

export function selectStageablePaths(paths, { exists, isTracked }) {
  return paths.filter((file) => exists(file) || isTracked(file));
}

export function isExcludedPath(file) {
  return EXCLUDED.test(file);
}

export function isSpecificCommitMessage(message) {
  const subject = message?.split(/\r?\n/, 1)[0].trim();
  if (
    !subject ||
    subject.startsWith("-") ||
    /^chore:\s*publish branch work\b/i.test(subject)
  ) {
    return false;
  }

  const description = subject
    .replace(/^[a-z]+(?:\([^)]*\))?:\s*/i, "")
    .replace(/^(?:fix|update)\s+/i, "")
    .trim();
  return /\S+\s+\S+/.test(description);
}

function main() {
  try {
    assertFreeDisk();
  } catch (error) {
    console.error(
      `ship-push: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD" || branch === "main" || branch === "master") {
    console.error(`ship-push: refusing to push from "${branch}".`);
    process.exit(1);
  }

  const dirtyPaths = parsePorcelain(
    git(["status", "--porcelain", "-z", "--untracked-files=all"], {
      raw: true,
    }),
  );
  const unpushed = git(["log", "--oneline", `origin/${branch}..HEAD`], {
    allowFailure: true,
  });
  const behindRemote = unpushed === null || unpushed !== "";

  if (dirtyPaths.length === 0 && !behindRemote) {
    console.log(`ship-push: ${branch} is clean and already pushed.`);
    return;
  }

  const excluded = dirtyPaths.filter(isExcludedPath);
  const publishable = dirtyPaths.filter((file) => !isExcludedPath(file));

  if (dryRun) {
    console.log(
      `ship-push: would publish ${publishable.length} path(s) on ${branch}`,
    );
    for (const file of publishable) console.log(`  + ${file}`);
    for (const file of excluded) console.log(`  - ${file} (routine exclusion)`);
    return;
  }

  const message = explicitMessage?.trim();
  if (publishable.length > 0 && !isSpecificCommitMessage(message)) {
    console.error(
      "ship-push: pass -m with a specific commit subject that describes the change.",
    );
    process.exit(1);
  }

  let committed = null;
  if (publishable.length > 0) {
    const tracked = new Set(
      git(["ls-files", "-z"], { raw: true }).split("\0").filter(Boolean),
    );
    const stageable = selectStageablePaths(publishable, {
      exists: (file) => existsSync(path.join(REPO_ROOT, file)),
      isTracked: (file) => tracked.has(file),
    });
    if (stageable.length > 0) {
      git(["add", "--all", "-f", "--", ...stageable]);
    }
    const staged = git(["diff", "--cached", "--name-only"])
      .split("\n")
      .filter(Boolean);
    if (staged.length > 0) {
      git(["commit", "--no-verify", "-m", message]);
      committed = git(["rev-parse", "--short", "HEAD"]);
    }
  }

  git(["push", "--set-upstream", "origin", branch]);
  const remoteSha = git(["rev-parse", "--short", `origin/${branch}`]);
  const localSha = git(["rev-parse", "--short", "HEAD"]);
  if (remoteSha !== localSha) {
    console.error(
      `ship-push: push exited 0 but origin/${branch} is at ${remoteSha}, not ${localSha}.`,
    );
    process.exit(1);
  }

  console.log(`ship-push: branch ${branch}`);
  if (committed) console.log(`  committed ${committed}`);
  console.log(`  pushed    origin/${branch}@${remoteSha}`);
  const remainingExcluded = parsePorcelain(
    git(["status", "--porcelain", "-z", "--untracked-files=all"], {
      raw: true,
    }),
  ).filter(isExcludedPath);
  if (remainingExcluded.length > 0) {
    console.log(
      `  left behind (say so explicitly):\n    ${remainingExcluded.join("\n    ")}`,
    );
  }
}

export function parsePorcelain(output) {
  const fields = output.split("\0");
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (/^[RC]/.test(entry)) index += 1;
  }
  return paths;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
