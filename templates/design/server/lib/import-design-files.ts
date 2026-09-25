import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFramePlacement,
} from "../../shared/canvas-frames.js";
import { isOverviewScreenFile } from "../../shared/design-files.js";
import {
  getResponsiveBreakpointWidths,
  getResponsiveGroupHeight,
  getResponsiveGroupRotatedBounds,
  getResponsiveGroupWidth,
  getScreenPreviewViewport,
  visibleBreakpointWidths,
} from "../../shared/responsive-frame-layout.js";
import { annotateScreenHtmlForPersist } from "../../shared/screen-annotation.js";
import { getDb, schema } from "../db/index.js";
import { designSourceMutationLockKey } from "../source-workspace.js";
import {
  InvalidDesignDataError,
  mutateDesignData,
} from "./design-data-mutation.js";

const DEFAULT_FRAME_WIDTH = 1440;
const DEFAULT_FRAME_HEIGHT = 900;
export const FRAME_GAP = 96;

export interface ImportedDesignFile {
  filename: string;
  fileType: "html" | "css" | "jsx" | "asset";
  content: string;
  /** Stable retry marker for a browser import request. */
  operationSource?: string;
  source?: Record<string, unknown>;
  preferredFrame?: {
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  };
}

export interface SaveImportedDesignFilesInput {
  designId?: string;
  files: ImportedDesignFile[];
  sourceType: string;
  warnings?: string[];
  preserveExactContent?: boolean;
  /**
   * Operation-source prefix shared by every request of one import. Its files'
   * preferredFrame x/y are relative to one origin, taken right of every screen
   * when the first batch lands and stored as `importOriginX` in each frame's
   * metadata, so later batches keep the arrangement even after the user edits
   * or adds screens mid-import. Group files need `source.operationSource`.
   */
  placementGroup?: string;
}

export interface SavedImportedDesignFile {
  id: string;
  filename: string;
  fileType: string;
  source?: Record<string, unknown>;
}

export interface ImportedOperationFile {
  file: SavedImportedDesignFile;
  operationSource: string;
  /** False when the row landed but its canvas placement never committed. */
  placed: boolean;
}

