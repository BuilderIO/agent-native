import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Per-app build cache for workspace deploys.
 *
 * An app's build is a pure function of its inputs, so an app whose inputs hash
 * to a key we have already built reuses that build's output instead of running
 * `pnpm --filter <app> build` again. The key is deliberately wide (see
 * `computeAppCacheKey`) because the failure that matters is a stale app being
 * shipped. Every cache problem is a typed miss that rebuilds; none is ever
 * reported as a hit.
 */

/** Bump when the key recipe or entry layout changes; it is part of every key. */
export const DEPLOY_CACHE_FORMAT_VERSION = 1;

/** Paths under an app dir that a build produces and the packaging step reads. */
export const APP_BUILD_OUTPUT_PATHS = [
  "dist",
  ".output",
  "build",
  path.join(".netlify", "functions-internal"),
  path.join(".vercel", "output"),
] as const;

const ENTRIES_KEPT_PER_APP = 3;

/**
 * Directories a build writes into the app before its output exists. They are
 * untracked and, in a workspace that does not ignore them, would change the
 * key of the very build that produced them.
 */
const BUILD_GENERATED_APP_DIRS = [
  ".agent-native",
  ".deploy-tmp",
  ".react-router",
];

/** Variables that differ between runs without ever reaching a build output. */
const VOLATILE_ENV_NAMES = new Set([
  "_",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "LINES",
  "COLUMNS",
  "COLORTERM",
  "INIT_CWD",
  "NODE",
  "SECURITYSESSIONID",
  "SSH_AUTH_SOCK",
  "SSH_CONNECTION",
  "SSH_CLIENT",
  "SSH_TTY",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "__CF_USER_TEXT_ENCODING",
  "AGENT_NATIVE_DEPLOY_CONCURRENCY",
]);
// Lowercase, compared case-insensitively.
const VOLATILE_ENV_PREFIXES = [
  "npm_",
  "pnpm_",
  "xpc_",
  "iterm_",
  "lc_",
  "vscode_",
  "claude",
  // GitHub Actions per-run state. GITHUB_CLIENT_* are build inputs and stay in the key.
  // RUNNER_OS and RUNNER_ARCH identify the platform that built the output and stay in the key.
  "runner_temp",
  "runner_tool",
  "runner_workspace",
  "runner_name",
  "runner_environment",
  "runner_debug",
  "actions_",
  "github_run_",
  "github_sha",
  "github_ref",
  "github_event",
  "github_action",
  "github_step",
  "github_job",
  "github_workflow",
  "github_actor",
  "github_triggering",
  "github_head_ref",
  "github_base_ref",
  "github_workspace",
  "github_env",
  "github_output",
  "github_path",
  "github_state",
  "github_server",
  "github_api",
  "github_graphql",
  "github_repository",
  "github_retention",
  // The cache's own switches must not change the key they select.
  "agent_native_deploy_cache",
];

export type CacheMissReason =
  /** Nothing was built for these inputs yet. */
  | "no-entry"
  /** The entry exists but its manifest could not be read or parsed. */
  | "entry-unreadable"
  /** Files were missing, extra, or did not match their recorded hashes. */
  | "restore-failed"
  /** The key could not be computed, so the app cannot be cache-checked. */
  | "hash-failed";

export type CacheLookup =
  | { hit: true; buildMs: number; restoreMs: number; treeHash: string }
  | { hit: false; reason: CacheMissReason; detail: string };

export interface DeployCacheRuntime {
  dir: string;
  workspaceRoot: string;
  preset: string;
  envIgnore: string[];
  /** Cached apps still to be rebuilt and compared against their entry. */
  verifyRemaining: number;
  stats: { hits: number; misses: number; savedMs: number; verified: number };
  /** Package hashes are shared by every app in one deploy. */
  packageHashes: Map<string, string>;
}

