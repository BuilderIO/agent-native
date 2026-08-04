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

export interface DesignTemplateSourceFile {
  designFileId: string;
  templateFileId: string;
  filename: string | null;
  width: number | null;
  height: number | null;
}

export interface DesignTemplateSource {
  templateId: string;
  title: string | null;
  category: string | null;
  instantiatedAt: string | null;
  appliedDesignSystemId: string | null;
  /**
   * Captured at copy time, not re-read from the template. Dimensions and fonts
   * are small enough to restate on every turn, which is what stops a follow-up
   * request from resizing the artboard or swapping the typeface. The full
   * template markup stays behind `get-design-template`.
   */
  files: DesignTemplateSourceFile[];
  fonts: string[];
}

const MAX_TRACKED_FONTS = 12;

/**
 * Font drift is invisible in a layout diff and is the most common way a
 * refined template stops looking like its template. Capture the declared
 * families once so later turns can restate them without re-parsing markup.
 */
export function extractTemplateFonts(html: string): string[] {
  const fonts = new Set<string>();

  for (const match of html.matchAll(/font-family\s*:\s*([^;}"']+)/gi)) {
    const family = match[1]
      ?.split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (family && !/^(inherit|initial|unset|var\()/i.test(family)) {
      fonts.add(family);
    }
  }
  for (const link of html.matchAll(/fonts\.googleapis\.com\/[^"'\s>]+/gi)) {
    for (const family of link[0].matchAll(/family=([^&:"']+)/gi)) {
      const name = decodeURIComponent(family[1]!).replace(/\+/g, " ").trim();
      if (name) fonts.add(name);
    }
  }

  return [...fonts].slice(0, MAX_TRACKED_FONTS);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

/**
 * Reads the template a design was created from. Returns null when the design
 * was not created from a template; throws when the design claims a template
 * but the record cannot be read, because silently treating that as "no
 * template" would drop the template constraints the design is bound to.
 */
export function readDesignTemplateSource(
  data: Record<string, unknown>,
): DesignTemplateSource | null {
  const raw = data.templateSource;
  if (raw === undefined || raw === null) return null;

  const source = record(raw);
  const templateId = source.templateId;
  if (typeof templateId !== "string" || !templateId.trim()) {
    throw new Error(
      "Design records a templateSource without a readable templateId",
    );
  }

  return {
    templateId,
    title: typeof source.title === "string" ? source.title : null,
    category: typeof source.category === "string" ? source.category : null,
    instantiatedAt:
      typeof source.instantiatedAt === "string" ? source.instantiatedAt : null,
    appliedDesignSystemId:
      typeof source.appliedDesignSystemId === "string"
        ? source.appliedDesignSystemId
        : null,
    files: (Array.isArray(source.files) ? source.files : []).flatMap(
      (entry) => {
        const file = record(entry);
        const designFileId = file.designFileId;
        const templateFileId = file.templateFileId;
        if (
          typeof designFileId !== "string" ||
          typeof templateFileId !== "string"
        ) {
          return [];
        }
        return [
          {
            designFileId,
            templateFileId,
            filename: typeof file.filename === "string" ? file.filename : null,
            width: finiteNumber(file.width),
            height: finiteNumber(file.height),
          },
        ];
      },
    ),
    fonts: (Array.isArray(source.fonts) ? source.fonts : []).filter(
      (font): font is string => typeof font === "string",
    ),
  };
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

/**
 * Exact frame lookup for one file. Unlike `firstTemplateDimensions` this never
 * falls back to another screen's frame: a screen with no recorded frame must
 * report "unknown", not a neighbour's dimensions.
 */
export function templateFileDimensions(
  data: Record<string, unknown>,
  fileId: string,
): { width: number | null; height: number | null } {
  const frame = record(record(data.canvasFrames)[fileId]) as CanvasFrame;
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
