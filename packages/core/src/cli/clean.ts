/**
 * `agent-native clean` — reclaim disk by deleting regenerable build caches.
 *
 * Everything this removes is reproduced by the next `dev`/`build`. Nothing it
 * removes is user data: `node_modules` itself, the pnpm store, `.git`, an
 * app's `data/` directory, and `.env*` are never candidates (see
 * `PROTECTED_NAMES` and `isSafeTarget`), every target is a real directory
 * entry read from disk and re-verified immediately before the delete (see
 * `addTarget` and `verifyTargetUnchanged`), the root has to be a confirmed
 * Agent Native project root (see `checkProjectRoot`), and under `apps/` each
 * app has to confirm the same thing for itself (see `splitAppDirs`). Those
 * checks are the whole safety contract, not a nicety.
 *
 * The bytes are held to the matching rule: one is credited only where the run
 * observed it removed. Anything it could not observe — a tree another process
 * deleted first, a walk that hit an unreadable directory or a mount point, a
 * scan cut short by the depth cap — is a typed outcome, never a number.
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
  /** Absolute path under the root as the user named it, every segment taken
   * from a real directory entry. This is the one that gets printed. */
  path: string;
  /** `realpath` of the same directory — the one filesystem calls use. */
  realPath: string;
  /** Identity at scan time. Re-checked immediately before the delete, so a
   * parent swapped underneath us is a reported failure and not a delete
   * somewhere else. */
  dev: number;
  ino: number;
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

/**
 * Records a failure once. A single unreadable directory is reached three times
 * — by the cache walk, by the measure pass, and by the post-delete re-measure —
 * and three identical lines read as three separate problems.
 */
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
 * Protection matches case-insensitively while *target* matching stays
 * case-exact (see `resolveEntryPath`). That asymmetry looks inconsistent and
 * is the point: each direction is the one that fails safe. On a
 * case-insensitive filesystem `Data/` and `data/` are the same directory, so a
 * case-exact protection check descends into the app's data through the other
 * spelling; a case-insensitive target check deletes a hand-written `Build/`
 * under the `build` rule. Widening protection costs at most a cache that
 * survives a run. Widening targets costs files.
 */
function isProtectedName(name: string): boolean {
  const lower = name.toLowerCase();
  return PROTECTED_NAMES.has(lower) || lower.startsWith(".env");
}

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
 * may well be hand-written. Path segments rather than a joined string: each
 * one is matched against a directory entry, never assembled blind. */
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

/**
 * A backstop against a runaway walk, not a budget for real trees.
 *
 * The walk never descends a symlinked directory, so on a normal filesystem it
 * cannot cycle and this never fires; it exists for the pathological case a
 * FUSE or network mount can still present. The old 8 was sized for
 * `<workspace>/apps/<app>/packages/<pkg>/node_modules` and truncated in
 * silence, which is how a checked-in Rust build tree — `target/debug/build/
 * <crate>/out/build/…/CMakeFiles/…`, measured at 19 below a workspace root in
 * this repo — went missing from the totals with nothing said. Raising it to
 * clear that tree by a few levels just moves the same silence; the cap now
 * reports itself (see `walkForCaches`), so the right value is one no real tree
 * reaches, where firing means something is genuinely wrong.
 */
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

/**
 * Refuses anything outside `root` and anything named — or nested under —
 * a protected directory. `node_modules` is allowed as a parent segment
 * because that is exactly where the Vite and Nitro caches live.
 *
 * Both arguments must already be `realpath`-resolved: containment is decided
 * here by comparing strings, but the delete lands on an inode. A symlinked
 * `apps/`, app directory or `build/` is inside the root lexically and outside
 * it physically, so resolving before the compare is what makes this check
 * mean what it says.
 */
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
  /** False once any path could not be read. The total is then a floor, not a
   * measurement, and callers must not present it as one. */
  complete: boolean;
  /** Directories skipped because they sit on another filesystem. */
  mounts: string[];
}

/**
 * Every regular file under `dir` on device `device`, not following symlinks.
 *
 * Paths that cannot be read are recorded rather than counted as zero — an
 * under-reported scan is how a clean-looking total hides a directory nobody can
 * actually delete — and the walk stops at a mount point, because bytes on a
 * filesystem the project does not own are neither ours to count nor ours to
 * remove.
 */
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
    // Dirent flags come from lstat, so a symlinked directory lands here as a
    // symlink and is skipped — its bytes live somewhere we are not deleting.
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