export function createDeployCacheRuntime(opts: {
  dir: string;
  workspaceRoot: string;
  preset: string;
  envIgnore: string[];
  verifySample: number;
}): DeployCacheRuntime {
  return {
    dir: opts.dir,
    workspaceRoot: opts.workspaceRoot,
    preset: opts.preset,
    envIgnore: opts.envIgnore,
    verifyRemaining: opts.verifySample,
    stats: { hits: 0, misses: 0, savedMs: 0, verified: 0 },
    packageHashes: new Map(),
  };
}

export function defaultDeployCacheDir(workspaceRoot: string): string {
  return path.join(
    workspaceRoot,
    "node_modules",
    ".cache",
    "agent-native",
    "deploy-build",
  );
}

export interface AppCacheKey {
  key: string;
  /** Per-component hashes, kept in the manifest to explain a later miss. */
  components: Record<string, string>;
}

function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashFileEntry(hash: crypto.Hash, rel: string, abs: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Tracked-but-deleted is a real input state: it must hash differently
      // from the file being present, and must not abort the key.
      hash.update(`${rel}\0missing\n`);
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    hash.update(`${rel}\0link\0${fs.readlinkSync(abs)}\n`);
    return;
  }
  if (!stat.isFile()) {
    hash.update(`${rel}\0other\n`);
    return;
  }
  const mode = stat.mode & 0o111 ? "x" : "-";
  hash.update(`${rel}\0${mode}\0${sha256(fs.readFileSync(abs))}\n`);
}

function gitListFiles(cwd: string, pathspecs: string[]): string[] {
  let out: Buffer;
  try {
    out = execFileSync(
      "git",
      ["ls-files", "-z", "-c", "-o", "--exclude-standard", "--", ...pathspecs],
      { cwd, maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(`git ls-files failed in ${cwd}: ${errorMessage(error)}`);
  }
  return [...new Set(out.toString("utf-8").split("\0").filter(Boolean))].sort();
}

function listEnvFiles(dir: string): string[] {
  // Gitignored, but Vite inlines VITE_* values from them at build time.
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.startsWith(".env"))
    .map((e) => e.name)
    .sort();
}

function hashAppSource(workspaceRoot: string, appDirInput: string): string {
  // An app dir that is a symlink into the workspace lists as one entry in git.
  const appDir = fs.realpathSync(appDirInput);
  const rootReal = fs.realpathSync(workspaceRoot);
  const appRel = path.relative(rootReal, appDir).split(path.sep).join("/");
  if (appRel.startsWith("..") || path.isAbsolute(appRel)) {
    throw new Error(`${appDir} is outside the workspace ${rootReal}`);
  }
  const outputRoots = new Set([
    ...APP_BUILD_OUTPUT_PATHS.map((p) => p.split(path.sep)[0]),
    ...BUILD_GENERATED_APP_DIRS,
  ]);
  const hash = crypto.createHash("sha256");
  const files = gitListFiles(rootReal, [appRel]).filter((file) => {
    const first = file.slice(appRel.length + 1).split("/")[0];
    return !outputRoots.has(first);
  });
  if (files.length === 0) {
    // Gitignored or untracked-and-ignored: an empty input set would match
    // every future build of this app.
    throw new Error(`git lists no source files under ${appRel}`);
  }
  for (const file of files) {
    hashFileEntry(hash, file, path.join(rootReal, file));
  }
  for (const name of listEnvFiles(appDir)) {
    hashFileEntry(hash, `${appRel}/${name}`, path.join(appDir, name));
  }
  return hash.digest("hex");
}

/** Files at the workspace root (lockfile, workspace config, root `.env*`). */
function hashWorkspaceRootFiles(workspaceRoot: string): string {
  const hash = crypto.createHash("sha256");
  for (const file of gitListFiles(workspaceRoot, [":(glob)*"])) {
    hashFileEntry(hash, file, path.join(workspaceRoot, file));
  }
  for (const name of listEnvFiles(workspaceRoot)) {
    hashFileEntry(hash, name, path.join(workspaceRoot, name));
  }
  return hash.digest("hex");
}

const PACKAGE_WALK_SKIP = new Set([
  "node_modules",
  ".git",
  ".turbo",
  ".cache",
  ".netlify",
  ".vercel",
]);

function walkPackageFiles(root: string, skipTopLevel: Set<string>): string[] {
  const out: string[] = [];
  const visit = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (PACKAGE_WALK_SKIP.has(entry.name)) continue;
      if (rel === "" && skipTopLevel.has(entry.name)) continue;
      if (entry.name.endsWith(".tsbuildinfo")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), childRel);
      else out.push(childRel);
    }
  };
  visit(root, "");
  return out.sort();
}

