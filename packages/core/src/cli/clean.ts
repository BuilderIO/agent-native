/**
 * `agent-native clean` — reclaim disk by deleting regenerable build caches.
 *
 * Everything this removes is reproduced by the next `dev`/`build`. Nothing it
 * removes is user data: `node_modules` itself, the pnpm store, `.git`, an
 * app's `data/` directory, and `.env*` are never candidates (see
 * `PROTECTED_NAMES` and `isSafeTarget`), and the root has to look like a
 * project at all (see `isProjectRoot`). Those two checks are the whole safety
 * contract, not a nicety.
 *
 * Like `agent-native package add` and `agent-native eject`, this is dry-run
 * unless `--apply` is passed, so the reflex form of the command shows the
 * paths and the bytes without touching anything.
 *
 *   agent-native clean                # dry run: caches only
 *   agent-native clean --apply        # delete them
 *   agent-native clean --builds --apply
 *
 * Caches (default) come back on the next dev start; build outputs (`--builds`)
 * need a real rebuild, which is why they are opt-in.
 */
import fs from "node:fs";
import path from "node:path";

export type CleanCategory =
  | "vite-cache"
  | "nitro-cache"
  | "build-output"
  | "deploy-artifacts";

export interface CleanTarget {
  category: CleanCategory;
  /** Absolute path. */
  path: string;
  /** Size when scanned. */
  bytes: number;
}

export interface CleanFailure {
  path: string;
  /** A delete that threw, or a path the scan could not read. */
  message: string;
  /** Bytes still on disk under `path`. Absent when it was never measurable —
   * an unreadable path is not an empty one. */
  remainingBytes?: number;
}

export interface CleanCategoryTotals {
  found: number;
  reclaimed: number;
  count: number;
}

export interface CleanReport {
  root: string;
  scope: "workspace" | "app";
  /** False for a dry run — then `bytesReclaimed` is 0, never the found total. */
  applied: boolean;
  targets: CleanTarget[];
  failures: CleanFailure[];
  bytesFound: number;
  bytesReclaimed: number;
  byCategory: Partial<Record<CleanCategory, CleanCategoryTotals>>;
}

/**
 * Never deleted and never descended into. `node_modules` is the one entry
 * that is banned as a target but allowed as a *parent*: the caches below all
 * live directly inside it.
 */
const PROTECTED_NAMES = new Set([
  ".git",
  "data",
  "node_modules",
  ".pnpm",
  ".pnpm-store",
]);

/**
 * Immediate children of a `node_modules` directory that are pure caches.
 * `.vite` holds `deps/` alongside the `deps_temp_*` directories a killed or
 * crashed re-optimize orphans, so removing it covers both.
 */
const NODE_MODULES_CACHES: Record<string, CleanCategory> = {
  ".vite": "vite-cache",
  ".vite-temp": "vite-cache",
  ".nitro": "nitro-cache",
};

/** Checked only at app roots — a `dist` or `build` deeper in a source tree
 * may well be hand-written. */
const APP_ROOT_BUILD_OUTPUTS: Record<string, CleanCategory> = {
  build: "build-output",
  dist: "build-output",
  ".output": "build-output",
  [path.join(".netlify", "functions-internal")]: "deploy-artifacts",
};

/** Deep enough for `<workspace>/apps/<app>/packages/<pkg>/node_modules`. */
const MAX_WALK_DEPTH = 8;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Refuses anything outside `root` and anything named — or nested under —
 * a protected directory. `node_modules` is allowed as a parent segment
 * because that is exactly where the Vite and Nitro caches live.
 */
export function isSafeTarget(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const segments = rel.split(path.sep);
  const name = segments[segments.length - 1];
  if (PROTECTED_NAMES.has(name) || name.startsWith(".env")) return false;
  return !segments
    .slice(0, -1)
    .some(
      (segment) => segment !== "node_modules" && PROTECTED_NAMES.has(segment),
    );
}

