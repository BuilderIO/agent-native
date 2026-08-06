#!/usr/bin/env node
/**
 * guard-stale-branch-revert.mjs
 *
 * Many agents share this checkout and open PRs against a `main` that moves
 * roughly twenty times a day. A branch cut on Monday still holds Monday's copy
 * of every file it touches. When an agent regenerates one of those files
 * wholesale — a rewrite rather than an edit — the branch's copy no longer just
 * *lacks* what landed on main in the meantime, it actively replaces it. Git
 * can merge that cleanly, so no conflict appears and the merge button stays
 * green. The work is gone, silently, and the only person who notices is
 * whoever asks weeks later why a feature they remember shipping is missing.
 *
 * That is not hypothetical: "there was a lot of work in that thread that is
 * wrong now. how did a simple header update revert so much??" — the answer was
 * a later branch overwriting an earlier merged one, with no conflict and no
 * review signal. Reconstructing it afterwards took an incident investigation.
 *
 * `scripts/hooks/file-lease.mjs` already covers the live case, where a peer
 * session holds a file right now. This covers the other half: work that is
 * already merged and can no longer defend itself.
 *
 * How it decides. Rather than guess from line numbers, it performs the actual
 * merge in memory (`git merge-tree --write-tree`) and compares the result
 * against `main`. A line is reported when both of these hold:
 *   1. merging this branch removes it from `main`, and
 *   2. it landed on `main` after this branch's merge-base — so nobody working
 *      on this branch ever saw it.
 * Deleting code you can see is ordinary work. Deleting code you were never
 * shown is the failure this exists to catch.
 *
 * Note the shape of it — a branch current with `main` has nothing in "landed
 * since the merge-base", so this guard is silent for anyone who keeps their
 * branch fresh. A branch that already conflicts is also silent: git is
 * refusing to merge it, which is loud enough on its own.
 *
 * Ignored, because these recur across unrelated files constantly and would
 * bury the real signal: lines under 12 characters, pure punctuation, imports
 * and exports, and comment lines. Only .ts/.tsx/.css sources under templates/,
 * packages/, apps/ and scripts/ are considered; generated output, snapshots
 * and dist trees are not.
 *
 * Scope note: this reads HEAD, not the working tree — HEAD is what a merge
 * would actually take. Commit before trusting a clean result.
 *
 * Opt-out, when the removal is the actual point (reverting a bad merge,
 * deleting a feature on purpose) — put in the commit message body:
 *
 *   guard:allow-stale-revert — short reason
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved we say so loudly and exit 0, because a silent pass
 * here would look identical to a real clean run.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDiffBase } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA = /guard:allow-stale-revert\b/;

/** Files whose content is authored and reviewed, so a silent removal matters. */
const CONSIDERED = /\.(ts|tsx|css)$/;
const CONSIDERED_ROOTS = ["templates/", "packages/", "apps/", "scripts/"];
const SKIPPED = /(^|\/)(dist|build|node_modules|\.generated|__snapshots__)\//;

/** A file needs this many removed lines before it is worth interrupting for. */
const MIN_LINES_PER_FILE = 3;

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function isConsidered(file) {
  if (!CONSIDERED.test(file)) return false;
  if (SKIPPED.test(file)) return false;
  return CONSIDERED_ROOTS.some((root) => file.startsWith(root));
}

/**
 * Lines carrying enough meaning that seeing the same one on both sides is
 * evidence rather than coincidence. `}` and `import x from "y"` are not.
 */
