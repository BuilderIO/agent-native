import fs from "node:fs";
import path from "node:path";

export type CleanCategory =
  | "vite-cache"
  | "nitro-cache"
  | "build-output"
  | "deploy-artifacts";

export interface CleanTarget {
  category: CleanCategory;
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  bytes: number;
}

export interface CleanFailure {
  path: string;
  message: string;
  remainingBytes?: number;
}

function addFailure(failures: CleanFailure[], failure: CleanFailure): void {
  const duplicate = failures.some(
    (existing) =>
      existing.path === failure.path && existing.message === failure.message,
  );
  if (!duplicate) failures.push(failure);
}

export interface CleanCategoryTotals {
  found: number;
  reclaimed: number;
  count: number;
}

export interface CleanReport {
  root: string;
  scope: "workspace" | "app";
  applied: boolean;
  targets: CleanTarget[];
  failures: CleanFailure[];
  bytesFound: number;
  bytesReclaimed: number;
  byCategory: Partial<Record<CleanCategory, CleanCategoryTotals>>;
}

const PROTECTED_NAMES = new Set([
  ".git",
  "data",
  "node_modules",
  ".pnpm",
  ".pnpm-store",
]);

function isProtectedName(name: string): boolean {
  const lower = name.toLowerCase();
  return PROTECTED_NAMES.has(lower) || lower.startsWith(".env");
}

const NODE_MODULES_CACHES: Record<string, CleanCategory> = {
  ".vite": "vite-cache",
  ".vite-temp": "vite-cache",
  ".nitro": "nitro-cache",
};

const APP_ROOT_BUILD_OUTPUTS: Array<{
  segments: string[];
  category: CleanCategory;
}> = [
  { segments: ["build"], category: "build-output" },
  { segments: ["dist"], category: "build-output" },
  { segments: [".output"], category: "build-output" },
  {
    segments: [".netlify", "functions-internal"],
    category: "deploy-artifacts",
  },
];

const MAX_WALK_DEPTH = 64;

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

export function isSafeTarget(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const segments = rel.split(path.sep);
  if (isProtectedName(segments[segments.length - 1])) return false;
  return !segments.slice(0, -1).some((segment) => {
    const lower = segment.toLowerCase();
    return lower !== "node_modules" && PROTECTED_NAMES.has(lower);
  });
}

interface WalkedFile {
  size: number;
  dev: number;
  ino: number;
  nlink: number;
}

interface WalkResult {
  complete: boolean;
  mounts: string[];
}

function walkFiles(
  dir: string,
  device: number,
  failures: CleanFailure[],
  onFile: (file: WalkedFile) => void,
  result: WalkResult = { complete: true, mounts: [] },
): WalkResult {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    addFailure(failures, {
      path: dir,
      message: `could not read: ${errorMessage(err)}`,
    });
    result.complete = false;
    return result;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      let dirStat: fs.Stats;
      try {
        dirStat = fs.lstatSync(full);
      } catch (err) {
        addFailure(failures, {
          path: full,
          message: `could not stat: ${errorMessage(err)}`,
        });
        result.complete = false;
        continue;
      }
      if (dirStat.dev !== device) {
        result.mounts.push(full);
        continue;
      }
      walkFiles(full, device, failures, onFile, result);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = fs.lstatSync(full);
      onFile({
        size: stat.size,
        dev: stat.dev,
        ino: stat.ino,
        nlink: stat.nlink,
      });
    } catch (err) {
      addFailure(failures, {
        path: full,
        message: `could not stat: ${errorMessage(err)}`,
      });
      result.complete = false;
    }
  }
  return result;
}

function walkTarget(
  target: CleanTarget,
  failures: CleanFailure[],
  onFile: (file: WalkedFile) => void,
): WalkResult {
  const named = (walked: string): string =>
    walked.startsWith(target.realPath)
      ? target.path + walked.slice(target.realPath.length)
      : walked;
  const walkFailures: CleanFailure[] = [];
  const result = walkFiles(target.realPath, target.dev, walkFailures, onFile);
  for (const failure of walkFailures) {
    addFailure(failures, {
      ...failure,
      path: named(failure.path),
      message: failure.message.replaceAll(target.realPath, target.path),
    });
  }
  result.mounts = result.mounts.map(named);
  return result;
}

