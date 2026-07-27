import { designDataForAccessRole } from "./design-data-access.js";

interface CanvasFrame {
  width?: unknown;
  height?: unknown;
  [key: string]: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseDesignTemplateData(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Templates are portable/shareable snapshots, so they must never retain
 * localhost bridge credentials. Reuse the same viewer-safe redaction applied
 * to exported design metadata before either saving or instantiating a template.
 */
export function redactTemplateDesignData(
  raw: string | null | undefined,
): string {
  const redacted = designDataForAccessRole(raw ?? "{}", "viewer");
  return typeof redacted === "string" ? redacted : "{}";
}

export function remapTemplateFileIds(
  rawData: string | null | undefined,
  fileIdMap: Map<string, string>,
): Record<string, unknown> {
  const data = parseDesignTemplateData(rawData);
  const next: Record<string, unknown> = { ...data };

  const remapKeyedRecord = (key: string) => {
    const source = record(data[key]);
    if (Object.keys(source).length === 0) return;
    next[key] = Object.fromEntries(
      Object.entries(source).map(([id, value]) => [
        fileIdMap.get(id) ?? id,
        value,
      ]),
    );
  };

  remapKeyedRecord("canvasFrames");
  remapKeyedRecord("screenMetadata");

  if (typeof data.boardFileId === "string") {
    next.boardFileId = fileIdMap.get(data.boardFileId) ?? data.boardFileId;
  }
  if (Array.isArray(data.lockedScreenIds)) {
    next.lockedScreenIds = data.lockedScreenIds.map((id) =>
      typeof id === "string" ? (fileIdMap.get(id) ?? id) : id,
    );
  }

  return next;
}

export function firstTemplateDimensions(
  data: Record<string, unknown>,
  preferredFileId?: string,
): { width: number | null; height: number | null } {
  const frames = record(data.canvasFrames);
  const frame = record(
    (preferredFileId ? frames[preferredFileId] : undefined) ??
      Object.values(frames)[0],
  ) as CanvasFrame;
  const width =
    typeof frame.width === "number" && Number.isFinite(frame.width)
      ? Math.round(frame.width)
      : null;
  const height =
    typeof frame.height === "number" && Number.isFinite(frame.height)
      ? Math.round(frame.height)
      : null;
  return { width, height };
}
