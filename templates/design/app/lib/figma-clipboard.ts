/**
 * Client-side Figma clipboard helpers: decode the `figmeta` marker Figma
 * writes into a copy's clipboard HTML, and decide which action a paste
 * should route through.
 *
 * Figma wraps a small base64 JSON payload (`{"fileKey","pasteID","dataType"}`)
 * between literal `(figmeta)`/`(/figmeta)` markers — the same markers
 * `hasFigmaClipboardPayload` in `design-import.ts` already scans for to detect
 * a Figma paste at all. Some Figma clients may instead put that same base64
 * blob directly in the `data-metadata` attribute with no wrapper markers, so
 * `extractFigmeta` tries both, defensively, and never throws — any malformed
 * input just means "not a decodable Figma paste".
 *
 * Important caveat carried through to the server: `figmeta` has no node ids
 * (only a `fileKey`), and `pasteID` is an ephemeral, server-side identifier
 * that isn't resolvable to a node through the public REST API. So a plain
 * clipboard paste can only ever get an exact node import on a best-effort,
 * heuristic match (see `server/lib/figma-clipboard-match.ts`) — a copied
 * frame LINK (which carries a real `node-id`) is the only guaranteed-exact
 * path (`import-figma-frame`).
 */

export interface FigmetaPayload {
  fileKey: string;
  pasteID?: number;
  dataType?: string;
}

const FIGMETA_MARKER_RE = /\(figmeta\)([^(]*?)\(\/figmeta\)/i;
const DATA_METADATA_ATTR_RE = /\bdata-metadata\s*=\s*(["'])([\s\S]*?)\1/i;

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
  return payload;
}

/**
 * Extracts and decodes the `figmeta` payload from a clipboard's raw HTML (or
 * plain text), if present. Returns `null` for anything that isn't a
 * decodable Figma `figmeta` marker — this never throws, so callers can run it
 * unconditionally on every paste.
 */
export function extractFigmeta(
  html: string | null | undefined,
): FigmetaPayload | null {
  if (!html) return null;

  const markerMatch = html.match(FIGMETA_MARKER_RE);
  if (markerMatch?.[1]) {
    const parsed = decodeBase64Json(markerMatch[1]);
    if (isFigmetaPayload(parsed)) return normalizeFigmetaPayload(parsed);
  }

  // Defensive fallback: some clients may emit data-metadata as a bare base64
  // blob with no (figmeta)...(/figmeta) wrapper markers.
  const attrMatch = html.match(DATA_METADATA_ATTR_RE);
  if (attrMatch?.[2]) {
    const parsed = decodeBase64Json(attrMatch[2]);
    if (isFigmetaPayload(parsed)) return normalizeFigmetaPayload(parsed);
  }

  return null;
}

export type FigmaApiKeyStatus = "configured" | "missing" | "unknown";
export type FigmaPasteStrategy = "rest" | "html-fallback" | "not-figma";

/**
 * Pure decision matrix for what a paste should attempt, given whether it
 * decoded a `figmeta` payload and (if known) whether the Figma access token
 * is configured:
 *
 * - No `figmeta` -> not a Figma paste at all (`"not-figma"`).
 * - `figmeta` present but the key is known-missing -> skip the REST attempt
 *   entirely and go straight to the legacy HTML path (`"html-fallback"`).
 * - `figmeta` present and the key is configured, or its status isn't known
 *   client-side -> attempt the REST import (`"rest"`). The server is the
 *   authority on whether the key actually works; passing `"unknown"` here
 *   just means "try REST, let the server fall back for real if it can't."
 */
export function decideFigmaPasteStrategy(
  figmeta: FigmetaPayload | null,
  apiKeyStatus: FigmaApiKeyStatus = "unknown",
): FigmaPasteStrategy {
  if (!figmeta) return "not-figma";
  if (apiKeyStatus === "missing") return "html-fallback";
  return "rest";
}

export type FigmaPasteImportCall =
  | {
      action: "import-figma-clipboard";
      payload: {
        figmetaFileKey: string;
        clipboardHtml: string;
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

/**
 * Resolves the actual action name + payload a paste should call, given the
 * raw clipboard HTML. Used by both the canvas-level paste listener and the
 * Import panel's Figma-paste target so the two call sites stay in lockstep.
 */
export function resolveFigmaPasteImportCall(
  content: string,
  originalName = "figma-paste.html",
): FigmaPasteImportCall {
  const figmeta = extractFigmeta(content);
  const strategy = decideFigmaPasteStrategy(figmeta, "unknown");

  if (strategy === "not-figma") {
    return {
      action: "import-design-source",
      payload: { sourceType: "figma-paste-html", content, originalName },
    };
  }

  return {
    action: "import-figma-clipboard",
    payload: {
      figmetaFileKey: figmeta!.fileKey,
      clipboardHtml: content,
      originalName,
    },
  };
}