function measureTargets(
  targets: CleanTarget[],
  failures: CleanFailure[],
): CleanTarget[] {
  const bytes = targets.map(() => 0);
  const crossesMount = targets.map(() => false);
  const links = new Map<
    string,
    { size: number; nlink: number; found: number; owner: number }
  >();
  targets.forEach((target, index) => {
    const walked = walkTarget(target, failures, (file) => {
      if (file.nlink <= 1) {
        bytes[index] += file.size;
        return;
      }
      const inode = `${file.dev}:${file.ino}`;
      const existing = links.get(inode);
      if (existing) existing.found += 1;
      else
        links.set(inode, {
          size: file.size,
          nlink: file.nlink,
          found: 1,
          owner: index,
        });
    });
    for (const mount of walked.mounts) {
      crossesMount[index] = true;
      addFailure(failures, {
        path: mount,
        message: `is on another filesystem, so ${target.path} was left in place — this command does not delete across a mount boundary`,
      });
    }
  });
  for (const link of links.values()) {
    if (link.found === link.nlink) bytes[link.owner] += link.size;
  }
  targets.forEach((target, index) => {
    target.bytes = bytes[index];
  });
  return targets.filter((_, index) => !crossesMount[index]);
}

function measureRemaining(
  target: CleanTarget,
  failures: CleanFailure[],
): number | undefined {
  const seen = new Set<string>();
  let total = 0;
  const walked = walkTarget(target, failures, (file) => {
    if (file.nlink > 1) {
      const inode = `${file.dev}:${file.ino}`;
      if (seen.has(inode)) return;
      seen.add(inode);
    }
    total += file.size;
  });
  if (!walked.complete || walked.mounts.length > 0) return undefined;
  return total;
}

interface ScanContext {
  realRoot: string;
  rootDev: number;
  excluded: Set<string>;
  targets: CleanTarget[];
  failures: CleanFailure[];
}

function onRootDevice(ctx: ScanContext, dir: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch (err) {
    addFailure(ctx.failures, {
      path: dir,
      message: `could not stat: ${errorMessage(err)}`,
    });
    return false;
  }
  if (stat.dev === ctx.rootDev) return true;
  addFailure(ctx.failures, {
    path: dir,
    message: `not scanned: on another filesystem (device ${stat.dev}, the root is on ${ctx.rootDev})`,
  });
  return false;
}

function resolveEntryPath(
  parent: string,
  segments: string[],
  failures: CleanFailure[],
): string | null {
  let dir = parent;
  for (const segment of segments) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        addFailure(failures, {
          path: dir,
          message: `could not read: ${errorMessage(err)}`,
        });
      }
      return null;
    }
    const entry = entries.find((candidate) => candidate.name === segment);
    if (!entry?.isDirectory()) return null;
    dir = path.join(dir, entry.name);
  }
  return dir;
}

function addTarget(
  ctx: ScanContext,
  parent: string,
  segments: string[],
  category: CleanCategory,
): void {
  const target = resolveEntryPath(parent, segments, ctx.failures);
  if (!target) return;
  let real: string;
  let stat: fs.Stats;
  try {
    real = fs.realpathSync(target);
    stat = fs.lstatSync(real);
  } catch (err) {
    addFailure(ctx.failures, {
      path: target,
      message: `could not resolve: ${errorMessage(err)}`,
    });
    return;
  }
  if (stat.dev !== ctx.rootDev) {
    addFailure(ctx.failures, {
      path: target,
      message: `not removed: on another filesystem (device ${stat.dev}, the root is on ${ctx.rootDev})`,
    });
    return;
  }
  if (!isSafeTarget(ctx.realRoot, real)) return;
  ctx.targets.push({
    category,
    path: target,
    realPath: real,
    dev: stat.dev,
    ino: stat.ino,
    bytes: 0,
  });
}

function listSubdirectories(dir: string, failures: CleanFailure[]): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      addFailure(failures, {
        path: dir,
        message: `could not read: ${errorMessage(err)}`,
      });
    }
    return [];
  }
}

function walkForCaches(ctx: ScanContext, dir: string, depth: number): void {
  if (depth > MAX_WALK_DEPTH) {
    addFailure(ctx.failures, {
      path: dir,
      message: `not scanned: more than ${MAX_WALK_DEPTH} directories below the root`,
    });
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    addFailure(ctx.failures, {
      path: dir,
      message: `could not read: ${errorMessage(err)}`,
    });
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (ctx.excluded.has(full)) continue;
    if (entry.name === "node_modules") {
      for (const [name, category] of Object.entries(NODE_MODULES_CACHES)) {
        addTarget(ctx, full, [name], category);
      }
      continue;
    }
    if (entry.name.startsWith(".") || isProtectedName(entry.name)) continue;
    if (!onRootDevice(ctx, full)) continue;
    walkForCaches(ctx, full, depth + 1);
  }
}

function dropNested(targets: CleanTarget[]): CleanTarget[] {
  return targets.filter(
    (target) =>
      !targets.some(
        (other) =>
          other !== target &&
          target.realPath.startsWith(other.realPath + path.sep),
      ),
  );
}

