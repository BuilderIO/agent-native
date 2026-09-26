#!/usr/bin/env node
/**
 * ship-push.mjs — publish every non-ignored local change on the current branch.
 *
 * This exists because the rule did not survive as prose. `.agents/skills/ship`
 * states it three separate times and `babysit-pr` a fourth, and the worktree
 * still sat unpushed until the user escalated to all caps. A remembered
 * six-command procedure decays under load; one command does not.
 *
 * It never creates, switches, or resets a branch, and never stages a partial
 * hunk. It reads the push result back from git instead of assuming it worked,
 * so "pushed" is a claim backed by a sha the command produced.
 *
 *   node scripts/ship-push.mjs [-m "meaningful commit subject"] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The only routine exclusions `.agents/skills/ship` allows. */
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

/**
 * Run git and let a failure be a failure — no `catch { return "" }` here.
 * `raw` skips the trim: porcelain output starts with a status column that can
 * be a space, and trimming it silently truncates the first path by one char.
 */
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

/**
 * Which dirty paths may be handed to `git add`.
 *
 * A deleted-but-tracked path MUST be included: `git add --all -- <path>` is
 * how its removal gets staged. Filtering to paths present on disk is what
 * silently dropped deletions and let a rename ship as an add. A path that is
 * neither on disk nor tracked is skipped, because that pathspec aborts the
 * whole `add` and would take the good paths down with it.
 */
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
  // null = the remote branch does not exist yet, which also needs a push.
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
    // Whole files only. `--` keeps a path that looks like a flag from being one.
    // `--all` stages modifications, additions AND deletions for the paths it
    // is given. This used to filter to paths still present on disk, on the
    // assumption that deletions were "already staged by explicit cleanup
    // commands" — false for an ordinary `rm`, so every deletion was silently
    // dropped and a rename shipped as an add with the old file still tracked.
    // A helper whose contract is "publish the complete snapshot" must not
    // quietly publish part of it. A path absent from disk is still stageable
    // when Git tracks it; only a path that is neither is skipped, because
    // that pathspec would abort the whole `add`.
    // -z for the same reason `git status` is read with -z: without it Git
    // C-quotes any path with non-ASCII or special characters, which would not
    // match the raw path from the porcelain read and would silently drop that
    // deletion — the exact failure this block was just fixed for.
    const tracked = new Set(
      git(["ls-files", "-z"], { raw: true }).split("\0").filter(Boolean),
    );
    const stageable = selectStageablePaths(publishable, {
      exists: (file) => existsSync(path.join(REPO_ROOT, file)),
      isTracked: (file) => tracked.has(file),
    });
    if (stageable.length > 0) {
      // Tracked generated files may still match a parent ignore rule. These
      // exact pathspecs came from Git's dirty-path list, so force-add is scoped.
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

/**
 * Paths from `git status --porcelain -z`. Rename/copy entries emit the new
 * path and then the old path as a second NUL field; consuming the old path as
 * if it were a status entry produces a path that no longer exists, and the
 * `git add` that follows would fail on it.
 */
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