/**
 * Hash what a consuming app builds against. A package with a `dist` is
 * consumed through its built output, so its `src` is excluded: hashing `dist`
 * is what makes a Core change invalidate every app that depends on it, and a
 * `src` edit that was never rebuilt must not.
 */
function hashWorkspacePackage(
  runtime: DeployCacheRuntime,
  dir: string,
): string {
  const cached = runtime.packageHashes.get(dir);
  if (cached) return cached;
  const skip = new Set<string>();
  if (fs.existsSync(path.join(dir, "dist"))) skip.add("src");
  const published = publishedPathPrefixes(dir);
  const hash = crypto.createHash("sha256");
  for (const rel of walkPackageFiles(dir, skip)) {
    if (published && !isPublished(rel, published)) continue;
    hashFileEntry(hash, rel, path.join(dir, rel));
  }
  const digest = hash.digest("hex");
  runtime.packageHashes.set(dir, digest);
  return digest;
}

/**
 * The paths a package's `files` field publishes, which is all a consumer can
 * import. Docs, tests and changelogs outside it must not invalidate apps.
 * Negated entries are ignored, which over-includes and so only misses more.
 */
function publishedPathPrefixes(dir: string): string[] | null {
  let files: unknown;
  try {
    files = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
    ).files;
  } catch (error) {
    throw new Error(`cannot read ${dir}/package.json: ${errorMessage(error)}`);
  }
  if (!Array.isArray(files)) return null;
  const prefixes = files
    .filter((f): f is string => typeof f === "string" && !f.startsWith("!"))
    .map((f) =>
      f
        .replace(/^\.\//, "")
        .split(/[*?{[]/, 1)
        .join("")
        .replace(/\/+$/, ""),
    );
  // A leading glob ("**/*.js") has no literal prefix, so which files it
  // publishes cannot be narrowed: hash the whole package.
  if (prefixes.some((f) => f === "")) return null;
  return prefixes;
}

function isPublished(rel: string, prefixes: string[]): boolean {
  return rel === "package.json" || prefixes.some((p) => rel.startsWith(p));
}

/** Workspace packages `pkgDir` depends on, transitively, by real path. */
function collectWorkspaceDependencies(
  runtime: DeployCacheRuntime,
  pkgDir: string,
  found: Map<string, string>,
): void {
  // `found` maps real path to package name: two local packages can share a name.
  const pkgJsonPath = path.join(pkgDir, "package.json");
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  } catch (error) {
    throw new Error(`cannot read ${pkgJsonPath}: ${errorMessage(error)}`);
  }
  const names = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(pkg[field] ?? {})) names.add(name);
  }
  for (const name of [...names].sort()) {
    let real: string;
    try {
      real = fs.realpathSync(path.join(pkgDir, "node_modules", name));
    } catch (error) {
      // Not installed for this package (an optional or hoisted peer). A
      // missing workspace dependency fails the build itself.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    // Registry packages always resolve inside a node_modules store; anything
    // else (workspace, link:, file:) is a local package whose output we build
    // against, wherever it lives.
    const isLocal = !real.split(path.sep).includes("node_modules");
    if (!isLocal || found.has(real)) continue;
    found.set(real, name);
    collectWorkspaceDependencies(runtime, real, found);
  }
}

