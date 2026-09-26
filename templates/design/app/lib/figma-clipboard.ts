
export interface FigmetaPayload {
  fileKey: string;
  pasteID?: number;
  dataType?: string;
  environment?: string;
  selectedNodeData?: string;
  selectedNodeIds?: string[];
  selectedNodeIdsTruncated?: boolean;
}

export const MAX_FIGMA_CLIPBOARD_NODE_IDS = 100;
const FIGMETA_MARKER_RE = /\(figmeta\)([^(]*?)\(\/figmeta\)/i;
const DATA_METADATA_ATTR_RE = /\bdata-metadata\s*=\s*(["'])([\s\S]*?)\1/i;
const FIGMA_DATA_BUFFER_ELEMENT_RE =
  /<([a-z][\w:-]*)\b[^>]*\bdata-buffer\s*=\s*(["'])[\s\S]*?\2[^>]*>[\s\S]*?<\/\1\s*>/gi;
const FIGMA_BUFFER_COMMENT_RE = /<!--\s*\(figma\)[\s\S]*?\(\/figma\)\s*-->/gi;
const ESCAPED_FIGMA_BUFFER_COMMENT_RE =
  /&lt;!--\s*\(figma\)[\s\S]*?\(\/figma\)\s*--&gt;/gi;
const DATA_BUFFER_ATTR_RE = /\bdata-buffer\s*=\s*(["'])([\s\S]*?)\1/i;

function decodeBase64Json(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const decoded =
      typeof atob === "function"
        ? atob(trimmed)
        : Buffer.from(trimmed, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function isFigmetaPayload(value: unknown): value is FigmetaPayload {
  if (!value || typeof value !== "object") return false;
  const fileKey = (value as { fileKey?: unknown }).fileKey;
  return typeof fileKey === "string" && fileKey.trim().length > 0;
}

function normalizeFigmetaPayload(value: FigmetaPayload): FigmetaPayload {
  const payload: FigmetaPayload = { fileKey: value.fileKey.trim() };
  if (typeof value.pasteID === "number") payload.pasteID = value.pasteID;
  if (typeof value.dataType === "string") payload.dataType = value.dataType;
  if (typeof value.environment === "string") {
    payload.environment = value.environment;
  }
  if (typeof value.selectedNodeData === "string") {
    payload.selectedNodeData = value.selectedNodeData;
    const { ids, truncated } = parseSelectedNodeIds(value.selectedNodeData);
    if (ids.length > 0) payload.selectedNodeIds = ids;
    if (truncated) payload.selectedNodeIdsTruncated = true;
  }
  return payload;
}

function parseSelectedNodeIds(value: string): {
  ids: string[];
  truncated: boolean;
} {
  const allIds = Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.split("|", 1)[0]?.trim() ?? "")
        .filter((id) => /^\d+:\d+$/.test(id)),
    ),
  );
  return {
    ids: allIds.slice(0, MAX_FIGMA_CLIPBOARD_NODE_IDS),
    truncated: allIds.length > MAX_FIGMA_CLIPBOARD_NODE_IDS,
  };
}

export function extractSelectedNodeIds(value: string): string[] {
  return parseSelectedNodeIds(value).ids;
}

export function stripFigmaBinaryClipboardBuffer(html: string): string {
  return html
    .replace(FIGMA_DATA_BUFFER_ELEMENT_RE, "")
    .replace(FIGMA_BUFFER_COMMENT_RE, "")
    .replace(ESCAPED_FIGMA_BUFFER_COMMENT_RE, "");
}

const FIGMA_BUFFER_BASE64_RE = /\(figma\)([A-Za-z0-9+/=\s]+?)\(\/figma\)/i;

export function extractFigmaBuffer(
  html: string | null | undefined,
): string | null {
  if (!html) return null;

  const attrMatch = html.match(DATA_BUFFER_ATTR_RE);
  if (attrMatch?.[2]) {
    const inner = attrMatch[2];
    const bufMatch = inner.match(FIGMA_BUFFER_BASE64_RE);
    if (bufMatch?.[1]) return bufMatch[1].replace(/\s/g, "");
  }

  const directMatch = html.match(FIGMA_BUFFER_BASE64_RE);
  if (directMatch?.[1]) return directMatch[1].replace(/\s/g, "");

  return null;
}

export function extractFigmeta(
  html: string | null | undefined,
): FigmetaPayload | null {
  if (!html) return null;

  const markerMatch = html.match(FIGMETA_MARKER_RE);
  if (markerMatch?.[1]) {
    const parsed = decodeBase64Json(markerMatch[1]);
    if (isFigmetaPayload(parsed)) return normalizeFigmetaPayload(parsed);
  }

  const attrMatch = html.match(DATA_METADATA_ATTR_RE);
  if (attrMatch?.[2]) {
    const parsed = decodeBase64Json(attrMatch[2]);
    if (isFigmetaPayload(parsed)) return normalizeFigmetaPayload(parsed);
  }

  return null;
}

export const FIGMA_IMAGE_REF_SENTINEL_PREFIX = "about:blank#figma-image-ref=";

export function figmaImageRefSentinel(hexHash: string): string {
  return `${FIGMA_IMAGE_REF_SENTINEL_PREFIX}${hexHash}`;
}

export type FigmaApiKeyStatus = "configured" | "missing" | "unknown";
export type FigmaPasteStrategy =
  | "rest"
  | "local-kiwi"
  | "html-fallback"
  | "not-figma";

export function decideFigmaPasteStrategy(
  figmeta: FigmetaPayload | null,
  apiKeyStatus: FigmaApiKeyStatus = "unknown",
): FigmaPasteStrategy {
  if (!figmeta) return "not-figma";
  if (apiKeyStatus === "missing") return "local-kiwi";
  return "rest";
}

const MAX_CLIPBOARD_BUFFER_BASE64_CHARS = 3.5 * 1024 * 1024;

function decodedBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

function bufferPayloadFor(content: string): {
  clipboardBuffer?: string;
  clipboardBufferOmittedBytes?: number;
} {
  const base64 = extractFigmaBuffer(content);
  if (!base64) return {};
  if (base64.length <= MAX_CLIPBOARD_BUFFER_BASE64_CHARS) {
    return { clipboardBuffer: base64 };
  }
  return { clipboardBufferOmittedBytes: decodedBytes(base64) };
}

export type FigmaPasteImportCall =
  | {
      action: "import-figma-clipboard";
      payload: {
        figmetaFileKey: string;
        selectedNodeIds?: string[];
        selectedNodeIdsTruncated?: boolean;
        clipboardHtml: string;
        clipboardBuffer?: string;
        clipboardBufferOmittedBytes?: number;
        originalName?: string;
      };
    }
  | {
      action: "import-design-source";
      payload: {
        sourceType: "figma-paste-html";
        content: string;
        originalName?: string;
      };
    };

export function resolveFigmaPasteImportCall(
  content: string,
  originalName = "figma-paste.html",
  apiKeyStatus: FigmaApiKeyStatus = "unknown",
): FigmaPasteImportCall {
  const figmeta = extractFigmeta(content);
  const strategy = decideFigmaPasteStrategy(figmeta, apiKeyStatus);

  if (strategy === "not-figma") {
    return {
      action: "import-design-source",
      payload: { sourceType: "figma-paste-html", content, originalName },
    };
  }

  if (strategy === "local-kiwi") {
    const bufferPayload = bufferPayloadFor(content);
    return {
      action: "import-figma-clipboard",
      payload: {
        figmetaFileKey: figmeta!.fileKey,
        ...(figmeta!.selectedNodeIds
          ? { selectedNodeIds: figmeta!.selectedNodeIds }
          : {}),
        ...(figmeta!.selectedNodeIdsTruncated
          ? { selectedNodeIdsTruncated: true }
          : {}),
        clipboardHtml: stripFigmaBinaryClipboardBuffer(content),
        ...bufferPayload,
        originalName,
      },
    };
  }

  const restBufferPayload = bufferPayloadFor(content);
  return {
    action: "import-figma-clipboard",
    payload: {
      figmetaFileKey: figmeta!.fileKey,
      ...(figmeta!.selectedNodeIds
        ? { selectedNodeIds: figmeta!.selectedNodeIds }
        : {}),
      ...(figmeta!.selectedNodeIdsTruncated
        ? { selectedNodeIdsTruncated: true }
        : {}),
      clipboardHtml: figmeta!.selectedNodeIds?.length
        ? stripFigmaBinaryClipboardBuffer(content)
        : content,
      ...restBufferPayload,
      originalName,
    },
  };
}
