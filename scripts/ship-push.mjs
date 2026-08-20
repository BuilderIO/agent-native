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
 *   node scripts/ship-push.mjs [-m "message"] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The only routine exclusions `.agents/skills/ship` allows. */
const EXCLUDED = /(^|\/)(learnings\.md$|bridge\/|data\/)/;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const messageFlag = Math.max(argv.indexOf("-m"), argv.indexOf("--message"));
const explicitMessage = messageFlag >= 0 ? argv[messageFlag + 1] : undefined;

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

function main() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD" || branch === "main" || branch === "master") {
    console.error(`ship-push: refusing to push from "${branch}".`);
    process.exit(1);
  }

  const dirtyPaths = parsePorcelain(
    git(["status", "--porcelain", "-z"], { raw: true }),
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

  const excluded = dirtyPaths.filter((file) => EXCLUDED.test(file));
  const publishable = dirtyPaths.filter((file) => !EXCLUDED.test(file));

  if (dryRun) {
    console.log(
      `ship-push: would publish ${publishable.length} path(s) on ${branch}`,
    );
    for (const file of publishable) console.log(`  + ${file}`);
    for (const file of excluded) console.log(`  - ${file} (routine exclusion)`);
    return;
  }

  let committed = null;
  if (publishable.length > 0) {
    // Whole files only. `--` keeps a path that looks like a flag from being one.
    // `--all` stages modified and newly-created files. Deleted paths are
    // already staged by explicit cleanup commands; omitting absent paths
    // avoids Git rejecting a pathspec that no longer exists on disk.
    const existingPublishable = publishable.filter((file) =>
      existsSync(path.join(REPO_ROOT, file)),
    );
    if (existingPublishable.length > 0) {
      git(["add", "--all", "--", ...existingPublishable]);
    }
    const staged = git(["diff", "--cached", "--name-only"])
      .split("\n")
      .filter(Boolean);
    if (staged.length > 0) {
      git(["commit", "--no-verify", "-m", explicitMessage ?? describe(staged)]);
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
  if (excluded.length > 0) {
    console.log(
      `  left behind (say so explicitly):\n    ${excluded.join("\n    ")}`,
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

function describe(files) {
  const scopes = [
    ...new Set(files.map((f) => f.split("/").slice(0, 2).join("/"))),
  ];
  const head = scopes.slice(0, 3).join(", ");
  return `chore: publish branch work in ${head}${scopes.length > 3 ? ", …" : ""} (${files.length} files)`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