export function hashBuildEnv(
  env: NodeJS.ProcessEnv,
  envIgnore: string[],
): string {
  const ignored = (name: string) =>
    VOLATILE_ENV_NAMES.has(name) ||
    VOLATILE_ENV_PREFIXES.some((p) => name.toLowerCase().startsWith(p)) ||
    envIgnore.some((pattern) =>
      pattern.endsWith("*")
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern,
    );
  const hash = crypto.createHash("sha256");
  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (value === undefined || ignored(name)) continue;
    hash.update(`${name}\0${sha256(value)}\n`);
  }
  return hash.digest("hex");
}

/**
 * The cache key. Throws when any input cannot be read: a key computed from a
 * partial view of the inputs could collide with a stale entry.
 */
export function computeAppCacheKey(
  runtime: DeployCacheRuntime,
  app: string,
  appDir: string,
  env: NodeJS.ProcessEnv,
  codeVersion: string,
): AppCacheKey {
  const deps = new Map<string, string>();
  collectWorkspaceDependencies(runtime, appDir, deps);
  const depHashes: Record<string, string> = {};
  const sorted = [...deps].sort(
    ([dirA, a], [dirB, b]) => a.localeCompare(b) || dirA.localeCompare(dirB),
  );
  const nameCounts = new Map<string, number>();
  for (const [, name] of sorted) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const [dir, name] of sorted) {
    const index = seen.get(name) ?? 0;
    seen.set(name, index + 1);
    const label = (nameCounts.get(name) ?? 1) > 1 ? `${name}#${index}` : name;
    depHashes[label] = hashWorkspacePackage(runtime, dir);
  }
  const components: Record<string, string> = {
    format: String(DEPLOY_CACHE_FORMAT_VERSION),
    code: codeVersion,
    node: process.versions.node.split(".", 1).join(""),
    preset: runtime.preset,
    app,
    source: hashAppSource(runtime.workspaceRoot, appDir),
    root: hashWorkspaceRootFiles(runtime.workspaceRoot),
    env: hashBuildEnv(env, runtime.envIgnore),
    ...Object.fromEntries(
      Object.entries(depHashes).map(([name, h]) => [`dep:${name}`, h]),
    ),
  };
  return {
    key: sha256(JSON.stringify(Object.entries(components).sort())),
    components,
  };
}

/**
 * Per-build values the build embeds on purpose (a timestamp, a freshly minted
 * function token). They differ between two builds of identical inputs, so
 * artifact-identity verification compares output with them masked.
 */
function maskPerBuildValues(text: string): string {
  return text
    .replace(/("date"\s*:\s*")[^"]+(")/g, "$1<date>$2")
    .replace(/(\w*TOKEN\w*\s*=\s*")[0-9a-f]{32,}(")/g, "$1<token>$2");
}

const MASKABLE_DIR = path.join(".netlify", "functions-internal");
const MASKABLE_MAX_BYTES = 1024 * 1024;

/**
 * Content hashes of everything under the build output paths, by relpath.
 * `stable` masks per-build values so two builds of the same inputs compare
 * equal; restore verification always uses the raw form.
 */
export function snapshotAppOutputs(
  appDir: string,
  mode: "raw" | "stable" = "raw",
): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (rel: string) => {
    const abs = path.join(appDir, rel);
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      files[rel] = `l:${fs.readlinkSync(abs)}`;
    } else if (stat.isDirectory()) {
      const children = fs.readdirSync(abs).sort();
      if (children.length === 0) files[rel] = "d";
      for (const child of children) visit(path.join(rel, child));
    } else if (stat.isFile()) {
      let data = fs.readFileSync(abs);
      if (
        mode === "stable" &&
        rel.startsWith(MASKABLE_DIR) &&
        /\.(mjs|js|json)$/.test(rel) &&
        stat.size <= MASKABLE_MAX_BYTES
      ) {
        data = Buffer.from(maskPerBuildValues(data.toString("utf-8")));
      }
      files[rel] = `f:${stat.mode & 0o111 ? "x" : "-"}:${sha256(data)}`;
    } else {
      throw new Error(`unsupported file type at ${abs}`);
    }
  };
  for (const out of APP_BUILD_OUTPUT_PATHS) {
    if (fs.existsSync(path.join(appDir, out))) visit(out);
  }
  return files;
}

