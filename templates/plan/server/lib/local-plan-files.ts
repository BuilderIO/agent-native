/**
 * Local file sync for the no-login local mode.
 *
 * In local mode, created and updated plans are written to the repo as MDX so
 * that "synced to local files" is literally true and the plan is round-trippable
 * with `import-visual-plan-source` / `patch-visual-plan-source`.
 *
 * Layout (per plan), under the local plans directory:
 *
 *   <dir>/<plan-title-slug>/plan.mdx
 *   <dir>/<plan-title-slug>/canvas.mdx       (when present)
 *   <dir>/<plan-title-slug>/prototype.mdx    (when present)
 *   <dir>/<plan-title-slug>/.plan-state.json (when present)
 *
 * If another plan already owns that folder name, the mirror appends a human
 * numeric suffix such as `checkout-review-flow-2`.
 *
 * The directory is, in priority order:
 *   1. `PLAN_LOCAL_DIR` env var (absolute or relative to cwd).
 *   2. `<cwd>/plans` (the running app/template directory in `agent-native dev`).
 *
 * Writes are idempotent: the same plan content always produces the same files.
 * Hosted behavior is unchanged — callers only invoke this when
 * `isLocalPlanRuntime()` is true, and any filesystem error is swallowed so a
 * read-only or sandboxed environment never breaks a plan mutation.
 */

import type { Dirent } from "node:fs";
import * as fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
  type PlanMdxFolder,
} from "../plan-mdx.js";
import type { PlanContent } from "../../shared/plan-content.js";

const PLAN_FOLDER_TITLE_LIMIT = 64;
const AGENT_NATIVE_MANIFEST_FILE = "agent-native.json";
const DEFAULT_REPO_PLANS_PATH = "plans";

export interface LocalPlanWriteInput {
  planId: string;
  title: string;
  brief?: string | null;
  content: PlanContent | null | undefined;
  url?: string;
}

export interface LocalPlanFolderWriteInput extends LocalPlanWriteInput {
  slug: string;
  path?: string | null;
}

export interface LocalPlanReadResult {
  slug: string;
  folder: string;
  repoPath: string | null;
  routePath: string;
  url: string;
  suggestedRepoPath: string;
  mdx: PlanMdxFolder;
  content: PlanContent;
}

export interface LocalPlanLocationInput {
  slug: string;
  path?: string | null;
}

export interface LocalPlanPromoteInput extends LocalPlanLocationInput {
  targetPath?: string | null;
  overwrite?: boolean;
}

/** Absolute path to the local plans directory for this process. */
export function localPlansDir(): string {
  const configured = process.env.PLAN_LOCAL_DIR;
  if (configured && configured.trim().length > 0) {
    return path.resolve(process.cwd(), configured.trim());
  }
  return path.resolve(process.cwd(), "plans");
}

function sanitizeLegacyPlanId(planId: string): string {
  return planId.replace(/[\\/]/g, "_");
}

export function localPlanFolderName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PLAN_FOLDER_TITLE_LIMIT)
    .replace(/-+$/g, "");
  return slug || "untitled-plan";
}

function normalizeSlash(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function assertLocalPlanRelativePath(
  filePath: string,
  label = "Local plan path",
): string {
  const raw = filePath.trim();
  if (!raw) throw new Error(`${label} is required.`);
  if (raw.includes("\0")) {
    throw new Error(`${label} must not contain null bytes.`);
  }
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error(`${label} must be relative to the repo.`);
  }
  const normalized = path.posix
    .normalize(normalizeSlash(raw))
    .replace(/\/+$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return normalized;
}

/** Absolute path to a single plan's local folder. */
export function localPlanFolder(planId: string, title?: string): string {
  return path.join(
    localPlansDir(),
    title ? localPlanFolderName(title) : sanitizeLegacyPlanId(planId),
  );
}

export function assertLocalPlanSlug(slug: string): string {
  const normalized = slug.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(
      "Local plan slug may only contain letters, numbers, dots, underscores, and dashes.",
    );
  }
  return normalized;
}

