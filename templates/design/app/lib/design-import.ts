import type { PortableStyleSnapshot } from "@/components/design/types";

import {
  isValidDesignClipboardManagedStyleSnapshot,
  type DesignClipboardManagedStyleSnapshot,
} from "./design-clipboard-managed-styles";

export interface FigmaFidelityReport {
  exactCount: number;
  approximated: Array<{
    nodeId: string;
    nodeName?: string;
    nodeType?: string;
    notes: string[];
  }>;
  imageFallbacks: Array<{
    nodeId: string;
    nodeName?: string;
    nodeType?: string;
    notes: string[];
  }>;
}

export interface ImportResult {
  designId?: string;
  files?: Array<{ id: string; filename: string }>;
  warnings?: string[];
  error?: string;
  /** Set by import-figma-clipboard: which path actually produced the screen(s). */
  strategy?: "restNodes" | "htmlFallback";
  /** Set by import-figma-clipboard when it fell back because no Figma token is configured. */
  figmaApiKeyMissing?: boolean;
  /** Set by import-figma-clipboard when it fell back: why the REST match didn't happen. */
  matchStatus?: "matched" | "ambiguous" | "none" | "error";
  fidelityReport?: FigmaFidelityReport;
  guidance?: string;
}

export interface ImportResultNotification {
  variant: "success" | "warning";
  title: string;
  description?: string;
}

export const VISUAL_EDIT_CONNECT_COMMAND =
  "npx @agent-native/core@latest design connect --url 'http://localhost:<port>' --root . --daemon";

export const VISUAL_EDIT_INSTALL_COMMAND =
  "npx @agent-native/core@latest skills add visual-edit";

export function hasFigmaClipboardPayload(value: string): boolean {
  return (
    /\((figmeta|figma)\)[\s\S]*?\(\/(figmeta|figma)\)/i.test(value) ||
    /<[^>]+\sdata-(metadata|buffer)=["'][^"']*\((figmeta|figma)\)[^"']*["']/i.test(
      value,
    )
  );
}

export function looksLikeStandaloneHtml(value: string): boolean {
  return /<(html|body|main|section|div|article|header|footer|button|img)\b/i.test(
    value,
  );
}

export function getFigmaClipboardContent(
  clipboardData: Pick<DataTransfer, "getData"> | null | undefined,
): string | null {
  if (!clipboardData) return null;
  const html = clipboardData.getData("text/html");
  if (html && hasFigmaClipboardPayload(html)) return html;
  const text = clipboardData.getData("text/plain");
  if (text && hasFigmaClipboardPayload(text)) return text;
  return null;
}

export function importResultSummary(
  result: ImportResult | undefined,
  fallback: string,
) {
  const count = result?.files?.length ?? 0;
  if (count === 0) return fallback;
  if (count === 1) return `Imported ${result!.files![0]!.filename}.`;
  return `Imported ${count} screens.`;
}

function isGenericFigFormatCaveat(warning: string): boolean {
  return /Figma's \.fig format is proprietary and undocumented/i.test(warning);
}

/**
 * Builds one import notification instead of stacking a success toast and a
 * warning toast. The generic experimental `.fig` caveat is already disclosed
 * beside the upload control, so only actionable conversion warnings belong in
 * the transient result notification.
 */
export function importResultNotification(
  result: ImportResult | undefined,
  fallback: string,
  options?: { fidelityWarnings?: string[] },
): ImportResultNotification {
  const title = importResultSummary(result, fallback);
  const actionableWarnings = [
    ...(result?.warnings ?? []).filter(
      (warning) => !isGenericFigFormatCaveat(warning),
    ),
    ...(options?.fidelityWarnings ?? []),
  ].slice(0, 3);

  if (actionableWarnings.length === 0) {
    return { variant: "success", title };
  }

  return {
    variant: "warning",
    title,
    description: actionableWarnings.join("\n"),
  };
}

// --- R83: safe fetch-response parsing for the file upload path ---
//
// A failed upload can come back as a non-JSON body — a plaintext "Internal
// Error" from an upstream proxy/platform crash page, an HTML error page, or
// any other unexpected content-type — even though this app's own
// import-design-file route always returns a JSON `{ error }` envelope on its
// own thrown failures. Calling `response.json()` unconditionally on a body
// like that throws a raw `SyntaxError` ("Unexpected token 'I', "Internal
// E"... is not valid JSON"), which then surfaces verbatim in the upload
// toast instead of a clean message. Route every parse through this helper so
// a non-JSON body always degrades to a readable message instead of a raw
// parser error leaking into the UI.