export function treeHashOf(files: Record<string, string>): string {
  return sha256(
    Object.entries(files)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([p, id]) => `${p}\0${id}`)
      .join("\n"),
  );
}

interface EntryManifest {
  format: number;
  key: string;
  app: string;
  buildMs: number;
  createdAt: string;
  treeHash: string;
  files: Record<string, string>;
  /** `files` with per-build values masked, for verification. */
  stableFiles: Record<string, string>;
  components: Record<string, string>;
}

function entryDir(runtime: DeployCacheRuntime, app: string, key: string) {
  return path.join(runtime.dir, app, key);
}

function readManifest(dir: string): EntryManifest {
  const raw: unknown = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"),
  );
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;
  if (
    !isRecord(raw) ||
    raw.format !== DEPLOY_CACHE_FORMAT_VERSION ||
    typeof raw.key !== "string" ||
    typeof raw.treeHash !== "string" ||
    !isRecord(raw.files) ||
    !isRecord(raw.stableFiles) ||
    typeof raw.buildMs !== "number"
  ) {
    throw new Error("manifest has an unexpected shape");
  }
  const manifest = raw as unknown as EntryManifest;
  return manifest;
}

export function removeAppOutputs(appDir: string): void {
  for (const out of APP_BUILD_OUTPUT_PATHS) {
    fs.rmSync(path.join(appDir, out), { recursive: true, force: true });
  }
}

/**
 * Restore an app's outputs into `appDir`. On any failure the outputs are
 * removed again and the corrupt entry is deleted, so the caller rebuilds from
 * a clean slate and the next deploy does not trip over the same entry.
 */
export function restoreAppBuild(
  runtime: DeployCacheRuntime,
  app: string,
  appDir: string,
  key: string,
): CacheLookup {
  const dir = entryDir(runtime, app, key);
  if (!fs.existsSync(dir)) {
    return { hit: false, reason: "no-entry", detail: "no entry for this key" };
  }
  const startedAt = Date.now();
  let manifest: EntryManifest;
  try {
    manifest = readManifest(dir);
    if (manifest.key !== key) throw new Error("manifest key does not match");
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    return {
      hit: false,
      reason: "entry-unreadable",
      detail: errorMessage(error),
    };
  }
  try {
    const outputsDir = path.join(dir, "outputs");
    for (const out of APP_BUILD_OUTPUT_PATHS) {
      const src = path.join(outputsDir, out);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(appDir, out);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, {
        recursive: true,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      });
    }
    // Verify what landed on disk, not what the entry claims to hold.
    const restored = snapshotAppOutputs(appDir);
    const problems = diffSnapshots(manifest.files, restored);
    if (problems.length > 0 || treeHashOf(restored) !== manifest.treeHash) {
      throw new Error(
        `restored outputs differ from the entry: ${problems.slice(0, 5).join("; ") || "tree hash mismatch"}`,
      );
    }
  } catch (error) {
    removeAppOutputs(appDir);
    fs.rmSync(dir, { recursive: true, force: true });
    return {
      hit: false,
      reason: "restore-failed",
      detail: errorMessage(error),
    };
  }
  // Touch so pruning keeps recently used entries.
  const now = new Date();
  try {
    fs.utimesSync(dir, now, now);
  } catch {
    // coercion-ok: pruning order only; the restore is already verified.
    // Pruning order only; the restore is already verified.
  }
  return {
    hit: true,
    buildMs: manifest.buildMs,
    restoreMs: Date.now() - startedAt,
    treeHash: manifest.treeHash,
  };
}

