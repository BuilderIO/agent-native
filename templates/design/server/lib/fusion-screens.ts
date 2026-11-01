import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFramePlacement,
} from "../../shared/canvas-frames.js";
import { parseDesignDataBlob } from "../../shared/full-app.js";
import { getDb, schema } from "../db/index.js";
import { withDesignSourceMutationTransaction } from "../source-workspace.js";
import { mutateDesignData } from "./design-data-mutation.js";

const PATH_BASE_PLACEHOLDER = "http://fusion-screen-base.invalid";

export const DEFAULT_FUSION_SCREEN_WIDTH = 1280;
export const DEFAULT_FUSION_SCREEN_HEIGHT = 900;

export interface FusionScreenResult {
  fileId: string;
  filename: string;
  path: string;
  url: string;
  title: string;
  width: number;
  height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function slugForPath(path: string): string {
  const slug = path
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (slug || "home").slice(0, 80);
}

function titleFromPath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "Home";
  const last = trimmed.split("/").pop() ?? trimmed;
  return last.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A screen is named after its route ("home.html" shows as "Home"). */
function screenFilename(path: string): string {
  return `${slugForPath(path)}.html`;
}

/** Earlier screens were saved as "fusion-home.html"; they are renamed on sync. */
function legacyScreenFilename(path: string): string {
  return `fusion-${slugForPath(path)}.html`;
}

/**
 * An app screen file holds only the screen's URL. A design can also have its
 * own authored file with the same name (a user's "home.html"); sync must
 * never adopt and overwrite that, so it gets a unique name instead.
 */
function isAppScreenFile(file: { content: string | null }): boolean {
  return /^(?:https?:\/\/\S+|\/\S*)$/.test((file.content ?? "").trim());
}

function uniqueFilename(path: string, used: Set<string>): string {
  const base = screenFilename(path);
  const [stem, extension = "html"] = base.split(/\.(?=[^.]+$)/);
  let filename = `${stem}.${extension}`;
  let suffix = 2;
  while (used.has(filename)) {
    filename = `${stem}-${suffix}.${extension}`;
    suffix += 1;
  }
  used.add(filename);
  return filename;
}

function isBound(
  current: Record<string, unknown>,
  screens: readonly FusionScreenResult[],
): boolean {
  const frames = parseCanvasFrameGeometryById(current.canvasFrames);
  const metadata = isRecord(current.screenMetadata)
    ? current.screenMetadata
    : {};
  return screens.every((screen) => {
    const entry = metadata[screen.fileId];
    return (
      Boolean(frames[screen.fileId]) &&
      isRecord(entry) &&
      entry.sourceType === "fusion" &&
      entry.previewState === "live" &&
      entry.url === screen.url &&
      entry.previewUrl === screen.url &&
      entry.path === screen.path
    );
  });
}

async function designHasBinding(
  designId: string,
  screens: readonly FusionScreenResult[],
): Promise<boolean> {
  const access = await resolveAccess("design", designId);
  if (!access) return false;
  const design = access.resource as typeof schema.designs.$inferSelect;
  return isBound(parseDesignDataBlob(design.data), screens);
}

export async function upsertFusionScreens(args: {
  designId: string;
  previewUrl: string;
  paths: string[];
  width?: number;
  height?: number;
  startX?: number;
  startY?: number;
  gap?: number;
}): Promise<{
  screens: FusionScreenResult[];
  placedFrames: Array<{
    fileId: string;
    filename?: string;
    frame: CanvasFramePlacement;
  }>;
}> {
  const {
    designId,
    previewUrl,
    paths,
    width = DEFAULT_FUSION_SCREEN_WIDTH,
    height = DEFAULT_FUSION_SCREEN_HEIGHT,
    startX = 0,
    startY = 0,
    gap = 160,
  } = args;

  if (paths.length === 0) {
    throw new Error("At least one path is required to add fusion screens.");
  }

  const db = getDb();
  const existingFiles = await db
    .select()
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));
  const existingByFilename = new Map(
    existingFiles.map((file) => [file.filename, file]),
  );
  const usedFilenames = new Set(existingFiles.map((file) => file.filename));
  const now = new Date().toISOString();

  const results: FusionScreenResult[] = [];
  let filesUnchanged = true;

  const originRelativeBase = previewUrl.startsWith("/");
  const baseWithSlash = previewUrl.endsWith("/")
    ? previewUrl
    : `${previewUrl}/`;
  const resolutionBase = originRelativeBase
    ? new URL(baseWithSlash, PATH_BASE_PLACEHOLDER).toString()
    : baseWithSlash;

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    const screenUrl = new URL(path.replace(/^\/+/, ""), resolutionBase);
    let url = originRelativeBase
      ? `${screenUrl.pathname}${screenUrl.search}`
      : screenUrl.toString();
    const preferredFilename = screenFilename(path);
    // By name first; then by URL, which finds a screen that had to take a
    // suffixed name (home-2.html) because a user's file held the name.
    let existing =
      [preferredFilename, legacyScreenFilename(path)]
        .map((name) => existingByFilename.get(name))
        .find((file) => file !== undefined && isAppScreenFile(file)) ??
      existingFiles.find(
        (file) => isAppScreenFile(file) && (file.content ?? "").trim() === url,
      );
    const renameLegacy =
      existing !== undefined &&
      existing.filename !== preferredFilename &&
      !usedFilenames.has(preferredFilename);
    if (renameLegacy) usedFilenames.add(preferredFilename);
    let filename = renameLegacy
      ? preferredFilename
      : (existing?.filename ?? uniqueFilename(path, usedFilenames));
    let fileId = existing?.id ?? nanoid();
    const title = titleFromPath(path);

    // Re-binding an unchanged screen writes nothing: every write makes open
    // editors refetch the design.
    const unchanged =
      existing !== undefined &&
      existing.filename === filename &&
      existing.content.trim() === url;
    if (!unchanged) filesUnchanged = false;
    if (existing && !unchanged) {
      const updated = await withDesignSourceMutationTransaction(
        designId,
        async (tx) => {
          const [current] = await tx
            .select({ id: schema.designFiles.id })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.id, existing!.id),
                eq(schema.designFiles.designId, designId),
              ),
            )
            .limit(1);
          if (!current) return false;
          await tx
            .update(schema.designFiles)
            .set({ filename, content: url, fileType: "html", updatedAt: now })
            .where(eq(schema.designFiles.id, existing!.id));
          return true;
        },
      );
      if (updated) {
        if (await hasCollabState(existing.id)) {
          await applyText(existing.id, url, "content", "agent");
        } else {
          await seedFromText(existing.id, url);
        }
      } else {
        existing = undefined;
        fileId = nanoid();
      }
    }
    if (!existing) {
      // Under the design's lock, so a bind running at the same time (the
      // open and the editor's first sync) can't insert this screen twice,
      // even with a different URL: it is matched by URL or by name.
      const racedFile = await withDesignSourceMutationTransaction(
        designId,
        async (tx) => {
          const rows = await tx
            .select({
              id: schema.designFiles.id,
              filename: schema.designFiles.filename,
              content: schema.designFiles.content,
            })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                or(
                  eq(schema.designFiles.content, url),
                  eq(schema.designFiles.filename, filename),
                ),
              ),
            )
            .limit(1);
          const raced = rows[0] as (typeof rows)[number] | undefined;
          if (raced && isAppScreenFile(raced)) return raced;
          // A user's own file that took the name meanwhile is never adopted:
          // the screen gets a fresh name instead.
          if (raced) {
            usedFilenames.add(raced.filename);
            filename = uniqueFilename(path, usedFilenames);
          }
          await tx.insert(schema.designFiles).values({
            id: fileId,
            designId,
            filename,
            fileType: "html",
            content: url,
            createdAt: now,
            updatedAt: now,
          });
          return null;
        },
      );
      if (racedFile) {
        // Taken as it is, URL included, so its file and metadata agree; a
        // later sync re-points it if this bind's URL was the newer one.
        fileId = racedFile.id;
        filename = racedFile.filename;
        url = racedFile.content.trim();
      } else {
        await seedFromText(fileId, url);
      }
    }

    results.push({ fileId, filename, path, url, title, width, height });
  }

  // Re-opening an app whose screens are already placed writes nothing.
  if (filesUnchanged && (await designHasBinding(designId, results))) {
    return { screens: results, placedFrames: [] };
  }

  let placedFrames: Array<{
    fileId: string;
    filename?: string;
    frame: CanvasFramePlacement;
  }> = [];
  await mutateDesignData({
    designId,
    mutate: (current, { updatedAt }) => {
      const currentFrames = parseCanvasFrameGeometryById(current.canvasFrames);
      const existingGeometries = Object.values(currentFrames);
      let nextX = startX;
      if (existingGeometries.length > 0) {
        nextX =
          Math.max(
            startX,
            ...existingGeometries.map(
              (frame) => (frame.x ?? 0) + (frame.width ?? width),
            ),
          ) + gap;
      }

      const placements: CanvasFramePlacement[] = [];
      for (const screen of results) {
        if (currentFrames[screen.fileId]) continue;
        placements.push({
          fileId: screen.fileId,
          filename: screen.filename,
          x: nextX,
          y: startY,
          width,
          height,
          z: placements.length,
        });
        nextX += width + gap;
      }
      const mergedFrames = mergeCanvasFramePlacements({
        existing: current.canvasFrames,
        placements,
        resolveFileId: (placement) => placement.fileId,
      });
      placedFrames = mergedFrames.placedFrames;

      const metadata = isRecord(current.screenMetadata)
        ? { ...current.screenMetadata }
        : {};
      for (const screen of results) {
        const candidate = metadata[screen.fileId];
        const previous: Record<string, unknown> = isRecord(candidate)
          ? candidate
          : {};
        metadata[screen.fileId] = {
          ...previous,
          sourceType: "fusion",
          previewState: "live",
          title: previous.title ?? screen.title,
          width: previous.width ?? screen.width,
          height: previous.height ?? screen.height,
          url: screen.url,
          previewUrl: screen.url,
          path: screen.path,
        };
      }

      return {
        ...current,
        canvasFrames: mergedFrames.canvasFrames,
        screenMetadata: metadata,
        updatedAt,
      };
    },
    isApplied: (current) => isBound(current, results),
  });

  return { screens: results, placedFrames };
}