/**
 * Walks one target, reporting anything it hits under the name the user typed.
 *
 * `walkFiles` is handed `realPath` because that is what the delete acts on,
 * but the cache walk reaches the same directory through `path`. Left alone,
 * one unreadable directory shows up as `/var/…/build` and `/private/var/…
 * /build` — two lines, two entries in the "N failure(s)" count, one problem.
 */
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
      // The errno message echoes the path the syscall got, so renaming only
      // the column leaves two lines that differ solely in which spelling of
      // one directory they quote.
      message: failure.message.replaceAll(target.realPath, target.path),
    });
  }
  result.mounts = result.mounts.map(named);
  return result;
}

/**
 * Fills in `bytes` for every target.
 *
 * Unlinking a hard link frees nothing while another link survives, so an inode
 * counts only when the number of links this run will delete equals its link
 * count. That covers the deploy layout the de-dup was written for — one bundle
 * hard-linked into `<app>-server`, `<app>-agent-background` and
 * `<app>-integration-recovery`, counted once — and the case it missed: a file
 * also linked from `node_modules/`, from `data/`, or from outside the root
 * counts zero, because deleting these copies returns zero bytes to the disk.
 * A category totalling less than the naive sum of its files is that number
 * being honest.
 *
 * Returns the targets that survive measurement: one holding a mount point is
 * dropped, because a recursive delete would take the mounted filesystem's
 * contents with it.
 */
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

/**
 * Bytes still on disk under one path after a delete threw, or `undefined` when
 * the walk could not read all of it. Deliberately not `measureTargets`: this
 * asks what survives here, not what the run frees.
 *
 * `undefined` is the whole point of the return type. A tree the re-measure
 * cannot read is not an empty tree, and the caller's `bytes - remaining` turns
 * a confident `0` into a full credit for a directory that never went away.
 */
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
  /** `realpath` of the scan root; every target is resolved and compared
   * against this one. */
  realRoot: string;
  /** Device the root lives on. The walk and the delete never leave it. */
  rootDev: number;
  /** Directories under `apps/` that are not Agent Native apps: never descended
   * into, never selected. */
  excluded: Set<string>;
  targets: CleanTarget[];
  failures: CleanFailure[];
}

/** True when `dir` is on the same filesystem as the root. A mount inside the
 * project is storage the project does not own, so the walk stops there — and
 * says so, because bytes it did not count are bytes it cannot report. */
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

/**
 * Walks `segments` one directory entry at a time, matching each name exactly
 * against what `readdir` reports.
 *
 * Joining the strings instead is what let a hand-written `Build/` be deleted
 * by the `build` rule on a case-insensitive filesystem — and then printed as
 * `build/`, a path that does not exist, by the dry run whose whole job was to
 * warn about it.
 */
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
      // Absent and unreadable are different answers: a project that never
      // deployed has no `.netlify/`, but one nobody can read is space we are
      // about to under-report.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        addFailure(failures, {
          path: dir,
          message: `could not read: ${errorMessage(err)}`,
        });
      }
      return null;
    }
    const entry = entries.find((candidate) => candidate.name === segment);
    // Dirent flags come from lstat, so a symlink named `build` is not a
    // directory here and never becomes a candidate.
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
  // realpath rules out a directory reached through a symlinked parent; the
  // dev/ino recorded here is what the delete re-checks.
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
    // No `apps/` is the normal single-app case; an `apps/` nobody can read is
    // a workspace silently scanned as one app, so it has to be reported.
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
    // Returning quietly here made a truncated scan indistinguishable from a
    // complete one: caches below the cap were absent from the totals, from the
    // target list, and from the failure count that exists to say so.
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

/** Drop targets nested inside another target so bytes are counted, and
 * deleted, exactly once. */
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
  /** Also select build outputs and deploy bundles, which need a rebuild. */
  builds?: boolean;
}

export interface CleanScan {
  scope: "workspace" | "app";
  /** `realpath` of the scan root, so the delete can re-check containment
   * without resolving it again. */
  realRoot: string;
  targets: CleanTarget[];
  failures: CleanFailure[];
}

interface AppDirs {
  /** Directly under `apps/`, and confirmed Agent Native. */
  agentNative: string[];
  /** Directly under `apps/`, and not. */
  foreign: string[];
}