export interface ScanCleanOptions {
  root: string;
  builds?: boolean;
}

export interface CleanScan {
  scope: "workspace" | "app";
  realRoot: string;
  targets: CleanTarget[];
  failures: CleanFailure[];
}

interface AppDirs {
  agentNative: string[];
  foreign: string[];
}

function splitAppDirs(root: string, failures: CleanFailure[]): AppDirs {
  const dirs: AppDirs = { agentNative: [], foreign: [] };
  const appsDir = resolveEntryPath(root, ["apps"], failures);
  if (!appsDir) return dirs;
  for (const app of listSubdirectories(appsDir, failures)) {
    const dir = path.join(appsDir, app);
    const marker = readAgentNativeMarker(dir);
    if (marker.kind === "agent-native") {
      dirs.agentNative.push(dir);
      continue;
    }
    if (marker.kind === "unreadable") {
      addFailure(failures, {
        path: marker.path,
        message: `could not be read (${marker.message}), so ${dir} is not treated as an Agent-Native app`,
      });
    }
    dirs.foreign.push(dir);
  }
  return dirs;
}

export function scanCleanTargets(options: ScanCleanOptions): CleanScan {
  const root = path.resolve(options.root);
  let realRoot: string;
  let rootDev: number;
  try {
    realRoot = fs.realpathSync(root);
    rootDev = fs.statSync(realRoot).dev;
  } catch (err) {
    return {
      scope: "app",
      realRoot: root,
      targets: [],
      failures: [
        { path: root, message: `could not resolve: ${errorMessage(err)}` },
      ],
    };
  }
  const failures: CleanFailure[] = [];
  const apps = splitAppDirs(root, failures);
  const ctx: ScanContext = {
    realRoot,
    rootDev,
    excluded: new Set(apps.foreign),
    targets: [],
    failures,
  };

  const appRoots = [root, ...apps.agentNative];
  const scope = appRoots.length > 1 ? "workspace" : "app";

  walkForCaches(ctx, root, 0);
  if (options.builds) {
    for (const appRoot of appRoots) {
      for (const output of APP_ROOT_BUILD_OUTPUTS) {
        addTarget(ctx, appRoot, output.segments, output.category);
      }
    }
  }

  const targets = measureTargets(dropNested(ctx.targets), ctx.failures);

  return { scope, realRoot, targets, failures: ctx.failures };
}

export interface PerformCleanOptions extends ScanCleanOptions {
  apply?: boolean;
}

type TargetCheck =
  | { kind: "unchanged" }
  | { kind: "gone" }
  | { kind: "changed"; reason: string };

/**
 * Re-answers, right before the delete, the question the scan answered: is this
 * still the same directory, still inside the root?
 *
 * Three answers, not two. `gone` is the third: the directory this run was about
 * to remove has already been removed, which is the outcome it wanted and none
 * of its bytes to claim. Reporting that as a failure was over-loud in exactly
 * the place the delete one line below was over-quiet.
 *
 * `measure` walks every target first, so the scan-to-delete gap is seconds.
 * `rmSync` lstats only the final component, so swapping the target itself is
 * harmless — but the kernel resolves its parents, and swapping one for a
 * symlink pointing out of the root made a previous version delete, and cheerily
 * count, a directory it never scanned.
 *
 * This closes that window and catches the realistic accident — a build process
 * recreating a link mid-run. It is not a race that a local dev CLI can win
 * outright: a process with write access to the workspace can still swap a
 * parent between this check and the `rmSync` below. Narrowing the window and
 * failing loudly when it loses is the guarantee on offer.
 */
