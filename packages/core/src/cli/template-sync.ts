/**
 * `agent-native template` — pull later upstream template changes into an app
 * that was generated from a first-party template.
 *
 * The model is a real 3-way merge:
 *
 *   base   = the pristine upstream tree the app was generated from
 *            (stored as a git ref, see template-baseline.ts)
 *   theirs = the same template re-materialized at a newer ref, through the
 *            exact transform pipeline `create` runs
 *   ours   = the app's working tree
 *
 * Materialization fidelity is the whole feature: any divergence from what
 * `create` produced turns into phantom conflicts on every sync, so this file
 * reuses `create.ts`'s own transforms rather than reimplementing them.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  detectWorkspace,
  _REPO,
  _TEMPLATES_DIR,
  _appTitleForScaffold,
  _copyDir,
  _downloadGitHubSubdir,
  _findLocalTemplate,
  _fixPackageJsonName,
  _fixWebManifestName,
  _getCoreDependencyVersion,
  _getCorePackageVersion,
  _getDispatchDependencyVersion,
  _getGitHubTemplateRefCandidates,
  _getToolkitDependencyVersion,
  _localTemplateSourceKind,
  _normalizeTemplateName,
  _postProcessStandalone,
  _renameGitignore,
  _replacePlaceholders,
  _rewriteNetlifyToml,
  _rewriteTrackingAppId,
  _shouldSkipScaffoldEntry,
  _templateSourceName,
} from "./create.js";
import {
  appDirtyPaths,
  baselineDescription,
  baselineExists,
  clearBaseline,
  materializeBaseline,
  promoteBaseline,
  resolveBaselineStore,
  writeBaseline,
} from "./template-baseline.js";
import { workspacifyApp } from "./workspacify.js";

export interface TemplateIO {
  out: (message: string) => void;
  err: (message: string) => void;
}

const defaultIO: TemplateIO = {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
};

const CONFLICT_MARKER = "<<<<<<<";

/** Never merged: user secrets, lockfiles, generated output, personal memory. */
const NEVER_TOUCH_NAMES = new Set([
  ".git",
  "learnings.md",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
]);

export interface TemplateProvenance {
  template?: string;
  frameworkSkills?: string;
  templateRef?: string;
  templateSource?: "github" | "bundled" | "local-checkout";
  coreVersion?: string;
  shape?: "workspace" | "standalone";
}

export interface AppTarget {
  appDir: string;
  appName: string;
  shape: "workspace" | "standalone";
  workspaceRoot?: string;
  workspaceCoreName?: string;
  provenance: TemplateProvenance;
}

export interface MaterializeOptions {
  appName: string;
  template: string;
  /** Git ref to fetch from, or null to use the bundled/local template copy. */
  ref: string | null;
  shape: "workspace" | "standalone";
  workspaceRoot?: string;
  workspaceCoreName?: string;
  destDir?: string;
}

export interface MaterializeResult {
  dir: string;
  ref: string;
  source: "github" | "bundled" | "local-checkout";
}