/**
 * Sum of file sizes under `dir`, not following symlinks. Paths that cannot be
 * read are recorded rather than counted as zero — an under-reported scan is
 * how a clean-looking total hides a directory nobody can actually delete.
 *
 * `seen` de-duplicates inodes: the deploy bundles are hard links of one
 * another, so counting each link at full size reports several times the bytes
 * removing the tree actually gives back.
 */
function measure(
  dir: string,
  failures: CleanFailure[],
  seen = new Set<string>(),
): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    failures.push({
      path: dir,
      message: `could not read: ${errorMessage(err)}`,
    });
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // Dirent flags come from lstat, so a symlinked directory lands here as a
    // symlink and is skipped — its bytes live somewhere we are not deleting.
    if (entry.isDirectory()) {
      total += measure(full, failures, seen);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = fs.lstatSync(full);
      if (stat.nlink > 1) {
        const inode = `${stat.dev}:${stat.ino}`;
        if (seen.has(inode)) continue;
        seen.add(inode);
      }
      total += stat.size;
    } catch (err) {
      failures.push({
        path: full,
        message: `could not stat: ${errorMessage(err)}`,
      });
    }
  }
  return total;
}

interface ScanContext {
  root: string;
  targets: CleanTarget[];
  failures: CleanFailure[];
}

function addTarget(
  ctx: ScanContext,
  target: string,
  category: CleanCategory,
): void {
  if (!isSafeTarget(ctx.root, target)) return;
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (err) {
    // Absent and unreadable are different answers: the first is the normal
    // case, the second is space we are about to under-report.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      ctx.failures.push({
        path: target,
        message: `could not stat: ${errorMessage(err)}`,
      });
    }
    return;
  }
  if (!stat.isDirectory()) return;
  ctx.targets.push({
    category,
    path: target,
    bytes: measure(target, ctx.failures),
  });
}

function listSubdirectories(dir: string, failures: CleanFailure[]): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (err) {
    // No `apps/` is the normal single-app case; an `apps/` nobody can read is
    // a workspace silently scanned as one app, so it has to be reported.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      failures.push({
        path: dir,
        message: `could not read: ${errorMessage(err)}`,
      });
    }
    return [];
  }
}

function walkForCaches(ctx: ScanContext, dir: string, depth: number): void {
  if (depth > MAX_WALK_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    ctx.failures.push({
      path: dir,
      message: `could not read: ${errorMessage(err)}`,
    });
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules") {
      for (const [name, category] of Object.entries(NODE_MODULES_CACHES)) {
        addTarget(ctx, path.join(full, name), category);
      }
      continue;
    }
    if (entry.name.startsWith(".") || PROTECTED_NAMES.has(entry.name)) continue;
    walkForCaches(ctx, full, depth + 1);
  }
}

/** Drop targets nested inside another target so bytes are counted, and
 * deleted, exactly once. */
function dropNested(targets: CleanTarget[]): CleanTarget[] {
  return targets.filter(
    (target) =>
      !targets.some(
        (other) =>
          other !== target && target.path.startsWith(other.path + path.sep),
      ),
  );
}

export interface ScanCleanOptions {
  root: string;
  /** Also select build outputs and deploy bundles, which need a rebuild. */
  builds?: boolean;
}

export interface CleanScan {
  scope: "workspace" | "app";
  targets: CleanTarget[];
  failures: CleanFailure[];
}

/** Selects what `clean` would remove. Reads only — no deletes. */
export function scanCleanTargets(options: ScanCleanOptions): CleanScan {
  const root = path.resolve(options.root);
  const ctx: ScanContext = { root, targets: [], failures: [] };

  const appsDir = path.join(root, "apps");
  const apps = listSubdirectories(appsDir, ctx.failures);
  const scope = apps.length > 0 ? "workspace" : "app";
  const appRoots = [root, ...apps.map((app) => path.join(appsDir, app))];

  walkForCaches(ctx, root, 0);
  if (options.builds) {
    for (const appRoot of appRoots) {
      for (const [rel, category] of Object.entries(APP_ROOT_BUILD_OUTPUTS)) {
        addTarget(ctx, path.join(appRoot, rel), category);
      }
    }
  }

  return { scope, targets: dropNested(ctx.targets), failures: ctx.failures };
}

