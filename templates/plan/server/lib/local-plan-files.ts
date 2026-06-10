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
import fs from "node:fs/promises";
import path from "node:path";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
  type PlanMdxFolder,
} from "../plan-mdx.js";
import type { PlanContent } from "../../shared/plan-content.js";

const PLAN_FOLDER_TITLE_LIMIT = 64;

export interface LocalPlanWriteInput {
  planId: string;
  title: string;
  brief?: string | null;
  content: PlanContent | null | undefined;
  url?: string;
}

export interface LocalPlanReadResult {
  slug: string;
  folder: string;
  mdx: PlanMdxFolder;
  content: PlanContent;
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
      resolved.existingFolders
        .filter((existingFolder) => existingFolder !== folder)
        .map((existingFolder) =>
          fs.rm(existingFolder, { recursive: true, force: true }),
        ),
    );

    return { written: true, folder, files: written };
  } catch {
    // Read-only FS, permissions, or a sandboxed runtime: never break the
    // underlying plan operation just because the local mirror failed.
    return { written: false, folder, files: [] };
  }
}

export async function readPlanLocalFolder(
  slug: string,
): Promise<LocalPlanReadResult> {
  const safeSlug = assertLocalPlanSlug(slug);
  const folder = assertInsideLocalPlansDir(
    path.join(localPlansDir(), safeSlug),
  );
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
    slug: safeSlug,
    folder,
    mdx,
    content: await parsePlanMdxFolder(mdx),
  };
}
