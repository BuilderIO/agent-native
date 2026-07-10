import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFramePlacement,
} from "../../shared/canvas-frames.js";
import { annotateScreenHtmlForPersist } from "../../shared/screen-annotation.js";
import { getDb, schema } from "../db/index.js";
import { mutateDesignData } from "./design-data-mutation.js";

const DEFAULT_FRAME_WIDTH = 1440;
const DEFAULT_FRAME_HEIGHT = 900;
const FRAME_GAP = 96;

export interface ImportedDesignFile {
  filename: string;
  fileType: "html" | "css" | "jsx" | "asset";
  content: string;
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
}

export interface SavedImportedDesignFile {
  id: string;
  filename: string;
  fileType: string;
  source?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const metadataByFileId = new Map<string, Record<string, unknown>>();
  let placedFrames:
    | Array<{
        fileId: string;
        filename?: string;
        frame: CanvasFramePlacement;
      }>
    | undefined;

  // Preserve the old all-or-nothing behavior for already-invalid data as far
  // as the shared mutation boundary permits: validate before inserting files,
  // then re-run the real intent against the latest revision after file work.
  await mutateDesignData({
    designId,
    mutate: (current) => current,
    isApplied: () => true,
  });

  await db.transaction(async (tx) => {
    const [design] = await tx
      .select()
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    if (!design) throw new Error(`Design ${designId} was not found.`);

    const existingFiles = await tx
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));
    const usedFilenames = new Set(existingFiles.map((file) => file.filename));
    let nextFrameX = 0;

    for (let index = 0; index < input.files.length; index += 1) {
      const file = input.files[index]!;
      const filename = uniqueFilename(
        ensureExtension(sanitizeImportedFilename(file.filename), file.fileType),
        usedFilenames,
      );
      const fileId = nanoid();
      // Stamp missing data-agent-native-node-id attributes before persisting
      // so imported screens are fully addressable by id-keyed editor
      // operations immediately, instead of depending on a client-side
      // backfill the first time someone opens the imported screen.
      const annotatedContent = annotateScreenHtmlForPersist(
        file.content,
        file.fileType,
      );
      await tx.insert(schema.designFiles).values({
        id: fileId,
        designId,
        filename,
        fileType: file.fileType,
        content: annotatedContent,
        createdAt: now,
        updatedAt: now,
      });
      seedRecords.push({ id: fileId, content: annotatedContent });

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
        x: file.preferredFrame?.x ?? nextFrameX,
        y: file.preferredFrame?.y ?? 0,
        width,
        height,
        z: index,
      });
      nextFrameX += width + FRAME_GAP;
      const source = {
        sourceType: input.sourceType,
        previewState: "static",
        title: file.preferredFrame?.title ?? filename.replace(/\.[^.]+$/, ""),
        width,
        height,
        ...file.source,
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

  await mutateDesignData({
    designId,
    mutate: (current, { updatedAt }) => {
      const previousMetadata = isRecord(current.screenMetadata)
        ? { ...current.screenMetadata }
        : {};
      for (const [fileId, metadata] of metadataByFileId) {
        previousMetadata[fileId] = metadata;
      }
      const mergedFrames = mergeCanvasFramePlacements({
        existing: current.canvasFrames,
        placements,
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
        const placement = placements.find(
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