function assertInsideLocalPlansDir(folder: string): string {
  const root = path.resolve(localPlansDir());
  const resolved = path.resolve(folder);
  const relative = path.relative(root, resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  throw new Error("Local plan path escaped PLAN_LOCAL_DIR.");
}

function canonicalPathForContainment(target: string): string {
  let current = path.resolve(target);
  const missingSegments: string[] = [];

  while (!fsSync.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(target);
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  return path.join(fsSync.realpathSync.native(current), ...missingSegments);
}

function firstEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function findUpward(startDir: string, filename: string): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, filename);
    if (fsSync.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function localPlanRepoRoot(): string {
  const configuredRoot = process.env.PLAN_REPO_ROOT?.trim();
  if (configuredRoot) return path.resolve(process.cwd(), configuredRoot);

  const configuredManifest = firstEnvValue([
    "AGENT_NATIVE_MANIFEST",
    "AGENT_NATIVE_MANIFEST_PATH",
  ]);
  if (configuredManifest) {
    return path.dirname(path.resolve(process.cwd(), configuredManifest));
  }

  const manifestPath = findUpward(process.cwd(), AGENT_NATIVE_MANIFEST_FILE);
  if (manifestPath) return path.dirname(manifestPath);

  const gitDir = findUpward(process.cwd(), ".git");
  if (gitDir) return path.dirname(gitDir);

  return path.resolve(process.cwd());
}

function assertInsideRepoRoot(folder: string): string {
  const root = canonicalPathForContainment(localPlanRepoRoot());
  const resolved = path.resolve(folder);
  const containmentPath = canonicalPathForContainment(resolved);
  const relative = path.relative(root, containmentPath);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  throw new Error("Local plan path escaped the repo root.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function manifestRootPath(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRecord(value) && typeof value.path === "string" && value.path.trim()) {
    return value.path.trim();
  }
  return null;
}

async function configuredRepoPlansPath(): Promise<string> {
  const manifestPath = path.join(
    localPlanRepoRoot(),
    AGENT_NATIVE_MANIFEST_FILE,
  );
  try {
    const parsed = JSON.parse(
      await fs.readFile(manifestPath, "utf-8"),
    ) as unknown;
    const apps = isRecord(parsed) && isRecord(parsed.apps) ? parsed.apps : null;
    const planApp = apps && isRecord(apps.plan) ? apps.plan : null;
    const roots = planApp && Array.isArray(planApp.roots) ? planApp.roots : [];
    const configured = roots
      .map(manifestRootPath)
      .find((item): item is string => Boolean(item));
    if (configured) {
      return assertLocalPlanRelativePath(configured, "apps.plan.roots[0].path");
    }
  } catch {
    // Missing or invalid manifests fall back to the long-standing local default.
  }
  return DEFAULT_REPO_PLANS_PATH;
}

export async function defaultLocalPlanRepoPath(slug: string): Promise<string> {
  const safeSlug = assertLocalPlanSlug(slug);
  return path.posix.join(await configuredRepoPlansPath(), safeSlug);
}

function localPlanRoutePath(slug: string, repoPath?: string | null): string {
  const pathPart = `/local-plans/${encodeURIComponent(slug)}`;
  if (!repoPath) return pathPart;
  const params = new URLSearchParams({ path: repoPath });
  return `${pathPart}?${params.toString()}`;
}

function resolveLocalPlanLocation(input: string | LocalPlanLocationInput): {
  slug: string;
  folder: string;
  repoPath: string | null;
} {
  const source =
    typeof input === "string" ? { slug: input, path: null } : input;
  const safeSlug = assertLocalPlanSlug(source.slug);
  if (source.path?.trim()) {
    const repoPath = assertLocalPlanRelativePath(source.path);
    return {
      slug: safeSlug,
      folder: assertInsideRepoRoot(path.join(localPlanRepoRoot(), repoPath)),
      repoPath,
    };
  }
  return {
    slug: safeSlug,
    folder: assertInsideLocalPlansDir(path.join(localPlansDir(), safeSlug)),
    repoPath: null,
  };
}

function resolveRepoRelativePlanFolder(repoPath: string): {
  repoPath: string;
  folder: string;
} {
  const safePath = assertLocalPlanRelativePath(repoPath);
  return {
    repoPath: safePath,
    folder: assertInsideRepoRoot(path.join(localPlanRepoRoot(), safePath)),
  };
}

function frontmatterContainsPlanId(source: string, planId: string): boolean {
  const escaped = planId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^planId:\\s*["']${escaped}["']\\s*$`, "m").test(source);
}

async function folderReferencesPlanId(folder: string, planId: string) {
  try {
    const planMdx = await fs.readFile(path.join(folder, "plan.mdx"), "utf-8");
    if (frontmatterContainsPlanId(planMdx, planId)) return true;
  } catch {
    // Missing or unreadable plan.mdx: try state as a fallback.
  }

  try {
    const state = JSON.parse(
      await fs.readFile(path.join(folder, ".plan-state.json"), "utf-8"),
    ) as { planId?: unknown };
    return state.planId === planId;
  } catch {
    return false;
  }
}

async function findExistingLocalPlanFoldersFromEntries(
  planId: string,
  entries: Dirent[],
): Promise<string[]> {
  const dir = localPlansDir();
  const folders: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(dir, entry.name);
    if (
      entry.name === sanitizeLegacyPlanId(planId) ||
      (await folderReferencesPlanId(folder, planId))
    ) {
      folders.push(folder);
    }
  }
  return folders;
}

async function resolveLocalPlanFolderForWrite(
  planId: string,
  title: string,
): Promise<{ folder: string; existingFolders: string[] }> {
  const dir = localPlansDir();
  const baseName = localPlanFolderName(title);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return {
      folder: path.join(dir, baseName),
      existingFolders: [],
    };
  }

  const existingFolders = await findExistingLocalPlanFoldersFromEntries(
    planId,
    entries,
  );
  const occupied = new Map<string, boolean>();
  for (const entry of entries) {
    const folder = path.join(dir, entry.name);
    const currentPlanOwnsEntry =
      entry.isDirectory() &&
      (entry.name === sanitizeLegacyPlanId(planId) ||
        (await folderReferencesPlanId(folder, planId)));
    occupied.set(entry.name, currentPlanOwnsEntry);
  }

  for (let attempt = 1; ; attempt += 1) {
    const name = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const currentPlanOwnsName = occupied.get(name);
    if (currentPlanOwnsName !== false) {
      return {
        folder: path.join(dir, name),
        existingFolders,
      };
    }
  }
}

async function writePlanMdxFolderToDisk(
  folder: string,
  mdx: PlanMdxFolder,
  existingFolders: string[] = [],
): Promise<{ written: boolean; folder: string; files: string[] }> {
  await fs.mkdir(folder, { recursive: true });
  const written: string[] = [];

  // plan.mdx is always present.
  await fs.writeFile(path.join(folder, "plan.mdx"), mdx["plan.mdx"], "utf-8");
  written.push("plan.mdx");

  // canvas.mdx, prototype.mdx, and .plan-state.json are optional.
  if (mdx["canvas.mdx"]) {
    await fs.writeFile(
      path.join(folder, "canvas.mdx"),
      mdx["canvas.mdx"],
      "utf-8",
    );
    written.push("canvas.mdx");
  } else {
    // Remove a stale canvas file if the plan no longer has a board, so the
    // mirror stays an accurate round-trip of the current content.
    await fs.rm(path.join(folder, "canvas.mdx"), { force: true });
  }

  if (mdx["prototype.mdx"]) {
    await fs.writeFile(
      path.join(folder, "prototype.mdx"),
      mdx["prototype.mdx"],
      "utf-8",
    );
    written.push("prototype.mdx");
  } else {
    await fs.rm(path.join(folder, "prototype.mdx"), { force: true });
  }

  if (mdx[".plan-state.json"]) {
    await fs.writeFile(
      path.join(folder, ".plan-state.json"),
      mdx[".plan-state.json"],
      "utf-8",
    );
    written.push(".plan-state.json");
  } else {
    await fs.rm(path.join(folder, ".plan-state.json"), { force: true });
  }

  // Write binary assets to the local assets/ directory.
  const assetEntries = Object.entries(mdx["assets/"] ?? {});
  if (assetEntries.length > 0) {
    const assetsDir = path.join(folder, "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    for (const [filename, base64] of assetEntries) {
      // Sanitize: no path traversal, no absolute paths.
      const safe = path.basename(filename);
      if (!safe || safe !== filename) continue;
      const bytes = Buffer.from(base64, "base64");
      await fs.writeFile(path.join(assetsDir, safe), bytes);
      written.push(`assets/${safe}`);
    }
  }

  await Promise.all(
    existingFolders
      .filter((existingFolder) => existingFolder !== folder)
      .map((existingFolder) =>
        fs.rm(existingFolder, { recursive: true, force: true }),
      ),
  );

  return { written: true, folder, files: written };
}

async function clearExistingPlanMdxFolder(folder: string, targetPath: string) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const hasPlanMdx = entries.some(
    (entry) => entry.isFile() && entry.name === "plan.mdx",
  );
  if (!hasPlanMdx) {
    throw new Error(
      `${targetPath} already exists and does not look like a local Plan folder.`,
    );
  }

  await Promise.all([
    fs.rm(path.join(folder, "plan.mdx"), { force: true }),
    fs.rm(path.join(folder, "canvas.mdx"), { force: true }),
    fs.rm(path.join(folder, "prototype.mdx"), { force: true }),
    fs.rm(path.join(folder, ".plan-state.json"), { force: true }),
    fs.rm(path.join(folder, "assets"), { recursive: true, force: true }),
  ]);
}

