/**
 * fusion-screens — shared upsert logic for URL-backed screens on fusion
 * (full-app) designs.
 *
 * Fusion screens are iframes of the app's container dev-server preview URL,
 * the same rendering model as localhost screens (see `add-localhost-screens`)
 * but keyed off `fusionApp.previewUrl` instead of a localhost connection.
 * `screenMetadata[fileId]` is the single source the canvas reads to resolve
 * source/previewUrl/dimensions (see `resolveScreenMetadata` in
 * `MultiScreenCanvas.tsx`) — no parallel `fusionScreens` map is needed the way
 * `localhostScreens` exists for localhost (that map is only consulted by the
 * loopback-public-access heuristic in `server/db/index.ts`, which does not
 * apply to fusion designs).
 *
 * Both `sync-fusion-app` and `add-fusion-screens` call `upsertFusionScreens`
 * so the design_files + designs.data writes never diverge.
 */

import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFramePlacement,
} from "../../shared/canvas-frames.js";
import { getDb, schema } from "../db/index.js";
import { mutateDesignData } from "./design-data-mutation.js";

/** Default iframe viewport, mirroring add-localhost-screens' defaults. */
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

function uniqueFilename(path: string, used: Set<string>): string {
  const base = `fusion-${slugForPath(path)}.html`;
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

/**
 * Create or refresh URL-backed screens pointing at `<previewUrl><path>` for a
 * fusion-backed design. Read-modify-write on `designs.data`: preserves every
 * other key (canvasFrames for non-fusion screens, tweaks, etc.).
 */
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

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    const url = new URL(path, previewUrl).toString();
    const preferredFilename = `fusion-${slugForPath(path)}.html`;
    const existing = existingByFilename.get(preferredFilename);
    const filename = existing?.filename ?? uniqueFilename(path, usedFilenames);
    const fileId = existing?.id ?? nanoid();
    const title = titleFromPath(path);

    if (existing) {
      await db
        .update(schema.designFiles)
        .set({ content: url, fileType: "html", updatedAt: now })
        .where(eq(schema.designFiles.id, existing.id));
      if (await hasCollabState(existing.id)) {
        await applyText(existing.id, url, "content", "agent");
      } else {
        await seedFromText(existing.id, url);
      }
    } else {
      await db.insert(schema.designFiles).values({
        id: fileId,
        designId,
        filename,
        fileType: "html",
        content: url,
        createdAt: now,
        updatedAt: now,
      });
      await seedFromText(fileId, url);
    }

    results.push({ fileId, filename, path, url, title, width, height });
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
        // Preserve user-adjusted title/dimensions on refresh; only URL-backed
        // source fields track the current container preview.
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
    isApplied: (current) => {
      const frames = parseCanvasFrameGeometryById(current.canvasFrames);
      const metadata = isRecord(current.screenMetadata)
        ? current.screenMetadata
        : {};
      return results.every((screen) => {
        const entry = metadata[screen.fileId];
        return (
          Boolean(frames[screen.fileId]) &&
          isRecord(entry) &&
          entry.sourceType === "fusion" &&
          entry.url === screen.url &&
          entry.previewUrl === screen.url &&
          entry.path === screen.path
        );
      });
    },
  });

  return { screens: results, placedFrames };
}
