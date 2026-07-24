/**
 * Baseline store for `agent-native template`.
 *
 * A baseline is the pristine upstream tree an app was generated from — the
 * "base" side of the 3-way merge. It is stored as a git ref under
 * `refs/agent-native/template-baseline/<app-path>` so it never shows up as
 * working-tree files, and as a gzipped tar under `.agent-native/` only when
 * the app is not inside a git repository at all.
 *
 * Every git operation here is plumbing driven by a throwaway `GIT_INDEX_FILE`
 * and an out-of-tree `--work-tree`. Nothing in this file may move HEAD, touch
 * the user's index, or write into their working tree.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type BaselineSlot = "baseline" | "pending";

export interface BaselineStore {
  appDir: string;
  /** Absolute `.git` directory, or null when the app is not in a repo. */
  gitDir: string | null;
  /** Repo-relative posix prefix the app lives at ("" when app === repo root). */
  prefix: string;
  /** Stable id used in ref names and tarball filenames. */
  slug: string;
}

export interface BaselineWriteMeta {
  template: string;
  templateRef: string;
  coreVersion?: string;
}

export interface BaselineWriteResult {
  kind: "git-ref" | "tarball";
  /** Ref name or tarball path. */
  location: string;
  /** Commit sha for git refs. */
  commit?: string;
  configuredRefspecs: string[];
}

const REF_NAMESPACE = "refs/agent-native";
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "agent-native",
  GIT_AUTHOR_EMAIL: "noreply@agent-native.com",
  GIT_COMMITTER_NAME: "agent-native",
  GIT_COMMITTER_EMAIL: "noreply@agent-native.com",
};

export function resolveBaselineStore(appDir: string): BaselineStore {
  // git reports realpaths; comparing against a symlinked temp path (macOS
  // /var → /private/var) would compute a nonsense repo-relative prefix.
  const resolved = realpath(path.resolve(appDir));
  const gitDir = findGitDir(resolved);
  const repoRoot = gitDir ? findRepoRoot(resolved) : null;
  const prefix =
    repoRoot && repoRoot !== resolved
      ? path.relative(repoRoot, resolved).split(path.sep).join("/")
      : "";
  return {
    appDir: resolved,
    gitDir,
    prefix,
    slug: sanitizeRefPath(prefix || path.basename(resolved)),
  };
}

export function baselineRefName(
  store: BaselineStore,
  slot: BaselineSlot,
): string {
  return `${REF_NAMESPACE}/template-${slot}/${store.slug}`;
}

export function baselineTarballPath(
  store: BaselineStore,
  slot: BaselineSlot,
): string {
  return path.join(
    store.appDir,
    ".agent-native",
    `template-${slot}`,
    `${path.basename(store.appDir)}.tar.gz`,
  );
}

export function baselineExists(
  store: BaselineStore,
  slot: BaselineSlot,
): boolean {
  if (store.gitDir) return revParse(store, baselineRefName(store, slot)) !== null;
  return fs.existsSync(baselineTarballPath(store, slot));
}

export function baselineDescription(
  store: BaselineStore,
  slot: BaselineSlot,
): string | null {
  if (!store.gitDir) {
    const file = baselineTarballPath(store, slot);
    return fs.existsSync(file) ? file : null;
  }
  const ref = baselineRefName(store, slot);
  const commit = revParse(store, ref);
  if (!commit) return null;
  const subject = git(store, ["log", "-1", "--format=%s", commit]).trim();
  return `${ref} (${commit.slice(0, 12)}) ${subject}`;
}

/**
 * Snapshot `sourceDir` into the baseline store. Writes through a temporary
 * index and an out-of-tree work-tree so HEAD, the real index, and the working
 * tree are untouched.
 */