/**
 * Write a plan's MDX folder to the local filesystem. Idempotent and best-effort:
 * filesystem errors are caught and returned as `{ written: false }` so a plan
 * mutation never fails just because the local mirror could not be written.
 */
export async function writePlanLocalFiles(
  input: LocalPlanWriteInput,
): Promise<{ written: boolean; folder: string; files: string[] }> {
  const resolved = await resolveLocalPlanFolderForWrite(
    input.planId,
    input.title,
  );
  const folder = resolved.folder;
  try {
    const mdx = await exportPlanContentToMdxFolder({
      content: input.content,
      title: input.title,
      brief: input.brief,
      planId: input.planId,
      url: input.url ?? `/plans/${encodeURIComponent(input.planId)}`,
    });

    return await writePlanMdxFolderToDisk(
      folder,
      mdx,
      resolved.existingFolders,
    );
  } catch {
    // Read-only FS, permissions, or a sandboxed runtime: never break the
    // underlying plan operation just because the local mirror failed.
    return { written: false, folder, files: [] };
  }
}

/**
 * Write directly back to an already-opened local plan folder. Unlike the local
 * mirror path above, this preserves the folder slug even when the plan title
 * changes and lets filesystem errors surface to the caller.
 */
export async function writePlanLocalFolder(
  input: LocalPlanFolderWriteInput,
): Promise<{ written: boolean; folder: string; files: string[] }> {
  const location = resolveLocalPlanLocation(input);
  const mdx = await exportPlanContentToMdxFolder({
    content: input.content,
    title: input.title,
    brief: input.brief,
    planId: input.planId,
    url: input.url ?? localPlanRoutePath(location.slug, location.repoPath),
  });

  return await writePlanMdxFolderToDisk(location.folder, mdx);
}

