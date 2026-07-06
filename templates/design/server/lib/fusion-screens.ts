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
import { parseDesignDataBlob } from "../../shared/full-app.js";
import { getDb, schema } from "../db/index.js";

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
  const [design] = await db
    .select({ data: schema.designs.data })
    .from(schema.designs)
    .where(eq(schema.designs.id, designId))
    .limit(1);
  const prevData = parseDesignDataBlob(design?.data);
  const existingCanvasFrames = parseCanvasFrameGeometryById(
    prevData.canvasFrames,
  );
  const existingMetadata = isRecord(prevData.screenMetadata)
    ? { ...(prevData.screenMetadata as Record<string, unknown>) }
    : {};
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
  const placements: CanvasFramePlacement[] = [];

  // Only place screens that don't already have canvas geometry so re-syncs
  // never reset positions the user has arranged. New screens start after the
  // right-most existing frame.
  const existingGeometries = Object.values(existingCanvasFrames);
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
    if (!existingCanvasFrames[fileId]) {
      placements.push({
        fileId,
        filename,
        x: nextX,
        y: startY,
        width,
        height,
        z: placements.length,
      });
      nextX += width + gap;
    }
  }

  const mergedFrames = mergeCanvasFramePlacements({
    existing: prevData.canvasFrames,
    placements,
    resolveFileId: (placement) => placement.fileId,
  });

  for (const screen of results) {
    // Preserve user-adjusted title/dimensions on refresh; only the URL keys
    // must always track the current preview URL.
    const prevMeta = isRecord(existingMetadata[screen.fileId])
      ? (existingMetadata[screen.fileId] as Record<string, unknown>)
      : {};
    existingMetadata[screen.fileId] = {
      ...prevMeta,
      sourceType: "fusion",
      previewState: "live",
      title: prevMeta.title ?? screen.title,
      width: prevMeta.width ?? screen.width,
      height: prevMeta.height ?? screen.height,
      url: screen.url,
      previewUrl: screen.url,
      path: screen.path,
    };
  }

  await db
    .update(schema.designs)
    .set({
      data: JSON.stringify({
        ...prevData,
        canvasFrames: mergedFrames.canvasFrames,
        screenMetadata: existingMetadata,
        updatedAt: now,
      }),
      updatedAt: now,
    })
    .where(eq(schema.designs.id, designId));

  return { screens: results, placedFrames: mergedFrames.placedFrames };
}
