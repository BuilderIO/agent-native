import { execFileSync } from "node:child_process";
import path from "node:path";

const DIFF_BASE_ENV = ["GUARD_DIFF_BASE", "GITHUB_BASE_REF"];

export const GUARD_EXIT_COULD_NOT_RUN = 2;

// Git quotes a path that holds a quote, backslash or control character, so it
// names no file we can key on. The parsers turn this into null, which the
// callers already treat as could-not-run.
class QuotedDiffPathError extends Error {}

export function execGuardCommand(command, args, options = {}) {
  try {
    return execFileSync(command, args, options);
  } catch {
    console.error(`guard command could not run: ${command} ${args.join(" ")}`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
}

export function resolveDiffBase(cwd) {
  for (const name of DIFF_BASE_ENV) {
    const value = process.env[name];
    if (value) return value.startsWith("origin/") ? value : `origin/${value}`;
  }
  for (const candidate of ["origin/main", "main"]) {
    if (git(["rev-parse", "--verify", "--quiet", candidate], cwd) !== null) {
      return candidate;
    }
  }
  return null;
}

/**
 * The commit every diff here is taken against: the merge-base of the resolved
 * base and HEAD. Pre-change file text must be read at this commit, not at the
 * base tip, or commits that landed on main after the branch point count too.
 */
export function diffBaseCommit(cwd) {
  const base = resolveDiffBase(cwd);
  if (!base) return null;
  const mergeBase = git(["merge-base", base, "HEAD"], cwd);
  return mergeBase === null ? null : mergeBase.trim();
}

/**
 * A repo file's text at `commit`. The caller only asks for files its diff says
 * existed there, so a failed `git show` exits instead of reading as empty.
 */
export function readCommitFile(cwd, commit, repoPath) {
  return execGuardCommand("git", ["show", `${commit}:${repoPath}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function addedLines(cwd, { includeWorkingTree = true } = {}) {
  const mergeBase = diffBaseCommit(cwd);
  if (mergeBase === null) return null;

  const args = [
    "-c",
    "core.quotePath=false",
    "diff",
    "--unified=0",
    "--no-color",
    "--diff-filter=ACMR",
  ];
  if (!includeWorkingTree) args.push(mergeBase, "HEAD");
  else args.push(mergeBase);

  const diff = git(args, cwd);
  if (diff === null) return null;
  return parseUnifiedDiff(diff, cwd);
}

/**
 * Lines this branch removed, keyed by native absolute path like `addedLines`.
 * `path` is the post-change repo path (the pre-change path for a deleted file)
 * and `oldPath` the pre-change path, so a rename's removals and additions meet
 * under one key. Each removed line records the new-file line it sat before.
 * `created` marks a file new on this branch, so its pre-change text is empty.
 */
export function removedLines(cwd, { includeWorkingTree = true } = {}) {
  const mergeBase = diffBaseCommit(cwd);
  if (mergeBase === null) return null;

  const args = [
    "-c",
    "core.quotePath=false",
    "diff",
    "--unified=0",
    "--no-color",
  ];
  if (!includeWorkingTree) args.push(mergeBase, "HEAD");
  else args.push(mergeBase);

  const diff = git(args, cwd);
  if (diff === null) return null;
  return parseRemovedLines(diff, cwd);
}

export function parseRemovedLines(diff, cwd, pathApi = path) {
  return nullOnQuotedPath(() => scanRemovedLines(diff, cwd, pathApi));
}

function scanRemovedLines(diff, cwd, pathApi) {
  if (parseUnifiedDiff(diff, cwd, pathApi) === null) return null;
  const result = new Map();
  let entry = null;
  let oldPath = null;
  let removeLeft = 0;
  let addLeft = 0;
  let newLine = 0;
  for (const raw of diff.split("\n")) {
    // Hunk counts, not prefixes, say what is body: a removed line may itself
    // start with "--" and must not be read as a file header.
    if (removeLeft > 0 || addLeft > 0) {
      if (raw.startsWith("-")) {
        removeLeft -= 1;
        entry?.lines.push({ line: Math.max(newLine, 1), text: raw.slice(1) });
      } else if (raw.startsWith("+")) {
        addLeft -= 1;
        newLine += 1;
      }
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      entry = null;
      oldPath = null;
      continue;
    }
    if (raw.startsWith("--- ")) {
      oldPath = stripDiffPrefix(raw.slice(4));
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const newPath = stripDiffPrefix(raw.slice(4));
      const deleted = newPath === "/dev/null";
      const repoPath = deleted ? oldPath : newPath;
      const before = oldPath === "/dev/null" ? repoPath : oldPath;
      const created = oldPath === "/dev/null";
      entry = { path: repoPath, oldPath: before, deleted, created, lines: [] };
      result.set(pathApi.resolve(cwd, repoPath), entry);
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      removeLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLine = Number(hunk[2]);
      addLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return result;
}

function stripDiffPrefix(value) {
  return headerPath(value).replace(/^[ab]\//, "");
}

/**
 * The path in a `---` or `+++` header, untouched. A quoted one throws so the
 * caller refuses the whole diff: keying on the quoted text would match no file
 * and the guard would pass over it without reading it.
 */
function headerPath(value) {
  const name = value.trim();
  if (name.startsWith('"')) throw new QuotedDiffPathError(name);
  return name;
}

function nullOnQuotedPath(scan) {
  try {
    return scan();
  } catch (error) {
    if (error instanceof QuotedDiffPathError) return null;
    throw error;
  }
}

/**
 * `addedLines`, but a guard that cannot scope itself exits instead of
 * continuing. Every diff-scoped guard used to hand-roll this and every one of
 * them printed a paragraph saying "this is NOT a pass" and then exited 0 —
 * the exact coercion CLAUDE.md's flagship rule bans, in the scripts that
 * enforce it. The caller gets a Map or it gets nothing.
 */
export function requireAddedLines(cwd, guardName, options) {
  const added = addedLines(cwd, options);
  if (added !== null) return added;
  console.error(
    `${guardName}: could not determine which lines this branch added ` +
      "(no GUARD_DIFF_BASE/GITHUB_BASE_REF, no origin/main or main ref, " +
      "git diff failed, git reported a source file as binary, or git quoted " +
      "a changed path name), so the " +
      "check did not run.\n" +
      "  Fix with:  git fetch origin main   (or set GUARD_DIFF_BASE=<ref>)\n" +
      "  If a source file diffs as binary, it contains a NUL or other binary\n" +
      "  byte - find it with:  git diff --numstat   (look for '-' counts)",
  );
  process.exit(GUARD_EXIT_COULD_NOT_RUN);
}

const SOURCE_EXTENSIONS =
  /\.(?:tsx?|jsx?|mjs|cjs|mdx?|css|scss|json|ya?ml|html|sh)$/i;

export function parseUnifiedDiff(diff, cwd, pathApi = path) {
  return nullOnQuotedPath(() => scanUnifiedDiff(diff, cwd, pathApi));
}

function scanUnifiedDiff(diff, cwd, pathApi) {
  const result = new Map();
  let file = null;
  let line = 0;
  // Lines of the current hunk still owed by its header. Inside a hunk every
  // line is body, even one whose text starts with "+++" or "---" (an added
  // "++i;" or a removed "--y"); headers are only read once both counts are 0.
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("+")) {
        newLeft -= 1;
        if (file) {
          if (!result.has(file)) result.set(file, new Set());
          result.get(file).add(line);
        }
        line += 1;
      } else if (raw.startsWith("-")) {
        oldLeft -= 1;
      } else if (raw.startsWith(" ")) {
        oldLeft -= 1;
        newLeft -= 1;
        line += 1;
      }
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      file = null;
      continue;
    }
    // Git emits no +++/@@/+ lines for a file it considers binary, so such a
    // file contributes nothing here and every diff-scoped guard passes having
    // inspected none of it. A single stray NUL byte is enough to mark a .ts
    // file binary, which is indistinguishable from a clean check. Refuse to
    // scope rather than report a pass over a file we never read.
    const binary = /^Binary files (?:a\/)?(.+?) and (?:b\/)?(.+?) differ$/.exec(
      raw,
    );
    // A quoted name keeps its quotes, so its extension cannot be read here.
    if (binary && binary[1].startsWith('"')) {
      throw new QuotedDiffPathError(raw);
    }
    if (
      binary &&
      (SOURCE_EXTENSIONS.test(binary[1]) || SOURCE_EXTENSIONS.test(binary[2]))
    ) {
      return null;
    }
    if (raw.startsWith("--- ")) {
      headerPath(raw.slice(4));
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const target = headerPath(raw.slice(4));
      const path = target.replace(/^b\//, "");
      // Keys are native absolute paths so a guard can look one up with a
      // path.join/path.resolve result; a "/"-joined key never matches on Windows.
      // Prototypes are throwaway design artifacts, not shipped code, so the diff-scoped guards don't police them.
      file =
        target === "/dev/null" || path.startsWith("prototypes/")
          ? null
          : pathApi.resolve(cwd, path);
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      line = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return result;
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}