export function writeBaseline(
  store: BaselineStore,
  sourceDir: string,
  slot: BaselineSlot,
  meta: BaselineWriteMeta,
): BaselineWriteResult {
  if (!store.gitDir) {
    const file = baselineTarballPath(store, slot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    execFileSync("tar", ["-czf", file, "-C", sourceDir, "."], { stdio: "pipe" });
    return { kind: "tarball", location: file, configuredRefspecs: [] };
  }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "an-template-baseline-"));
  try {
    const stageRoot = path.join(stage, "tree");
    const target = store.prefix
      ? path.join(stageRoot, ...store.prefix.split("/"))
      : stageRoot;
    fs.mkdirSync(target, { recursive: true });
    copyPlainTree(sourceDir, target);

    const indexFile = path.join(stage, "index");
    const env = { ...process.env, ...GIT_IDENTITY, GIT_INDEX_FILE: indexFile };
    // --force: the app's own .gitignore lives inside the staged tree and would
    // otherwise drop scaffolded files from the baseline.
    git(store, ["--work-tree", stageRoot, "add", "-A", "--force", "."], {
      cwd: stageRoot,
      env,
    });
    const tree = git(store, ["write-tree"], { cwd: stageRoot, env }).trim();

    const ref = baselineRefName(store, slot);
    const parent = revParse(store, ref);
    const message = [
      `agent-native template ${slot}: ${meta.template}`,
      "",
      `template: ${meta.template}`,
      `templateRef: ${meta.templateRef}`,
      `coreVersion: ${meta.coreVersion ?? "unknown"}`,
      `path: ${store.prefix || "."}`,
    ].join("\n");
    const commit = git(
      store,
      [
        "commit-tree",
        tree,
        ...(parent ? ["-p", parent] : []),
        "-m",
        message,
      ],
      { cwd: stageRoot, env },
    ).trim();

    git(store, ["update-ref", ref, commit, ...(parent ? [parent] : [])]);
    return {
      kind: "git-ref",
      location: ref,
      commit,
      configuredRefspecs: parent ? [] : ensureBaselineRefspecs(store),
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Point `slot` at whatever `from` currently points at. */
export function promoteBaseline(
  store: BaselineStore,
  from: BaselineSlot,
  to: BaselineSlot,
): boolean {
  if (!store.gitDir) {
    const src = baselineTarballPath(store, from);
    if (!fs.existsSync(src)) return false;
    const dst = baselineTarballPath(store, to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    fs.rmSync(src, { force: true });
    return true;
  }
  const commit = revParse(store, baselineRefName(store, from));
  if (!commit) return false;
  git(store, ["update-ref", baselineRefName(store, to), commit]);
  git(store, ["update-ref", "-d", baselineRefName(store, from)]);
  return true;
}

export function clearBaseline(store: BaselineStore, slot: BaselineSlot): void {
  if (!store.gitDir) {
    fs.rmSync(baselineTarballPath(store, slot), { force: true });
    return;
  }
  if (revParse(store, baselineRefName(store, slot))) {
    git(store, ["update-ref", "-d", baselineRefName(store, slot)]);
  }
}

/**
 * Extract a stored baseline into a fresh temp directory whose root is the app
 * root. Returns null when the slot is empty. Callers own the returned dir.
 */
export function materializeBaseline(
  store: BaselineStore,
  slot: BaselineSlot,
): string | null {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "an-template-base-"));
  try {
    if (!store.gitDir) {
      const file = baselineTarballPath(store, slot);
      if (!fs.existsSync(file)) {
        fs.rmSync(out, { recursive: true, force: true });
        return null;
      }
      execFileSync("tar", ["-xzf", file, "-C", out], { stdio: "pipe" });
      return out;
    }

    const ref = baselineRefName(store, slot);
    if (!revParse(store, ref)) {
      fs.rmSync(out, { recursive: true, force: true });
      return null;
    }
    const tarPath = path.join(out, ".baseline.tar");
    const args = ["archive", "--format=tar", "-o", tarPath, ref];
    if (store.prefix) args.push("--", store.prefix);
    git(store, args);
    const strip = store.prefix ? store.prefix.split("/").length : 0;
    execFileSync(
      "tar",
      ["-xf", tarPath, "-C", out, ...(strip ? [`--strip-components=${strip}`] : [])],
      { stdio: "pipe" },
    );
    fs.rmSync(tarPath, { force: true });
    return out;
  } catch (err) {
    fs.rmSync(out, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Teach the repo's remote to carry `refs/agent-native/*` so baselines survive
 * clone and push. Returns the refspecs it actually added.
 */
export function ensureBaselineRefspecs(store: BaselineStore): string[] {
  if (!store.gitDir) return [];
  const remotes = git(store, ["remote"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (remotes.length === 0) return [];
  const remote = remotes.includes("origin") ? "origin" : remotes[0]!;
  const spec = "+refs/agent-native/*:refs/agent-native/*";
  const added: string[] = [];
  for (const key of ["fetch", "push"] as const) {
    const existing = gitAllowFail(store, [
      "config",
      "--get-all",
      `remote.${remote}.${key}`,
    ]);
    if (existing.split("\n").some((line) => line.trim() === spec)) continue;
    git(store, ["config", "--add", `remote.${remote}.${key}`, spec]);
    added.push(`remote.${remote}.${key}`);
  }
  return added;
}

/** Uncommitted changes under the app dir, as porcelain lines. */
export function appDirtyPaths(store: BaselineStore): string[] {
  if (!store.gitDir) return [];
  const out = gitAllowFail(store, [
    "status",
    "--porcelain",
    "--",
    store.prefix || ".",
  ]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Internals
 * ───────────────────────────────────────────────────────────────────────── */

function git(
  store: BaselineStore,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  return execFileSync("git", ["--git-dir", store.gitDir!, ...args], {
    cwd: options.cwd ?? store.appDir,
    encoding: "utf-8",
    env: options.env ?? { ...process.env, ...GIT_IDENTITY },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function gitAllowFail(store: BaselineStore, args: string[]): string {
  try {
    return git(store, args);
  } catch {
    return "";
  }
}

function revParse(store: BaselineStore, ref: string): string | null {
  if (!store.gitDir) return null;
  const out = gitAllowFail(store, ["rev-parse", "--verify", "--quiet", ref]);
  return out.trim() || null;
}

function realpath(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function findGitDir(dir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function findRepoRoot(dir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Copy regular files and directories only. Symlinks are never part of a
 *  baseline: they are agent-tool conveniences, not upstream content. */
function copyPlainTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      copyPlainTree(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/** Make each path segment safe for `git check-ref-format`. */
export function sanitizeRefPath(value: string): string {
  const segments = value
    .split("/")
    .map((segment) => sanitizeRefSegment(segment))
    .filter(Boolean);
  return segments.length > 0 ? segments.join("/") : "app";
}

function sanitizeRefSegment(segment: string): string {
  let out = segment
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020\u007f~^:?*\[\\]/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/@\{/g, "-");
  while (out.startsWith(".")) out = out.slice(1);
  while (out.endsWith(".")) out = out.slice(0, -1);
  if (out.endsWith(".lock")) out = `${out.slice(0, -".lock".length)}-lock`;
  return out;
}