export async function readPlanLocalFolder(
  input: string | LocalPlanLocationInput,
): Promise<LocalPlanReadResult> {
  const location = resolveLocalPlanLocation(input);
  const folder = location.folder;
  const planPath = path.join(folder, "plan.mdx");
  const planMdx = await fs.readFile(planPath, "utf-8");
  const mdx: PlanMdxFolder = { "plan.mdx": planMdx };

  for (const file of [
    "canvas.mdx",
    "prototype.mdx",
    ".plan-state.json",
  ] as const) {
    try {
      mdx[file] = await fs.readFile(path.join(folder, file), "utf-8");
    } catch {
      // Optional local source file.
    }
  }

  // Read local binary assets from the assets/ directory (if present).
  try {
    const assetsDir = path.join(folder, "assets");
    const entries = await fs.readdir(assetsDir, { withFileTypes: true });
    const assets: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const bytes = await fs.readFile(path.join(assetsDir, entry.name));
      assets[entry.name] = bytes.toString("base64");
    }
    if (Object.keys(assets).length > 0) {
      mdx["assets/"] = assets;
    }
  } catch {
    // assets/ directory absent or unreadable — skip.
  }

  return {
    slug: location.slug,
    folder,
    repoPath: location.repoPath,
    routePath: localPlanRoutePath(location.slug, location.repoPath),
    url: localPlanRoutePath(location.slug, location.repoPath),
    suggestedRepoPath: await defaultLocalPlanRepoPath(location.slug),
    mdx,
    content: await parsePlanMdxFolder(mdx),
  };
}

export async function promotePlanLocalFolder(
  input: LocalPlanPromoteInput,
): Promise<{
  source: LocalPlanReadResult;
  promoted: LocalPlanReadResult;
  targetPath: string;
  localFiles: { written: boolean; folder: string; files: string[] };
  alreadyPromoted: boolean;
}> {
  const source = await readPlanLocalFolder(input);
  const targetPath = input.targetPath?.trim()
    ? assertLocalPlanRelativePath(input.targetPath, "Target path")
    : await defaultLocalPlanRepoPath(source.slug);
  const target = resolveRepoRelativePlanFolder(targetPath);
  const alreadyPromoted = path.resolve(source.folder) === target.folder;

  if (!alreadyPromoted) {
    try {
      const existing = await fs.readdir(target.folder);
      if (existing.length > 0 && !input.overwrite) {
        throw new Error(
          `${targetPath} already exists. Choose a different path or allow overwrite.`,
        );
      }
      if (input.overwrite) {
        await clearExistingPlanMdxFolder(target.folder, targetPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const localFiles = alreadyPromoted
    ? {
        written: true,
        folder: target.folder,
        files: Object.keys(source.mdx).flatMap((file) =>
          file === "assets/"
            ? Object.keys(source.mdx["assets/"] ?? {}).map(
                (name) => `assets/${name}`,
              )
            : [file],
        ),
      }
    : await writePlanMdxFolderToDisk(target.folder, source.mdx);

  const promoted = await readPlanLocalFolder({
    slug: source.slug,
    path: target.repoPath,
  });

  return {
    source,
    promoted,
    targetPath: target.repoPath,
    localFiles,
    alreadyPromoted,
  };
}