function isMeaningful(line) {
  const trimmed = line.trim();
  if (trimmed.length < 12) return false;
  if (/^[\s{}()[\];,.:?<>/*+-]*$/.test(trimmed)) return false;
  if (/^(import|export|\/\/|\/\*|\*|#)/.test(trimmed)) return false;
  return true;
}

/**
 * Meaningful lines on one side of a diff, as `file -> Set<content>`.
 * `sign` is "+" for lines the range adds, "-" for lines it removes.
 */
function collect(range, sign) {
  const diff = git(["diff", "--unified=0", "--no-color", ...range]);
  if (diff === null) return null;

  const byFile = new Map();
  let file = null;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      file = target === "/dev/null" ? null : target.replace(/^b\//, "");
      if (file && !isConsidered(file)) file = null;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith(sign) && !raw.startsWith(sign.repeat(2))) {
      const content = raw.slice(1);
      if (!isMeaningful(content)) continue;
      if (!byFile.has(file)) byFile.set(file, new Set());
      byFile.get(file).add(content.trim());
    }
  }
  return byFile;
}

/** The merged commit that introduced a given line, for the report. */
function blameLanding(range, file, content) {
  const log = git(["log", "--format=%h %s", "-S", content, range, "--", file]);
  const first = (log || "").split("\n").find(Boolean);
  return first ? first.slice(0, 76) : null;
}

const base = resolveDiffBase(REPO_ROOT);
if (!base) {
  console.error(
    "guard-stale-branch-revert: cannot resolve a diff base (no origin/main or main).",
  );
  console.error(
    "  This is NOT a clean result — nothing was checked. Fetch main and re-run.",
  );
  process.exit(0);
}

const mergeBaseRaw = git(["merge-base", base, "HEAD"]);
if (mergeBaseRaw === null) {
  console.error(
    `guard-stale-branch-revert: cannot compute merge-base against ${base}.`,
  );
  console.error("  This is NOT a clean result — nothing was checked.");
  process.exit(0);
}
const mergeBase = mergeBaseRaw.trim();

const commitBody = git(["log", `${mergeBase}..HEAD`, "--format=%B"]) || "";
if (PRAGMA.test(commitBody)) {
  console.log("guard-stale-branch-revert: OK (opt-out pragma in commit body)");
  process.exit(0);
}

// Lines main gained while this branch was away — the ones nobody here has seen.
const landedOnMain = collect([mergeBase, base], "+");
if (landedOnMain === null) {
  console.error("guard-stale-branch-revert: git diff failed.");
  console.error("  This is NOT a clean result — nothing was checked.");
  process.exit(0);
}
if (landedOnMain.size === 0) {
  console.log("guard-stale-branch-revert: OK (branch is current with main)");
  process.exit(0);
}

// Perform the real merge in memory. A conflict here is the safe case: git is
// already refusing to merge silently, which is the whole failure mode we fear.
const mergedTree = git(["merge-tree", "--write-tree", base, "HEAD"]);
if (mergedTree === null) {
  console.log(
    "guard-stale-branch-revert: OK (branch conflicts with main — git will require a manual resolve)",
  );
  process.exit(0);
}

const removedByMerge = collect([base, mergedTree.trim()], "-");
if (removedByMerge === null) {
  console.error("guard-stale-branch-revert: could not diff the merged tree.");
  console.error("  This is NOT a clean result — nothing was checked.");
  process.exit(0);
}

const findings = [];
for (const [file, removed] of removedByMerge) {
  const landed = landedOnMain.get(file);
  if (!landed) continue;
  const overlap = [...removed].filter((line) => landed.has(line));
  if (overlap.length >= MIN_LINES_PER_FILE) findings.push({ file, overlap });
}

if (findings.length === 0) {
  console.log("guard-stale-branch-revert: OK");
  process.exit(0);
}

findings.sort((a, b) => b.overlap.length - a.overlap.length);

const total = findings.reduce((sum, f) => sum + f.overlap.length, 0);
console.error(
  `guard-stale-branch-revert: merging this branch removes ${total} line(s) that landed on ${base} after it was cut, across ${findings.length} file(s).`,
);
console.error(
  "\nThese lines are on main today and would be gone after this merge, with no conflict to warn anyone.",
);
console.error(
  "Almost always this means the branch is stale and a file was regenerated from an older copy.\n",
);

for (const { file, overlap } of findings) {
  console.error(`  ${file} — ${overlap.length} line(s)`);
  const landing = blameLanding(`${mergeBase}..${base}`, file, overlap[0]);
  if (landing) console.error(`    landed on main in: ${landing}`);
  for (const line of overlap.slice(0, 3)) {
    console.error(`    - ${line.slice(0, 100)}`);
  }
  if (overlap.length > 3) {
    console.error(`    ... and ${overlap.length - 3} more`);
  }
}

console.error(
  "\nFix: bring the branch up to date, then re-apply your change on top —\n" +
    "  git fetch origin && git merge origin/main\n" +
    "and re-read the merged result before committing. Do not resolve by taking your side wholesale.\n",
);
console.error(
  "If the removal is deliberate, say so in the commit body:\n" +
    "  guard:allow-stale-revert — short reason\n",
);

process.exit(1);