/** Minimal shape `parseUploadResponse` needs — a subset of the real `Response`. */
export interface JsonParsableResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/**
 * Parses a fetch `Response` as JSON only when it is actually JSON, and
 * always resolves rather than throwing a parse error — the fallback branch
 * folds an unparsable failure body into the same `{ error }` shape a
 * well-behaved server route would have sent, truncating an overlong body so
 * a raw HTML/proxy error page doesn't blow up the toast description.
 *
 * Success responses are still expected to be real JSON: a genuinely broken
 * 200 (should not happen for this route) throws the underlying SyntaxError
 * rather than silently returning `{}`, so that failure mode stays loud
 * instead of masquerading as an empty successful import.
 */
export async function parseUploadResponse<T extends ImportResult>(
  response: JsonParsableResponse,
  fallbackErrorMessage: string,
): Promise<T> {
  const raw = await response.text();
  const contentLooksJson = /^\s*[{[]/.test(raw);
  if (!contentLooksJson) {
    if (response.ok) {
      // Successful response that isn't JSON at all — this is a real bug
      // (route contract broken), not an expected failure mode. Surface it
      // loudly rather than swallowing it as a fake success.
      throw new SyntaxError(
        `Expected a JSON response but received: ${truncateForToast(raw)}`,
      );
    }
    return {
      error: raw.trim()
        ? `${fallbackErrorMessage}: ${truncateForToast(raw)}`
        : fallbackErrorMessage,
    } as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    if (response.ok) {
      throw new SyntaxError(
        `Expected a JSON response but received: ${truncateForToast(raw)}`,
      );
    }
    return { error: fallbackErrorMessage } as T;
  }
}

const MAX_TOAST_BODY_CHARS = 160;

function truncateForToast(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_TOAST_BODY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_TOAST_BODY_CHARS)}…`;
}

// --- Cross-tab / system-clipboard round-trip (U4/U6) ---
//
// The in-memory clipboard refs (copiedLayerEntriesRef etc.) never survive a
// tab switch, a page reload, or a copy made in another window, and pasting
// from the OS clipboard after copying elsewhere silently reuses the stale
// in-memory entries instead. To fix that, every copy embeds a serialized
// marker comment in the text actually written to navigator.clipboard, and
// paste parses that marker back out of the live clipboard content so a
// cross-tab paste (or a same-tab paste after an external copy) round-trips
// the original entries instead of just raw concatenated HTML.

export interface DesignClipboardLayerEntry {
  html: string;
  rootNodeId?: string;
  sourceFileId: string;
  portableStyleSnapshot?: PortableStyleSnapshot;
  managedStyleSnapshot?: DesignClipboardManagedStyleSnapshot;
}

export interface DesignClipboardScreenEntry {
  filename: string;
  fileType?: string;
  content: string;
  canvasFrame?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

export interface DesignClipboardPayload {
  version: 1;
  entries: DesignClipboardLayerEntry[];
  screens?: DesignClipboardScreenEntry[];
}

const CLIPBOARD_MARKER_PREFIX = "agent-native-clipboard-v1:";
const MAX_CLIPBOARD_MARKER_DATA_CHARS = 16_000_000;
const MAX_CLIPBOARD_CONTENT_CHARS = 8_000_000;
const MAX_CLIPBOARD_LAYER_ENTRIES = 1_000;
const MAX_CLIPBOARD_SCREEN_ENTRIES = 100;

function clipboardString(value: unknown, max = 1_024): value is string {
  return typeof value === "string" && value.length <= max;
}

function isPortableClipboardStyleSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.nodes)) return false;
  if (snapshot.nodes.length > 5_000) return false;
  if (
    snapshot.rootSourceId !== undefined &&
    !clipboardString(snapshot.rootSourceId)
  ) {
    return false;
  }
  return snapshot.nodes.every((rawNode) => {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      return false;
    }
    const node = rawNode as Record<string, unknown>;
    if (node.sourceId !== undefined && !clipboardString(node.sourceId)) {
      return false;
    }
    if (
      !Array.isArray(node.path) ||
      node.path.length > 128 ||
      !node.path.every((part) => Number.isInteger(part) && Number(part) >= 0)
    ) {
      return false;
    }
    if (!node.styles || typeof node.styles !== "object") return false;
    const styles = Object.entries(node.styles as Record<string, unknown>);
    return (
      styles.length <= 256 &&
      styles.every(
        ([property, value]) =>
          clipboardString(property, 256) && clipboardString(value, 16_384),
      )
    );
  });
}

function validateDesignClipboardPayload(
  value: unknown,
): DesignClipboardPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1 || !Array.isArray(payload.entries)) return null;
  if (payload.entries.length > MAX_CLIPBOARD_LAYER_ENTRIES) return null;
  const screens = payload.screens;
  if (
    screens !== undefined &&
    (!Array.isArray(screens) || screens.length > MAX_CLIPBOARD_SCREEN_ENTRIES)
  ) {
    return null;
  }
  let contentChars = 0;
  for (const rawEntry of payload.entries) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      return null;
    }
    const entry = rawEntry as Record<string, unknown>;
    if (
      !clipboardString(entry.html, MAX_CLIPBOARD_CONTENT_CHARS) ||
      !clipboardString(entry.sourceFileId) ||
      (entry.rootNodeId !== undefined && !clipboardString(entry.rootNodeId)) ||
      (entry.portableStyleSnapshot !== undefined &&
        !isPortableClipboardStyleSnapshot(entry.portableStyleSnapshot)) ||
      (entry.managedStyleSnapshot !== undefined &&
        !isValidDesignClipboardManagedStyleSnapshot(entry.managedStyleSnapshot))
    ) {
      return null;
    }
    contentChars += entry.html.length;
  }
  for (const rawScreen of (screens as unknown[] | undefined) ?? []) {
    if (
      !rawScreen ||
      typeof rawScreen !== "object" ||
      Array.isArray(rawScreen)
    ) {
      return null;
    }
    const screen = rawScreen as Record<string, unknown>;
    if (
      !clipboardString(screen.filename, 512) ||
      screen.filename.includes("..") ||
      screen.filename.includes("/") ||
      screen.filename.includes("\\") ||
      !clipboardString(screen.content, MAX_CLIPBOARD_CONTENT_CHARS) ||
      (screen.fileType !== undefined && !clipboardString(screen.fileType, 32))
    ) {
      return null;
    }
    if (screen.canvasFrame !== undefined) {
      if (
        !screen.canvasFrame ||
        typeof screen.canvasFrame !== "object" ||
        Array.isArray(screen.canvasFrame)
      ) {
        return null;
      }
      if (
        Object.values(screen.canvasFrame as Record<string, unknown>).some(
          (part) =>
            typeof part !== "number" ||
            !Number.isFinite(part) ||
            Math.abs(part) > 10_000_000,
        )
      ) {
        return null;
      }
    }
    contentChars += screen.content.length;
  }
  if (contentChars > MAX_CLIPBOARD_CONTENT_CHARS) return null;
  return value as DesignClipboardPayload;
}

function encodeClipboardMarkerData(payload: DesignClipboardPayload): string {
  // btoa is UTF-16-unsafe for non-Latin1 text; encodeURIComponent first so
  // arbitrary copied HTML (emoji, non-Latin scripts, etc.) round-trips.
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}

function decodeClipboardMarkerData(
  data: string,
): DesignClipboardPayload | null {
  if (data.length > MAX_CLIPBOARD_MARKER_DATA_CHARS) return null;
  try {
    const json = decodeURIComponent(atob(data));
    const parsed = JSON.parse(json) as unknown;
    return validateDesignClipboardPayload(parsed);
  } catch {
    return null;
  }
}

/**
 * Appends an invisible marker comment (safe inside HTML and plain text alike)
 * encoding the full clipboard payload after the human-visible clipboard text.
 */
export function serializeDesignClipboardPayload(
  visibleText: string,
  payload: DesignClipboardPayload,
  trustToken?: string,
): string {
  const trustedPrefix = trustToken ? `${trustToken}.` : "";
  const marker = `<!--${CLIPBOARD_MARKER_PREFIX}${trustedPrefix}${encodeClipboardMarkerData(payload)}-->`;
  return `${visibleText}\n${marker}`;
}

/**
 * Extracts a previously-serialized payload from clipboard text, if present.
 * Returns null for clipboard content that was never written by this app (a
 * plain copy from elsewhere, or another app's clipboard payload).
 */
export function parseDesignClipboardMarker(
  text: string | null | undefined,
  expectedTrustToken?: string | null,
): DesignClipboardPayload | null {
  if (!text) return null;
  const markerIndex = text.lastIndexOf(`<!--${CLIPBOARD_MARKER_PREFIX}`);
  if (markerIndex === -1) return null;
  const start = markerIndex + 4 + CLIPBOARD_MARKER_PREFIX.length;
  const end = text.indexOf("-->", start);
  if (end === -1) return null;
  const markerData = text.slice(start, end);
  const separator = markerData.indexOf(".");
  if (expectedTrustToken === null) return null;
  if (expectedTrustToken !== undefined) {
    if (
      separator <= 0 ||
      markerData.slice(0, separator) !== expectedTrustToken
    ) {
      return null;
    }
    return decodeClipboardMarkerData(markerData.slice(separator + 1));
  }
  // The low-level parser remains able to inspect legacy markers for migration
  // and tests. Browser paste paths always provide the per-installation trust
  // token and therefore reject unauthenticated clipboard HTML.
  return decodeClipboardMarkerData(
    separator > 0 ? markerData.slice(separator + 1) : markerData,
  );
}