export function diffSnapshots(
  expected: Record<string, string>,
  actual: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const [p, id] of Object.entries(expected)) {
    if (!(p in actual)) problems.push(`missing ${p}`);
    else if (actual[p] !== id) problems.push(`changed ${p}`);
  }
  for (const p of Object.keys(actual)) {
    if (!(p in expected)) problems.push(`extra ${p}`);
  }
  return problems;
}

export function readEntryManifest(
  runtime: DeployCacheRuntime,
  app: string,
  key: string,
): EntryManifest | null {
  try {
    return readManifest(entryDir(runtime, app, key));
  } catch {
    // coercion-ok: callers treat null as "no usable entry" and say so loudly.
    return null;
  }
}

/** Store a finished build. Returns the output tree hash. */
export function storeAppBuild(
  runtime: DeployCacheRuntime,
  app: string,
  appDir: string,
  cacheKey: AppCacheKey,
  buildMs: number,
): string {
  const files = snapshotAppOutputs(appDir);
  if (Object.keys(files).length === 0) {
    throw new Error("the build produced none of the expected output paths");
  }
  const appCacheDir = path.join(runtime.dir, app);
  fs.mkdirSync(appCacheDir, { recursive: true });
  const tmp = path.join(
    appCacheDir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
  );
  const treeHash = treeHashOf(files);
  try {
    const outputsDir = path.join(tmp, "outputs");
    for (const out of APP_BUILD_OUTPUT_PATHS) {
      const src = path.join(appDir, out);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(outputsDir, out);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, {
        recursive: true,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      });
    }
    const manifest: EntryManifest = {
      format: DEPLOY_CACHE_FORMAT_VERSION,
      key: cacheKey.key,
      app,
      buildMs,
      createdAt: new Date().toISOString(),
      treeHash,
      files,
      stableFiles: snapshotAppOutputs(appDir, "stable"),
      components: cacheKey.components,
    };
    fs.writeFileSync(
      path.join(tmp, "manifest.json"),
      JSON.stringify(manifest, null, 1),
    );
    const final = entryDir(runtime, app, cacheKey.key);
    fs.rmSync(final, { recursive: true, force: true });
    // Rename publishes the entry whole: a reader sees all of it or none.
    fs.renameSync(tmp, final);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  pruneAppEntries(appCacheDir, cacheKey.key);
  return treeHash;
}