export interface TemplateMergeResult {
  added: string[];
  updated: string[];
  deleted: string[];
  conflicted: string[];
  manual: string[];
  keptLocal: string[];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Materialization
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Reproduce, in a temp directory, the exact bytes `create` would have written
 * for this (template, ref, app name, shape, workspace scope).
 */
export async function materializeTemplate(
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const dest =
    opts.destDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "an-template-new-"));
  fs.mkdirSync(dest, { recursive: true });

  const resolved = _normalizeTemplateName(opts.template);
  const sourceTemplate = _templateSourceName(resolved);
  const fallbackRef = _getGitHubTemplateRefCandidates()[0];

  let usedRef: string;
  let source: MaterializeResult["source"];
  if (opts.ref === null || resolved === "headless") {
    const local = _findLocalTemplate(
      resolved === "headless" ? "headless" : sourceTemplate,
    );
    if (!local) {
      throw new Error(
        `No local copy of the "${resolved}" template is available. Pass --to <ref> to fetch it from GitHub.`,
      );
    }
    _copyDir(local, dest);
    usedRef = opts.ref ?? fallbackRef ?? "unknown";
    source = _localTemplateSourceKind(local);
  } else {
    usedRef = await _downloadGitHubSubdir(
      _REPO,
      `${_TEMPLATES_DIR}/${sourceTemplate}`,
      dest,
      [opts.ref],
    );
    source = "github";
  }

  const provenance = { templateRef: usedRef, templateSource: source };

  if (opts.shape === "workspace") {
    if (!opts.workspaceRoot || !opts.workspaceCoreName) {
      throw new Error(
        "Workspace apps need a workspace root and shared package name to materialize.",
      );
    }
    _replacePlaceholders(
      dest,
      opts.appName,
      _appTitleForScaffold(opts.appName),
      path.basename(opts.workspaceRoot),
    );
    _rewriteTrackingAppId(dest, opts.appName, opts.template);
    workspacifyApp({
      appDir: dest,
      appName: opts.appName,
      templateName: opts.template,
      workspaceRoot: opts.workspaceRoot,
      workspaceCoreName: opts.workspaceCoreName,
      coreDependencyVersion: _getCoreDependencyVersion(),
      dispatchDependencyVersion: _getDispatchDependencyVersion(),
      toolkitDependencyVersion: _getToolkitDependencyVersion(),
    });
    _fixPackageJsonName(dest, opts.appName, opts.template, {
      ...provenance,
      shape: "workspace",
    });
    _fixWebManifestName(dest, opts.appName, opts.template);
    _rewriteNetlifyToml(dest, opts.appName, "workspace");
    _renameGitignore(dest);
  } else {
    _postProcessStandalone(opts.appName, dest, opts.template, provenance);
  }

  return { dir: dest, ref: usedRef, source };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Merge
 * ───────────────────────────────────────────────────────────────────────── */

export function isMergeExcluded(rel: string): boolean {
  const segments = rel.split("/");
  if (segments[0] === "changelog") return true;
  for (const name of segments) {
    if (!name || name === "." || name === "..") return true;
    if (NEVER_TOUCH_NAMES.has(name)) return true;
    if (name.startsWith(".env")) return true;
    if (_shouldSkipScaffoldEntry(name)) return true;
  }
  return false;
}

export function listMergeableFiles(root: string): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isMergeExcluded(rel)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) found.add(rel);
    }
  };
  walk(root, "");
  return found;
}

export function mergeTemplateTrees(
  appDir: string,
  baseDir: string,
  theirsDir: string,
  options: { dryRun?: boolean } = {},
): TemplateMergeResult {
  const result: TemplateMergeResult = {
    added: [],
    updated: [],
    deleted: [],
    conflicted: [],
    manual: [],
    keptLocal: [],
  };
  const paths = new Set<string>([
    ...listMergeableFiles(baseDir),
    ...listMergeableFiles(theirsDir),
    ...listMergeableFiles(appDir),
  ]);

  for (const rel of Array.from(paths).sort()) {
    const oursPath = path.join(appDir, rel);
    if (isLocalSymlink(oursPath)) {
      result.manual.push(`${rel} (local symlink)`);
      continue;
    }
    const base = readFileOrNull(path.join(baseDir, rel));
    const theirs = readFileOrNull(path.join(theirsDir, rel));
    const ours = readFileOrNull(oursPath);

    if (equalBuffers(base, theirs)) continue;

    if (theirs === null) {
      if (ours === null) continue;
      if (equalBuffers(ours, base)) {
        if (!options.dryRun) removeFile(oursPath);
        result.deleted.push(rel);
      } else {
        result.keptLocal.push(rel);
      }
      continue;
    }

    if (ours === null) {
      if (base === null) {
        if (!options.dryRun) writeFile(oursPath, theirs);
        result.added.push(rel);
      } else {
        result.manual.push(`${rel} (deleted locally, changed upstream)`);
      }
      continue;
    }

    if (equalBuffers(ours, theirs)) continue;
    if (equalBuffers(ours, base)) {
      if (!options.dryRun) writeFile(oursPath, theirs);
      result.updated.push(rel);
      continue;
    }

    if (!isTextBuffer(ours) || !isTextBuffer(theirs) || !isTextBuffer(base)) {
      result.manual.push(`${rel} (binary changed on both sides)`);
      continue;
    }

    const merged = gitMergeFile(ours, base ?? Buffer.alloc(0), theirs);
    if (!merged) {
      result.manual.push(`${rel} (merge failed)`);
      continue;
    }
    if (!options.dryRun) writeFile(oursPath, merged.content);
    if (merged.conflicts > 0) result.conflicted.push(rel);
    else result.updated.push(rel);
  }

  return result;
}