/**
 * Splits `apps/` into the apps this command may clean and the ones it may not.
 *
 * One Agent Native app under `apps/` authorizes cleaning *that app*, not its
 * neighbours: `build/`, `dist/` and `.output/` are ordinary directory names,
 * and a workspace can hold a Rust project or a personal folder beside the app.
 * This is `checkProjectRoot`'s question asked one level down, and the reason
 * that comment's claim about "the only part of a workspace this command ever
 * cleans" is true.
 */
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
        message: `could not be read (${marker.message}), so ${dir} is not treated as an Agent Native app`,
      });
    }
    dirs.foreign.push(dir);
  }
  return dirs;
}

/** Selects what `clean` would remove. Reads only — no deletes. */
export function scanCleanTargets(options: ScanCleanOptions): CleanScan {
  const root = path.resolve(options.root);
  let realRoot: string;
  let rootDev: number;
  try {
    realRoot = fs.realpathSync(root);
    rootDev = fs.statSync(realRoot).dev;
  } catch (err) {
    // Without a resolved root nothing can be shown to be inside it, so this is
    // a reported failure, not an empty scan. No targets accompany it, so the
    // unresolved `realRoot` below is never used to authorize anything.
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

  // Measure after the nested ones are dropped: a dropped target would
  // otherwise claim the inodes its survivor has to count.
  const targets = measureTargets(dropNested(ctx.targets), ctx.failures);

  return { scope, realRoot, targets, failures: ctx.failures };
}

export interface PerformCleanOptions extends ScanCleanOptions {
  /** Delete. Without it nothing is touched and `bytesReclaimed` stays 0. */
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
      // Not a skip and not a quiet success: something moved under a path this
      // run was about to delete recursively. `remainingBytes` stays absent —
      // the path no longer names what was measured, so there is no honest
      // number to give.
      addFailure(failures, { path: target.path, message: check.reason });
      continue;
    }
    // Already removed by someone else: nothing to do, and nothing to credit.
    if (check.kind === "gone") continue;
    try {
      // No `force`. `force` swallows ENOENT, and ENOENT here is the only signal
      // that another process — a second `clean`, or Vite recreating `.vite`
      // mid re-optimize — freed this tree first. Swallowed, both runs credit
      // the same bytes and report a total larger than the disk ever held.
      fs.rmSync(target.realPath, { recursive: true });
      entry.reclaimed += target.bytes;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      // A recursive rm can throw after already freeing part of the tree, so
      // re-measure. `undefined` means the re-measure could not read what is
      // left: unknown is not zero, and `bytes - 0` would credit the whole
      // target while every byte of it is still on disk.
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

/** One path per line, so a directory name containing a newline would print as
 * two — the second looking like a separate top-level path being deleted. */
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

  // `formatBytes` rounds, so a partial run printed as "X of X" — the headline
  // read as success while the failure block below contradicted it. The
  // shortfall is exact for the same reason: it is the number that rounded away.
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

/**
 * Is `dir` an Agent Native app root? Three answers, never two: the manifest
 * says yes, the manifest says no, or nobody could read the manifest.
 */
function readAgentNativeMarker(dir: string): MarkerCheck {
  for (const file of ["agent-native.json", "package.json"]) {
    const filePath = path.join(dir, file);
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      // EACCES, EISDIR and a zero-byte read are all "cannot tell"; only ENOENT
      // means the marker is genuinely absent and the next file can be tried.
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
 * accepted only when an app under `apps/` actually is Agent Native, which is
 * also the only part of a workspace this command ever cleans.
 */
function checkProjectRoot(
  root: string,
): { ok: true } | { ok: false; reason: string } {
  const marker = readAgentNativeMarker(root);
  if (marker.kind === "unreadable") {
    return {
      ok: false,
      reason: `${marker.path} could not be read (${marker.message}), so this cannot be confirmed as an Agent Native project.`,
    };
  }
  if (marker.kind === "agent-native") return { ok: true };
  // Same list the scan selects from, so the permission and the blast radius
  // cannot drift apart.
  if (splitAppDirs(root, []).agentNative.length > 0) return { ok: true };
  return {
    ok: false,
    reason:
      "no package.json depending on @agent-native/core, no agent-native.json, and no apps/* with either, so this is not the root of an Agent Native project.",
  };
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
    // --json is a promise about every other exit path; help was the one that
    // answered with prose regardless of it.
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