export interface PerformCleanOptions extends ScanCleanOptions {
  /** Delete. Without it nothing is touched and `bytesReclaimed` stays 0. */
  apply?: boolean;
}

export function performClean(options: PerformCleanOptions): CleanReport {
  const root = path.resolve(options.root);
  const scan = scanCleanTargets({ ...options, root });
  const failures = [...scan.failures];
  const byCategory: Partial<Record<CleanCategory, CleanCategoryTotals>> = {};

  const totals = (category: CleanCategory): CleanCategoryTotals => {
    const existing = byCategory[category];
    if (existing) return existing;
    const fresh = { found: 0, reclaimed: 0, count: 0 };
    byCategory[category] = fresh;
    return fresh;
  };

  for (const target of scan.targets) {
    const entry = totals(target.category);
    entry.found += target.bytes;
    entry.count += 1;
    if (!options.apply) continue;
    try {
      fs.rmSync(target.path, { recursive: true, force: true });
      entry.reclaimed += target.bytes;
    } catch (err) {
      // `force` swallows ENOENT but not EACCES/EBUSY, and a recursive rm can
      // throw after already freeing part of the tree. Re-measure so a failed
      // target contributes what it actually freed and still reports loudly.
      const remainingBytes = fs.existsSync(target.path)
        ? measure(target.path, failures)
        : 0;
      failures.push({
        path: target.path,
        message: errorMessage(err),
        remainingBytes,
      });
      entry.reclaimed += Math.max(0, target.bytes - remainingBytes);
    }
  }

  const sum = (pick: (t: CleanCategoryTotals) => number) =>
    Object.values(byCategory).reduce((acc, entry) => acc + pick(entry), 0);

  return {
    root,
    scope: scan.scope,
    applied: Boolean(options.apply),
    targets: scan.targets,
    failures,
    bytesFound: sum((entry) => entry.found),
    bytesReclaimed: sum((entry) => entry.reclaimed),
    byCategory,
  };
}

export interface CleanIo {
  log: (message: string) => void;
  err: (message: string) => void;
}

const defaultIo: CleanIo = {
  log: (message) => console.log(message),
  err: (message) => console.error(message),
};

export interface CleanCliOptions {
  cwd?: string;
  apply?: boolean;
  dryRun?: boolean;
  builds?: boolean;
  json?: boolean;
  help?: boolean;
  /** Set when argv could not be parsed; `runClean` turns it into exit 2. A
   * typo must not degrade into a different command — `--aply` silently
   * ignored is the difference between a dry run and a real delete. */
  error?: string;
}

export function parseCleanArgs(argv: string[]): CleanCliOptions {
  const opts: CleanCliOptions = {};
  const cwdRequired = "--cwd requires a directory path.";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--apply") {
      opts.apply = true;
    } else if (arg === "--dry-run" || arg === "-n") {
      opts.dryRun = true;
    } else if (arg === "--builds") {
      opts.builds = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--cwd") {
      const value = argv[++i];
      if (!value) return { ...opts, error: cwdRequired };
      opts.cwd = value;
    } else if (arg.startsWith("--cwd=")) {
      const value = arg.slice("--cwd=".length);
      if (!value) return { ...opts, error: cwdRequired };
      opts.cwd = value;
    } else {
      return {
        ...opts,
        error: `Unknown argument: ${arg}. Run \`agent-native clean --help\`.`,
      };
    }
  }
  return opts;
}