function pruneAppEntries(appCacheDir: string, keep: string): void {
  try {
    const entries = fs
      .readdirSync(appCacheDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".tmp-"))
      .map((e) => ({
        name: e.name,
        mtime: fs.statSync(path.join(appCacheDir, e.name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of entries.slice(ENTRIES_KEPT_PER_APP)) {
      if (entry.name !== keep) {
        fs.rmSync(path.join(appCacheDir, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  } catch {
    // coercion-ok: pruning only bounds disk use.
    // Pruning only bounds disk use; the stored entry is already valid.
  }
}

/** Component names that differ from the newest earlier entry for the app. */
export function explainMiss(
  runtime: DeployCacheRuntime,
  app: string,
  cacheKey: AppCacheKey,
): string {
  const appCacheDir = path.join(runtime.dir, app);
  let newest: EntryManifest | null = null;
  let newestTime = -1;
  try {
    for (const e of fs.readdirSync(appCacheDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".tmp-")) continue;
      const mtime = fs.statSync(path.join(appCacheDir, e.name)).mtimeMs;
      if (mtime <= newestTime) continue;
      const manifest = readEntryManifest(runtime, app, e.name);
      if (manifest) {
        newest = manifest;
        newestTime = mtime;
      }
    }
  } catch {
    return "first build for this app in this cache";
  }
  if (!newest) return "first build for this app in this cache";
  const changed = new Set<string>();
  for (const name of new Set([
    ...Object.keys(newest.components),
    ...Object.keys(cacheKey.components),
  ])) {
    if (newest.components[name] !== cacheKey.components[name]) {
      changed.add(name);
    }
  }
  return changed.size > 0
    ? `inputs changed: ${[...changed].join(", ")}`
    : "inputs match an earlier entry that is no longer usable";
}

/** The deploy code's own version: a new Core release invalidates every entry. */
export function readDeployCodeVersion(): string {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "package.json",
  );
  const version = JSON.parse(fs.readFileSync(file, "utf-8")).version;
  if (typeof version !== "string" || !version) {
    throw new Error(`${file} has no version`);
  }
  return version;
}

export type AppCacheOutcome = "hit" | "miss" | "uncached";

/**
 * Build one app through the cache. `build` runs the real build and `clean`
 * clears stale outputs before it; both are the caller's, so this module never
 * spawns anything.
 */
export async function buildAppWithCache(opts: {
  runtime: DeployCacheRuntime;
  app: string;
  appDir: string;
  env: NodeJS.ProcessEnv;
  clean: () => void;
  build: () => Promise<void>;
  log: (message: string) => void;
}): Promise<AppCacheOutcome> {
  const { runtime, app, appDir, log } = opts;
  const timedBuild = async () => {
    opts.clean();
    const startedAt = Date.now();
    await opts.build();
    return Date.now() - startedAt;
  };

  let cacheKey: AppCacheKey;
  try {
    cacheKey = computeAppCacheKey(
      runtime,
      app,
      appDir,
      opts.env,
      readDeployCodeVersion(),
    );
  } catch (error) {
    runtime.stats.misses++;
    log(
      `[workspace-deploy] cache MISS ${app} (hash-failed: ${errorMessage(error)}); building`,
    );
    await timedBuild();
    return "uncached";
  }

  opts.clean();
  const lookup = restoreAppBuild(runtime, app, appDir, cacheKey.key);
  if (lookup.hit) {
    if (runtime.verifyRemaining > 0) {
      runtime.verifyRemaining--;
      opts.clean();
      const rebuiltMs = await timedBuild();
      const rebuilt = snapshotAppOutputs(appDir, "stable");
      const cached = readEntryManifest(runtime, app, cacheKey.key);
      const problems = cached
        ? diffSnapshots(cached.stableFiles, rebuilt)
        : ["entry vanished"];
      if (problems.length > 0) {
        throw new Error(
          `[workspace-deploy] cache verification FAILED for ${app} (key ${cacheKey.key.slice(0, 12)}): a rebuild with identical inputs produced different output (${problems.slice(0, 10).join("; ")}${problems.length > 10 ? `; +${problems.length - 10} more` : ""}). The build is not reproducible from its inputs, or the key is missing an input.`,
        );
      }
      runtime.stats.verified++;
      runtime.stats.hits++;
      log(
        `[workspace-deploy] cache HIT ${app} verified by rebuild (${(rebuiltMs / 1000).toFixed(1)}s, output identical)`,
      );
      return "hit";
    }
    runtime.stats.hits++;
    const saved = Math.max(0, lookup.buildMs - lookup.restoreMs);
    runtime.stats.savedMs += saved;
    log(
      `[workspace-deploy] cache HIT ${app} (restored in ${(lookup.restoreMs / 1000).toFixed(1)}s, saved ~${(saved / 1000).toFixed(1)}s)`,
    );
    return "hit";
  }

  runtime.stats.misses++;
  const why =
    lookup.reason === "no-entry"
      ? explainMiss(runtime, app, cacheKey)
      : lookup.detail;
  log(
    `[workspace-deploy] cache MISS ${app} (${lookup.reason}: ${why}); building`,
  );
  const buildMs = await timedBuild();
  try {
    storeAppBuild(runtime, app, appDir, cacheKey, buildMs);
  } catch (error) {
    log(
      `[workspace-deploy] cache STORE failed for ${app}: ${errorMessage(error)}; the build is valid and was not cached`,
    );
  }
  return "miss";
}