function verifyTargetUnchanged(
  realRoot: string,
  target: CleanTarget,
): TargetCheck {
  let stat: fs.Stats;
  let real: string;
  try {
    stat = fs.lstatSync(target.path);
    real = fs.realpathSync(target.path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "gone" };
    }
    return {
      kind: "changed",
      reason: `changed since the scan, could not re-check: ${errorMessage(err)}`,
    };
  }
  if (!stat.isDirectory()) {
    return { kind: "changed", reason: "is no longer a directory" };
  }
  if (stat.dev !== target.dev || stat.ino !== target.ino) {
    return {
      kind: "changed",
      reason: `is a different directory than the one scanned (was ${target.dev}:${target.ino}, now ${stat.dev}:${stat.ino})`,
    };
  }
  if (real !== target.realPath) {
    return {
      kind: "changed",
      reason: `now resolves to ${real}, not ${target.realPath}`,
    };
  }
  if (!isSafeTarget(realRoot, real)) {
    return { kind: "changed", reason: `no longer resolves inside ${realRoot}` };
  }
  return { kind: "unchanged" };
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
    const check = verifyTargetUnchanged(scan.realRoot, target);
    if (check.kind === "changed") {
      addFailure(failures, { path: target.path, message: check.reason });
      continue;
    }
    if (check.kind === "gone") continue;
    try {
      fs.rmSync(target.realPath, { recursive: true });
      entry.reclaimed += target.bytes;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      const remainingBytes = measureRemaining(target, failures);
      addFailure(failures, {
        path: target.path,
        message: errorMessage(err),
        remainingBytes,
      });
      if (remainingBytes !== undefined) {
        entry.reclaimed += Math.max(0, target.bytes - remainingBytes);
      }
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

const CLEAN_HELP_LINES: string[] = [
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
  "directory, .env files. Under apps/, only apps that are themselves Agent",
  "Native are cleaned.",
  "",
  "Exit codes: 0 clean, 1 a delete or scan failed, 2 usage error.",
];

export function printCleanHelp(io: Pick<CleanIo, "log"> = defaultIo): void {
  io.log(CLEAN_HELP_LINES.join("\n"));
}

function formatPath(target: string): string {
  return /\p{Cc}/u.test(target) ? JSON.stringify(target) : target;
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
        lines.push(
          `    ${formatPath(target.path)}  ${formatBytes(target.bytes)}`,
        );
      }
    }
  }

  const shortfall = report.bytesFound - report.bytesReclaimed;
  lines.push(
    !report.applied
      ? `Would reclaim ${formatBytes(report.bytesFound)}. Nothing was deleted — re-run with --apply.`
      : shortfall === 0
        ? `Reclaimed ${formatBytes(report.bytesReclaimed)}.`
        : `Reclaimed ${formatBytes(report.bytesReclaimed)} of ${formatBytes(report.bytesFound)} — ${shortfall} bytes not reclaimed.`,
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
      lines.push(
        `  ${formatPath(failure.path)} — ${failure.message}${remaining}`,
      );
    }
  }

  return lines.join("\n");
}

type MarkerCheck =
  | { kind: "agent-native" }
  | { kind: "none" }
  | { kind: "unreadable"; path: string; message: string };

function readAgentNativeMarker(dir: string): MarkerCheck {
  for (const file of ["agent-native.json", "package.json"]) {
    const filePath = path.join(dir, file);
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      return { kind: "unreadable", path: filePath, message: errorMessage(err) };
    }
    let parsed: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { kind: "unreadable", path: filePath, message: errorMessage(err) };
    }
    if (file === "agent-native.json") return { kind: "agent-native" };
    if (
      parsed?.dependencies?.["@agent-native/core"] ||
      parsed?.devDependencies?.["@agent-native/core"]
    ) {
      return { kind: "agent-native" };
    }
  }
  return { kind: "none" };
}

/**
 * `clean`'s own authorization gate, and deliberately not `doctor`'s detector.
 *
 * That one answers "is there a project here worth reporting on", so it says
 * yes for a bare workspace marker and yes for a manifest it could not parse —
 * correct for a report, and an unconditional delete permit when borrowed as an
 * authorization. Absent, unreadable and confirmed-Agent-Native are three
 * different answers; only the third authorizes anything here.
 *
 * `isSafeTarget` only vouches for a directory's *name*, so a `build` or `dist`
 * outside a project is still a plausible personal folder, and every npm, pnpm
 * or yarn monorepo on the machine — `$HOME` included, if its `package.json`
 * has a `workspaces` key — carries a workspace marker. A workspace root is
 * accepted only when an app under `apps/` actually is Agent-Native, which is
 * also the only part of a workspace this command ever cleans.
 */
function checkProjectRoot(
  root: string,
): { ok: true } | { ok: false; reason: string } {
  const marker = readAgentNativeMarker(root);
  if (marker.kind === "unreadable") {
    return {
      ok: false,
      reason: `${marker.path} could not be read (${marker.message}), so this cannot be confirmed as an Agent-Native project.`,
    };
  }
  if (marker.kind === "agent-native") return { ok: true };
  // Same list the scan selects from, so the permission and the blast radius
  // cannot drift apart.
  if (splitAppDirs(root, []).agentNative.length > 0) return { ok: true };
  return {
    ok: false,
    reason:
      "no package.json depending on @agent-native/core, no agent-native.json, and no apps/* with either, so this is not the root of an Agent-Native project.",
  };
}

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
    if (opts.json) {
      io.log(JSON.stringify({ ok: true, help: CLEAN_HELP_LINES }, null, 2));
    } else {
      printCleanHelp(io);
    }
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
  const project = checkProjectRoot(root);
  if (!project.ok) {
    return usageError(
      `Refusing to clean ${formatPath(root)}: ${project.reason}`,
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