/** Files already saved under one operation-source prefix, e.g. an import batch. */
export async function findImportedDesignFilesByOperationSourcePrefix(
  designId: string,
  prefix: string,
  designData: string | null,
): Promise<ImportedOperationFile[]> {
  const rows = await getDb()
    .select({
      id: schema.designFiles.id,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      contentOperationSource: schema.designFiles.contentOperationSource,
    })
    .from(schema.designFiles)
    .where(
      and(
        eq(schema.designFiles.designId, designId),
        like(
          schema.designFiles.contentOperationSource,
          `${prefix.replace(/[\\%_]/g, "\\$&")}%`,
        ),
      ),
    );
  const data = parseDesignDataObject(designId, designData);
  const screenMetadata = isRecord(data.screenMetadata)
    ? data.screenMetadata
    : {};
  return rows.flatMap((row) => {
    if (!row.contentOperationSource) return [];
    const candidate = screenMetadata[row.id];
    const metadata = isRecord(candidate) ? candidate : undefined;
    return [
      {
        file: {
          id: row.id,
          filename: row.filename,
          fileType: row.fileType,
          source: metadata,
        },
        operationSource: row.contentOperationSource,
        placed: metadata?.operationSource === row.contentOperationSource,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDesignDataObject(
  designId: string,
  serialized: string | null,
): Record<string, unknown> {
  if (serialized === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new InvalidDesignDataError(designId);
  }
  if (!isRecord(parsed)) throw new InvalidDesignDataError(designId);
  return parsed;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOperationSourceUniqueViolation(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes(
    "design_files_design_operation_source_unique_idx",
  );
}

function nextImportedFrameZ(currentCanvasFrames: unknown): number {
  const currentFrames = parseCanvasFrameGeometryById(currentCanvasFrames);
  const currentFrameEntries = Object.values(currentFrames);
  const highestPersistedZ = Math.max(
    -1,
    ...currentFrameEntries
      .map((frame) => frame.z)
      .filter((z): z is number => typeof z === "number" && Number.isFinite(z)),
  );
  // canvasFrames is the durable screen-frame map. Board placement is stored
  // separately, so every entry contributes to the screen stack.
  // Screens without persisted z use their source order as the fallback. The
  // count keeps a new import above those entries too, while persisted z wins
  // for designs that already have an explicit stack.
  return Math.max(currentFrameEntries.length, highestPersistedZ + 1);
}

function importedFramePaintedBounds(args: {
  frame: CanvasFramePlacement;
  metadata?: unknown;
  breakpointWidths: readonly number[];
}): { x: number; y: number; width: number; height: number } {
  const frameWidth = positiveDimension(args.frame.width, DEFAULT_FRAME_WIDTH);
  const frameHeight = positiveDimension(
    args.frame.height,
    DEFAULT_FRAME_HEIGHT,
  );
  const metadataRecord = isRecord(args.metadata) ? args.metadata : {};
  const sourceWidth = positiveDimension(metadataRecord.width, frameWidth);
  const sourceHeight = positiveDimension(metadataRecord.height, frameHeight);
  const scale = getScreenPreviewViewport(
    { width: sourceWidth, height: sourceHeight },
    { width: frameWidth, height: frameHeight },
  ).scale;
  const visibleWidths = visibleBreakpointWidths(
    args.breakpointWidths,
    sourceWidth,
  );
  const groupWidth = getResponsiveGroupWidth({
    primaryWidth: frameWidth,
    scale,
    visibleWidths,
  });
  const groupHeight = getResponsiveGroupHeight({
    primaryHeight: frameHeight,
    scale,
    sourceWidth,
    sourceHeight,
    visibleWidths,
    resolveBreakpointHeightPx: (widthPx) => {
      const breakpointHeights = isRecord(metadataRecord.breakpointHeights)
        ? metadataRecord.breakpointHeights
        : {};
      const height = breakpointHeights[String(widthPx)];
      return typeof height === "number" && Number.isFinite(height) && height > 0
        ? height
        : undefined;
    },
  });
  const x = args.frame.x ?? 0;
  const y = args.frame.y ?? 0;
  const rotation = args.frame.rotation ?? 0;
  return rotation
    ? getResponsiveGroupRotatedBounds({
        x,
        y,
        primaryWidth: frameWidth,
        primaryHeight: frameHeight,
        groupWidth,
        groupHeight,
        rotation,
      })
    : { x, y, width: groupWidth, height: groupHeight };
}

function nextImportedFrameX(
  currentCanvasFrames: unknown,
  options: {
    screenMetadataByFileId?: unknown;
    breakpointWidths?: readonly number[];
    overviewScreenFileIds?: ReadonlySet<string>;
  } = {},
): number {
  const currentFrames = Object.entries(
    parseCanvasFrameGeometryById(currentCanvasFrames),
  );
  const metadataMap = isRecord(options.screenMetadataByFileId)
    ? options.screenMetadataByFileId
    : {};
  const breakpointWidths = options.breakpointWidths ?? [];
  const screenFrames = options.overviewScreenFileIds
    ? currentFrames.filter(([fileId]) =>
        options.overviewScreenFileIds!.has(fileId),
      )
    : currentFrames;
  const right = screenFrames.reduce((maxRight, [fileId, frame]) => {
    const bounds = importedFramePaintedBounds({
      frame,
      metadata: metadataMap[fileId],
      breakpointWidths,
    });
    return Number.isFinite(bounds.x) && Number.isFinite(bounds.width)
      ? Math.max(maxRight, bounds.x + bounds.width)
      : maxRight;
  }, 0);
  return screenFrames.length > 0 ? right + FRAME_GAP : 0;
}

function storedImportOriginX(
  screenMetadata: Record<string, unknown>,
  placementGroup: string,
): number | undefined {
  for (const metadata of Object.values(screenMetadata)) {
    if (
      isRecord(metadata) &&
      typeof metadata.operationSource === "string" &&
      metadata.operationSource.startsWith(placementGroup) &&
      typeof metadata.importOriginX === "number" &&
      Number.isFinite(metadata.importOriginX)
    ) {
      return metadata.importOriginX;
    }
  }
  return undefined;
}

function stringFromState(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string"
    ? (value[key] as string)
    : undefined;
}

export async function resolveImportDesignId(
  explicitDesignId?: string,
): Promise<string> {
  if (explicitDesignId?.trim()) return explicitDesignId.trim();
  const navigation = await readAppStateForCurrentTab("navigation").catch(
    () => null,
  );
  const designId = stringFromState(navigation, "designId");
  if (!designId) {
    throw new Error(
      "No designId was provided and no active design was found in the current editor.",
    );
  }
  return designId;
}

export function sanitizeImportedFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed || trimmed.includes("..") || /[\\/]/.test(trimmed)) {
    throw new Error("Imported filename is invalid.");
  }
  const cleaned = trimmed
    .replace(/[^\w. -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error("Imported filename is invalid.");
  return cleaned;
}

function ensureExtension(
  filename: string,
  fileType: ImportedDesignFile["fileType"],
) {
  if (/\.[A-Za-z0-9]+$/.test(filename)) return filename;
  if (fileType === "css") return `${filename}.css`;
  if (fileType === "jsx") return `${filename}.jsx`;
  if (fileType === "asset") return filename;
  return `${filename}.html`;
}

function uniqueFilename(filename: string, used: Set<string>): string {
  if (!used.has(filename)) {
    used.add(filename);
    return filename;
  }
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let index = 2;
  while (used.has(`${base}-${index}${ext}`)) index += 1;
  const next = `${base}-${index}${ext}`;
  used.add(next);
  return next;
}

function positiveDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function sanitizeImportedHtml(content: string): string {
  return content
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script\b[^>]*\/?\s*>/gi, "")
    .replace(/<\s*(iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(iframe|object|embed)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+(href|src|xlink:href|action|formaction)\s*=\s*"[\s]*(?:javascript|vbscript):[^"]*"/gi,
      "",
    )
    .replace(
      /\s+(href|src|xlink:href|action|formaction)\s*=\s*'[\s]*(?:javascript|vbscript):[^']*'/gi,
      "",
    )
    .replace(
      /\s+(href|src|xlink:href|action|formaction)\s*=\s*(?:javascript|vbscript):[^\s>]*/gi,
      "",
    )
    .replace(
      /\s+style\s*=\s*(["'])(?:(?!\1).)*(?:expression\s*\(|javascript:)(?:(?!\1).)*\1/gi,
      "",
    );
}

export function normalizeImportedHtmlDocument(
  content: string,
  sourceLabel: string,
): string {
  const normalized = sanitizeImportedHtml(content.replace(/\0/g, "")).trim();
  if (!normalized) throw new Error("HTML import content is empty.");
  const safeSourceLabel = sourceLabel.replace(/--+/g, "-").replace(/[<>]/g, "");
  const comment = `<!-- Imported into Design from ${safeSourceLabel}. -->`;
  if (/<html[\s>]/i.test(normalized)) {
    return normalized.replace(
      /<head(\s[^>]*)?>/i,
      (match) => `${match}\n  ${comment}`,
    );
  }
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  ${comment}
</head>
<body>
${normalized}
</body>
</html>`;
}

export async function saveImportedDesignFiles(
  input: SaveImportedDesignFilesInput,
) {
  if (input.files.length === 0) {
    throw new Error("No files were produced by the import.");
  }
  const designId = await resolveImportDesignId(input.designId);
  await assertAccess("design", designId, "editor");

  const db = getDb();
  const now = new Date().toISOString();
  const savedFiles: SavedImportedDesignFile[] = [];
  const seedRecords: Array<{ id: string; content: string }> = [];
  const placements: CanvasFramePlacement[] = [];
  let placementsForPersistence: CanvasFramePlacement[] = placements;
  const metadataByFileId = new Map<string, Record<string, unknown>>();
  const existingOverviewScreenFileIds = new Set<string>();
  let placedFrames:
    | Array<{
        fileId: string;
        filename?: string;
        frame: CanvasFramePlacement;
      }>
    | undefined;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${designSourceMutationLockKey(designId)}, 0::bigint))`,
      );
      const [design] = await tx
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId))
        .limit(1);
      if (!design) throw new Error(`Design ${designId} was not found.`);
      // Refuse before inserting files, so invalid data never gains orphans.
      parseDesignDataObject(designId, design.data);

      const existingFiles = await tx
        .select({
          id: schema.designFiles.id,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId));
      for (const file of existingFiles) {
        if (isOverviewScreenFile(file)) {
          existingOverviewScreenFileIds.add(file.id);
        }
      }
      const usedFilenames = new Set(existingFiles.map((file) => file.filename));

      const operationSources = input.files.flatMap((file) =>
        file.operationSource ? [file.operationSource] : [],
      );
      const retriedFiles = operationSources.length
        ? await tx
            .select({
              id: schema.designFiles.id,
              filename: schema.designFiles.filename,
              content: schema.designFiles.content,
              contentOperationSource: schema.designFiles.contentOperationSource,
            })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                inArray(
                  schema.designFiles.contentOperationSource,
                  operationSources,
                ),
              ),
            )
        : [];
      const retriedByOperationSource = new Map(
        retriedFiles.map((file) => [file.contentOperationSource, file]),
      );

      for (let index = 0; index < input.files.length; index += 1) {
        const file = input.files[index]!;
        const existing = file.operationSource
          ? retriedByOperationSource.get(file.operationSource)
          : undefined;
        const filename =
          existing?.filename ??
          uniqueFilename(
            ensureExtension(
              sanitizeImportedFilename(file.filename),
              file.fileType,
            ),
            usedFilenames,
          );
        const fileId = existing?.id ?? nanoid();
        // Exact native clones are immutable source evidence. Other imports are
        // annotated before persistence so editor operations can address nodes.
        const annotatedContent = input.preserveExactContent
          ? file.content
          : annotateScreenHtmlForPersist(file.content, file.fileType);
        if (!existing) {
          await tx.insert(schema.designFiles).values({
            id: fileId,
            designId,
            filename,
            fileType: file.fileType,
            content: annotatedContent,
            contentOperationSource: file.operationSource ?? null,
            createdAt: now,
            updatedAt: now,
          });
          seedRecords.push({ id: fileId, content: annotatedContent });
        } else {
          seedRecords.push({ id: fileId, content: existing.content });
        }

        const width = positiveDimension(
          file.preferredFrame?.width,
          DEFAULT_FRAME_WIDTH,
        );
        const height = positiveDimension(
          file.preferredFrame?.height,
          DEFAULT_FRAME_HEIGHT,
        );
        placements.push({
          fileId,
          filename,
          ...(file.preferredFrame?.x !== undefined
            ? { x: file.preferredFrame.x }
            : {}),
          y: file.preferredFrame?.y ?? 0,
          width,
          height,
          z: index,
        });
        const source = {
          sourceType: input.sourceType,
          previewState: "static",
          title: file.preferredFrame?.title ?? filename.replace(/\.[^.]+$/, ""),
          width,
          height,
          ...file.source,
          heightMode: "fixed",
          heightPinned: true,
        };
        metadataByFileId.set(fileId, source);
        savedFiles.push({
          id: fileId,
          filename,
          fileType: file.fileType,
          source,
        });
      }
    });
  } catch (error) {
    if (
      input.files.some((file) => file.operationSource) &&
      isOperationSourceUniqueViolation(error)
    ) {
      return saveImportedDesignFiles(input);
    }
    throw error;
  }

  await mutateDesignData({
    designId,
    mutate: (current, { updatedAt }) => {
      const currentScreenMetadata = isRecord(current.screenMetadata)
        ? current.screenMetadata
        : {};
      const breakpointWidths = getResponsiveBreakpointWidths(
        current.breakpointSet,
      );
      let nextFrameX = nextImportedFrameX(current.canvasFrames, {
        screenMetadataByFileId: currentScreenMetadata,
        breakpointWidths,
        overviewScreenFileIds: existingOverviewScreenFileIds,
      });
      const groupOriginX = input.placementGroup
        ? (storedImportOriginX(currentScreenMetadata, input.placementGroup) ??
          nextFrameX)
        : 0;
      if (input.placementGroup) {
        for (const metadata of metadataByFileId.values()) {
          metadata.importOriginX = groupOriginX;
        }
      }
      const baseZ = nextImportedFrameZ(current.canvasFrames);
      placementsForPersistence = placements.map((placement, index) => {
        const x =
          placement.x === undefined ? nextFrameX : groupOriginX + placement.x;
        const bounds = importedFramePaintedBounds({
          frame: { ...placement, x },
          metadata: metadataByFileId.get(placement.fileId ?? ""),
          breakpointWidths,
        });
        nextFrameX = Math.max(nextFrameX, bounds.x + bounds.width + FRAME_GAP);
        return {
          ...placement,
          x,
          z: baseZ + index,
        };
      });
      const previousMetadata = isRecord(current.screenMetadata)
        ? { ...current.screenMetadata }
        : {};
      for (const [fileId, metadata] of metadataByFileId) {
        previousMetadata[fileId] = metadata;
      }
      const mergedFrames = mergeCanvasFramePlacements({
        existing: current.canvasFrames,
        placements: placementsForPersistence,
        resolveFileId: (placement) => placement.fileId,
      });
      placedFrames = mergedFrames.placedFrames;
      return {
        ...current,
        sourceMode: "import",
        canvasFrames: mergedFrames.canvasFrames,
        screenMetadata: previousMetadata,
        updatedAt,
      };
    },
    isApplied: (current) => {
      if (current.sourceMode !== "import") return false;
      const currentFrames = parseCanvasFrameGeometryById(current.canvasFrames);
      const currentMetadata = isRecord(current.screenMetadata)
        ? current.screenMetadata
        : {};
      return savedFiles.every((file) => {
        const frame = currentFrames[file.id];
        const metadata = currentMetadata[file.id];
        const placement = placementsForPersistence.find(
          (candidate) => candidate.fileId === file.id,
        );
        const expectedFrame = placement
          ? {
              x: placement.x,
              y: placement.y,
              width: placement.width,
              height: placement.height,
              z: placement.z,
            }
          : null;
        return (
          frame !== undefined &&
          expectedFrame !== null &&
          Object.entries(expectedFrame).every(
            ([key, value]) => frame[key as keyof typeof frame] === value,
          ) &&
          isRecord(metadata) &&
          Object.entries(file.source ?? {}).every(([key, value]) =>
            jsonValuesEqual(metadata[key], value),
          )
        );
      });
    },
  });

  for (const record of seedRecords) {
    if (await hasCollabState(record.id)) {
      await applyText(record.id, record.content, "content", "agent");
    } else {
      await seedFromText(record.id, record.content);
    }
  }

  return {
    designId,
    files: savedFiles,
    warnings: input.warnings ?? [],
    placedFrames: placedFrames ?? [],
    overview: true,
    urlPath: `/design/${designId}`,
  };
}