export function printCleanHelp(io: Pick<CleanIo, "log"> = defaultIo): void {
  io.log(
    [
      "Usage:",
      "  agent-native clean                Show what would be reclaimed (dry run, caches only)",
      "  agent-native clean --apply        Delete the caches",
      "  agent-native clean --builds       Also select build outputs and deploy bundles",
      "  agent-native clean --json         Machine-readable report",
      "  agent-native clean --cwd <dir>    Run against a workspace or app root other than the current directory",
      "  agent-native clean --help         Show this help",
      "",
      "Caches (node_modules/.vite, .vite-temp, .nitro) are rebuilt by the next",
      "dev start. --builds also removes build/, dist/, .output/ and",
      ".netlify/functions-internal, which need a real rebuild.",
      "",
      "Never removed: node_modules itself, the pnpm store, .git, an app's data/",
      "directory, .env files.",
      "",
      "Exit codes: 0 clean, 1 a delete or scan failed, 2 usage error.",
    ].join("\n"),
  );
}

function formatCleanHuman(report: CleanReport): string {
  const lines: string[] = [];
  lines.push(`agent-native clean: ${report.root} (${report.scope})`);

  if (report.targets.length === 0) {
    lines.push("Nothing to reclaim.");
  } else {
    for (const [category, entry] of Object.entries(report.byCategory)) {
      lines.push(
        report.applied
          ? `  ${category.padEnd(18)} reclaimed ${formatBytes(entry.reclaimed)} of ${formatBytes(entry.found)} (${entry.count} dir(s))`
          : `  ${category.padEnd(18)} ${formatBytes(entry.found)} (${entry.count} dir(s))`,
      );
    }
    if (!report.applied) {
      for (const target of report.targets) {
        lines.push(`    ${target.path}  ${formatBytes(target.bytes)}`);
      }
    }
  }

  lines.push(
    report.applied
      ? `Reclaimed ${formatBytes(report.bytesReclaimed)} of ${formatBytes(report.bytesFound)}.`
      : `Would reclaim ${formatBytes(report.bytesFound)}. Nothing was deleted — re-run with --apply.`,
  );

  if (report.failures.length > 0) {
    lines.push(
      `${report.failures.length} failure(s) — this run is incomplete:`,
    );
    for (const failure of report.failures) {
      const remaining =
        failure.remainingBytes === undefined
          ? ""
          : ` (${formatBytes(failure.remainingBytes)} still on disk)`;
      lines.push(`  ${failure.path} — ${failure.message}${remaining}`);
    }
  }

  return lines.join("\n");
}

/**
 * `isSafeTarget` only vouches for a directory's *name*, so a `build` or `dist`
 * outside a project is still a plausible personal folder. The same marker the
 * other root-taking commands use (`eject`, `package add`) has to be present
 * before anything here deletes.
 */
function isProjectRoot(root: string): boolean {
  return (
    fs.existsSync(path.join(root, "package.json")) ||
    fs.existsSync(path.join(root, "agent-native.json")) ||
    fs
      .statSync(path.join(root, "apps"), { throwIfNoEntry: false })
      ?.isDirectory() === true
  );
}

/** `agent-native clean` CLI entrypoint. Returns the process exit code —
 * callers are responsible for calling `process.exit(code)`. */
export async function runClean(
  argv: string[],
  io: CleanIo = defaultIo,
): Promise<number> {
  const opts = parseCleanArgs(argv);
  const usageError = (message: string): number => {
    if (opts.json) io.err(JSON.stringify({ ok: false, message }, null, 2));
    else io.err(message);
    return 2;
  };

  if (opts.error) return usageError(opts.error);

  if (opts.help) {
    printCleanHelp(io);
    return 0;
  }

  if (opts.apply && opts.dryRun) {
    return usageError("Pass either --apply or --dry-run, not both.");
  }

  const root = path.resolve(opts.cwd ?? process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return usageError(
      `--cwd path does not exist or is not a directory: ${root}`,
    );
  }
  if (!isProjectRoot(root)) {
    return usageError(
      `Refusing to clean ${root}: no package.json, agent-native.json or apps/ directory, so this is not a project root.`,
    );
  }

  const report = performClean({
    root,
    builds: opts.builds,
    apply: opts.apply,
  });
  const ok = report.failures.length === 0;

  if (opts.json) {
    io.log(JSON.stringify({ ...report, ok }, null, 2));
  } else {
    io.log(formatCleanHuman(report));
  }

  return ok ? 0 : 1;
}