function gitMergeFile(
  ours: Buffer,
  base: Buffer,
  theirs: Buffer,
): { content: Buffer; conflicts: number } | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-template-merge-"));
  try {
    const oursFile = path.join(dir, "ours");
    const baseFile = path.join(dir, "base");
    const theirsFile = path.join(dir, "theirs");
    fs.writeFileSync(oursFile, ours);
    fs.writeFileSync(baseFile, base);
    fs.writeFileSync(theirsFile, theirs);
    const res = spawnSync(
      "git",
      [
        "merge-file",
        "-p",
        "-L",
        "ours",
        "-L",
        "base",
        "-L",
        "theirs",
        oursFile,
        baseFile,
        theirsFile,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    if (res.status === null || res.status < 0) return null;
    return { content: res.stdout as Buffer, conflicts: res.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Target resolution
 * ───────────────────────────────────────────────────────────────────────── */

export function readProvenance(appDir: string): TemplateProvenance {
  const pkg = readJson(path.join(appDir, "package.json"));
  const scaffold = (pkg?.["agent-native"] as Record<string, unknown> | undefined)
    ?.scaffold;
  if (!scaffold || typeof scaffold !== "object") return {};
  return scaffold as TemplateProvenance;
}

export function resolveTargets(cwd: string, appArg?: string): AppTarget[] {
  const workspace = detectWorkspace(cwd);

  if (appArg) {
    const candidates = [path.resolve(cwd, appArg)];
    if (workspace) candidates.push(path.join(workspace.workspaceRoot, "apps", appArg));
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        return [toTarget(candidate)];
      }
    }
    throw new Error(`No app found for "${appArg}".`);
  }

  const appDir = findAppDir(cwd);
  if (appDir) return [toTarget(appDir)];

  if (workspace && path.resolve(cwd) === workspace.workspaceRoot) {
    const appsDir = path.join(workspace.workspaceRoot, "apps");
    if (fs.existsSync(appsDir)) {
      const targets = fs
        .readdirSync(appsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(appsDir, entry.name))
        .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
        .map((dir) => toTarget(dir));
      if (targets.length > 0) return targets;
    }
  }

  throw new Error(
    "No Agent Native app found. Run from an app directory, or pass an app name from a workspace root.",
  );
}

function toTarget(appDir: string): AppTarget {
  const resolved = path.resolve(appDir);
  const provenance = readProvenance(resolved);
  const workspace = detectWorkspace(resolved);
  const insideWorkspaceApps =
    !!workspace &&
    path.dirname(resolved) === path.join(workspace.workspaceRoot, "apps");
  const shape =
    provenance.shape ?? (insideWorkspaceApps ? "workspace" : "standalone");
  return {
    appDir: resolved,
    appName: readAppName(resolved),
    shape,
    workspaceRoot: workspace?.workspaceRoot,
    workspaceCoreName: workspace?.workspaceCoreName,
    provenance,
  };
}

function readAppName(appDir: string): string {
  const pkg = readJson(path.join(appDir, "package.json"));
  const name = typeof pkg?.name === "string" ? pkg.name : "";
  return name || path.basename(appDir);
}

function findAppDir(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (let i = 0; i < 20; i++) {
    const pkg = readJson(path.join(dir, "package.json"));
    if (pkg) {
      const agentNative = pkg["agent-native"] as Record<string, unknown> | undefined;
      if (agentNative?.workspaceCore) return null;
      const deps = (pkg.dependencies ?? {}) as Record<string, string>;
      const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
      if (
        agentNative?.scaffold ||
        deps["@agent-native/core"] ||
        devDeps["@agent-native/core"]
      ) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Commands
 * ───────────────────────────────────────────────────────────────────────── */

export async function runTemplate(
  args: string[],
  io: TemplateIO = defaultIO,
): Promise<number> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.out(templateUsage());
    return command ? 0 : 1;
  }

  const rest = args.slice(1);
  const appArg = rest.find((arg) => !arg.startsWith("-"));
  const flags = {
    to: flagValue(rest, "--to"),
    ref: flagValue(rest, "--ref"),
    template: flagValue(rest, "--template"),
    dryRun: rest.includes("--dry-run"),
    force: rest.includes("--force"),
  };

  let targets: AppTarget[];
  try {
    targets = resolveTargets(process.cwd(), appArg);
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }

  let exitCode = 0;
  for (const target of targets) {
    try {
      const code = await runForTarget(command, target, flags, io);
      if (code !== 0) exitCode = code;
    } catch (err) {
      io.err(
        `${target.appName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      exitCode = 1;
    }
  }
  return exitCode;
}

interface TemplateFlags {
  to?: string;
  ref?: string;
  template?: string;
  dryRun: boolean;
  force: boolean;
}

async function runForTarget(
  command: string,
  target: AppTarget,
  flags: TemplateFlags,
  io: TemplateIO,
): Promise<number> {
  switch (command) {
    case "status":
      return statusCommand(target, flags, io);
    case "diff":
      return diffCommand(target, flags, io);
    case "sync":
      return syncCommand(target, flags, io);
    case "baseline":
      return baselineCommand(target, flags, io);
    case "accept":
      return acceptCommand(target, io);
    default:
      io.err(`Unknown template command "${command}".`);
      io.err(templateUsage());
      return 1;
  }
}

function templateName(target: AppTarget, flags: TemplateFlags): string {
  const name = flags.template ?? target.provenance.template;
  if (!name) {
    throw new Error(
      `${target.appName} has no recorded template. Pass --template <name> to record one.`,
    );
  }
  return name;
}

async function statusCommand(
  target: AppTarget,
  flags: TemplateFlags,
  io: TemplateIO,
): Promise<number> {
  const store = resolveBaselineStore(target.appDir);
  const latest = _getGitHubTemplateRefCandidates()[0] ?? "(unknown)";
  const lines = [
    `${target.appName} (${target.shape})`,
    `  template:       ${target.provenance.template ?? "(unrecorded)"}`,
    `  recorded ref:   ${target.provenance.templateRef ?? "(unrecorded)"}`,
    `  recorded source:${target.provenance.templateSource ? ` ${target.provenance.templateSource}` : " (unrecorded)"}`,
    `  latest ref:     ${flags.to ?? latest}`,
    `  baseline:       ${baselineDescription(store, "baseline") ?? "missing — run `agent-native template baseline`"}`,
  ];
  const pending = baselineDescription(store, "pending");
  if (pending) lines.push(`  pending accept: ${pending}`);

  const baseDir = materializeBaseline(store, "baseline");
  if (baseDir) {
    try {
      const local = countLocallyModified(target.appDir, baseDir);
      lines.push(`  locally modified files: ${local}`);
      const targetRef = flags.to ?? target.provenance.templateRef ?? latest;
      const theirs = await materializeForTarget(target, flags, targetRef);
      try {
        const changed = countUpstreamChanged(baseDir, theirs.dir);
        lines.push(`  upstream-changed files: ${changed} (at ${theirs.ref})`);
      } finally {
        fs.rmSync(theirs.dir, { recursive: true, force: true });
      }
    } catch (err) {
      lines.push(
        `  upstream-changed files: unavailable (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`,
      );
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  }

  io.out(lines.join("\n"));
  return 0;
}

async function diffCommand(
  target: AppTarget,
  flags: TemplateFlags,
  io: TemplateIO,
): Promise<number> {
  const store = resolveBaselineStore(target.appDir);
  const baseDir = materializeBaseline(store, "baseline");
  if (!baseDir) {
    io.err(
      `${target.appName}: no baseline recorded. Run \`agent-native template baseline ${target.appName}\` first.`,
    );
    return 1;
  }
  const theirs = await materializeForTarget(
    target,
    flags,
    flags.to ?? _getGitHubTemplateRefCandidates()[0] ?? null,
  );
  try {
    io.out(renderTreeDiff(baseDir, theirs.dir));
    return 0;
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(theirs.dir, { recursive: true, force: true });
  }
}

async function syncCommand(
  target: AppTarget,
  flags: TemplateFlags,
  io: TemplateIO,
): Promise<number> {
  const store = resolveBaselineStore(target.appDir);
  const baseDir = materializeBaseline(store, "baseline");
  if (!baseDir) {
    io.err(
      `${target.appName}: no baseline recorded. Run \`agent-native template baseline ${target.appName}\` first.`,
    );
    return 1;
  }

  const dirty = appDirtyPaths(store);
  if (dirty.length > 0 && !flags.force && !flags.dryRun) {
    fs.rmSync(baseDir, { recursive: true, force: true });
    io.err(
      "Sync refused because the app directory has uncommitted changes. Review this diff and preserve your edits before syncing, or pass --force.",
    );
    for (const line of dirty.slice(0, 20)) io.err(`  ${line}`);
    if (dirty.length > 20) io.err(`  … ${dirty.length - 20} more`);
    return 1;
  }

  const theirs = await materializeForTarget(
    target,
    flags,
    flags.to ?? _getGitHubTemplateRefCandidates()[0] ?? null,
  );
  try {
    const result = mergeTemplateTrees(target.appDir, baseDir, theirs.dir, {
      dryRun: flags.dryRun,
    });
    io.out(formatMergeResult(target, theirs.ref, result, flags.dryRun));

    if (flags.dryRun) return 0;

    const meta = {
      template: templateName(target, flags),
      templateRef: theirs.ref,
      coreVersion: _getCorePackageVersion(),
    };
    if (result.conflicted.length === 0 && result.manual.length === 0) {
      const written = writeBaseline(store, theirs.dir, "baseline", meta);
      clearBaseline(store, "pending");
      io.out(`Baseline advanced to ${written.location}.`);
      reportRefspecs(written.configuredRefspecs, io);
      return 0;
    }

    const written = writeBaseline(store, theirs.dir, "pending", meta);
    reportRefspecs(written.configuredRefspecs, io);
    io.out("");
    io.out(
      `Baseline not advanced — resolve the items above, then run:\n  agent-native template accept ${target.appName}`,
    );
    return 1;
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(theirs.dir, { recursive: true, force: true });
  }
}

async function baselineCommand(
  target: AppTarget,
  flags: TemplateFlags,
  io: TemplateIO,
): Promise<number> {
  const store = resolveBaselineStore(target.appDir);
  const name = templateName(target, flags);
  const ref =
    flags.ref ??
    target.provenance.templateRef ??
    _getGitHubTemplateRefCandidates()[0] ??
    null;
  const materialized = await materializeTemplate({
    appName: target.appName,
    template: name,
    ref: useLocalTemplate(target, ref) ? null : ref,
    shape: target.shape,
    workspaceRoot: target.workspaceRoot,
    workspaceCoreName: target.workspaceCoreName,
  });
  try {
    const written = writeBaseline(store, materialized.dir, "baseline", {
      template: name,
      templateRef: materialized.ref,
      coreVersion: _getCorePackageVersion(),
    });
    backfillProvenance(target, name, materialized);
    io.out(
      `${target.appName}: baseline recorded at ${written.location} (${name} @ ${materialized.ref}).`,
    );
    reportRefspecs(written.configuredRefspecs, io);
    return 0;
  } finally {
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
}

function acceptCommand(target: AppTarget, io: TemplateIO): number {
  const store = resolveBaselineStore(target.appDir);
  if (!baselineExists(store, "pending")) {
    io.err(`${target.appName}: nothing to accept — no pending sync recorded.`);
    return 1;
  }
  const markers = findConflictMarkers(target.appDir);
  if (markers.length > 0) {
    io.err(
      `${target.appName}: accept refused because conflict markers remain. Resolve them first:`,
    );
    for (const file of markers.slice(0, 20)) io.err(`  ${file}`);
    if (markers.length > 20) io.err(`  … ${markers.length - 20} more`);
    return 1;
  }
  promoteBaseline(store, "pending", "baseline");
  io.out(
    `${target.appName}: baseline advanced to the last synced template tree.`,
  );
  return 0;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────── */

function useLocalTemplate(target: AppTarget, ref: string | null): boolean {
  if (!ref) return true;
  const source = target.provenance.templateSource;
  if (source !== "bundled" && source !== "local-checkout") return false;
  return ref === target.provenance.templateRef;
}

async function materializeForTarget(
  target: AppTarget,
  flags: TemplateFlags,
  ref: string | null,
): Promise<MaterializeResult> {
  return materializeTemplate({
    appName: target.appName,
    template: templateName(target, flags),
    ref: useLocalTemplate(target, ref) ? null : ref,
    shape: target.shape,
    workspaceRoot: target.workspaceRoot,
    workspaceCoreName: target.workspaceCoreName,
  });
}

function backfillProvenance(
  target: AppTarget,
  template: string,
  materialized: MaterializeResult,
): void {
  const pkgPath = path.join(target.appDir, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) return;
  const agentNative =
    pkg["agent-native"] && typeof pkg["agent-native"] === "object"
      ? (pkg["agent-native"] as Record<string, unknown>)
      : {};
  const scaffold =
    agentNative.scaffold && typeof agentNative.scaffold === "object"
      ? (agentNative.scaffold as Record<string, unknown>)
      : {};
  agentNative.scaffold = {
    ...scaffold,
    template: scaffold.template ?? template,
    templateRef: materialized.ref,
    templateSource: materialized.source,
    coreVersion: _getCorePackageVersion(),
    shape: target.shape,
  };
  pkg["agent-native"] = agentNative;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function countLocallyModified(appDir: string, baseDir: string): number {
  let count = 0;
  for (const rel of listMergeableFiles(baseDir)) {
    const base = readFileOrNull(path.join(baseDir, rel));
    const ours = readFileOrNull(path.join(appDir, rel));
    if (!equalBuffers(base, ours)) count++;
  }
  return count;
}

function countUpstreamChanged(baseDir: string, theirsDir: string): number {
  const paths = new Set([
    ...listMergeableFiles(baseDir),
    ...listMergeableFiles(theirsDir),
  ]);
  let count = 0;
  for (const rel of paths) {
    const base = readFileOrNull(path.join(baseDir, rel));
    const theirs = readFileOrNull(path.join(theirsDir, rel));
    if (!equalBuffers(base, theirs)) count++;
  }
  return count;
}

function renderTreeDiff(baseDir: string, theirsDir: string): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "an-template-diff-"));
  try {
    const a = path.join(staging, "a");
    const b = path.join(staging, "b");
    copyMergeable(baseDir, a);
    copyMergeable(theirsDir, b);
    const res = spawnSync(
      "git",
      ["diff", "--no-index", "--no-prefix", "--", "a", "b"],
      { cwd: staging, encoding: "utf-8", maxBuffer: 128 * 1024 * 1024 },
    );
    const output = (res.stdout ?? "").toString();
    return output.trim()
      ? output.replace(/(^|\s)a\//gm, "$1upstream-base/").replace(
          /(^|\s)b\//gm,
          "$1upstream-new/",
        )
      : "No upstream changes.";
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function copyMergeable(from: string, to: string): void {
  for (const rel of listMergeableFiles(from)) {
    const dest = path.join(to, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(from, rel), dest);
  }
  fs.mkdirSync(to, { recursive: true });
}

function findConflictMarkers(appDir: string): string[] {
  const hits: string[] = [];
  for (const rel of listMergeableFiles(appDir)) {
    const buf = readFileOrNull(path.join(appDir, rel));
    if (!buf || !isTextBuffer(buf)) continue;
    if (buf.toString("utf-8").includes(`${CONFLICT_MARKER} `)) hits.push(rel);
  }
  return hits;
}

function formatMergeResult(
  target: AppTarget,
  ref: string,
  result: TemplateMergeResult,
  dryRun: boolean,
): string {
  const lines = [
    `${target.appName}: ${dryRun ? "would sync" : "synced"} template at ${ref}`,
    `  added:      ${result.added.length}`,
    `  updated:    ${result.updated.length}`,
    `  deleted:    ${result.deleted.length}`,
    `  conflicted: ${result.conflicted.length}`,
  ];
  for (const [label, items] of [
    ["added", result.added],
    ["updated", result.updated],
    ["deleted", result.deleted],
    ["conflicted", result.conflicted],
    ["manual", result.manual],
    ["kept local (deleted upstream)", result.keptLocal],
  ] as const) {
    if (items.length === 0) continue;
    lines.push(`  ${label}:`);
    for (const item of items) lines.push(`    ${item}`);
  }
  return lines.join("\n");
}

function reportRefspecs(configured: string[], io: TemplateIO): void {
  if (configured.length === 0) return;
  io.out(
    `Configured ${configured.join(" and ")} to carry refs/agent-native/* so the baseline survives clone and push.`,
  );
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function readFileOrNull(file: string): Buffer | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return null;
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

function isLocalSymlink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function writeFile(file: string, content: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function removeFile(file: string): void {
  fs.rmSync(file, { force: true });
}

function equalBuffers(a: Buffer | null, b: Buffer | null): boolean {
  if (a === null || b === null) return a === b;
  return a.equals(b);
}

function isTextBuffer(buf: Buffer | null): boolean {
  if (buf === null) return true;
  const isUtf8 = (Buffer as unknown as { isUtf8?: (b: Buffer) => boolean })
    .isUtf8;
  if (isUtf8) return isUtf8(buf) && !buf.includes(0);
  return !buf.includes(0);
}

function templateUsage(): string {
  return [
    "agent-native template <command> [app] [options]",
    "",
    "Pull later upstream first-party template changes into a generated app",
    "with a real 3-way merge against the tree it was scaffolded from.",
    "",
    "Commands:",
    "  status [app]            Recorded ref, latest ref, baseline health, change counts",
    "  diff [app] [--to <ref>] Unified diff of what upstream changed (read-only)",
    "  sync [app] [--to <ref>] 3-way merge upstream changes into the app",
    "                          [--dry-run] [--force]",
    "  baseline [app]          Record a baseline for an app scaffolded before",
    "                          provenance existed [--ref <ref>] [--template <name>]",
    "  accept [app]            Advance the baseline after resolving conflicts",
    "",
    "With no [app], operates on the current app, or on every app in a workspace",
    "when run from the workspace root. --to defaults to the ref matching the",
    "installed @agent-native/core, so `agent-native upgrade` then",
    "`agent-native template sync` is the coherent story.",
  ].join("\n");
}
