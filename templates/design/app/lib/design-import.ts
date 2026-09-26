import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { parseFigmaFileKey } from "@shared/figma-url";

import type { PortableStyleSnapshot } from "@/components/design/types";

import {
  isValidDesignClipboardManagedStyleSnapshot,
  type DesignClipboardManagedStyleSnapshot,
} from "./design-clipboard-managed-styles";

const FIGMA_RATE_LIMITED_ERROR_CODE = "figma_rate_limited";
const FIGMA_PROVIDER_QUOTA_ERROR_CODE = "figma_provider_quota_cooldown";

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
  strategy?: "restNodes" | "htmlFallback" | "localKiwi";
  /** Set by import-figma-clipboard when it fell back because no Figma token is configured. */
  figmaApiKeyMissing?: boolean;
  unresolvedImages?: number;
  unresolvedImageRefCount?: number;
  skippedEmbeddedImageCount?: number;
  matchStatus?: "matched" | "ambiguous" | "none" | "error";
  rateLimitRetryAfter?: number;
  rateLimitPlanTier?: string;
  rateLimitType?: string;
  rateLimitUpgradeUrl?: string;
  quotaSource?: "figma" | "design";
  fidelityReport?: FigmaFidelityReport;
  guidance?: string;
}

export interface ImportResultNotification {
  variant: "success" | "warning";
  title: string;
  description?: string;
}

export function readFigmaImportFailure(
  error: unknown,
  fallbackMessage: string,
): { result: ImportResult & { error: string }; isRateLimited: boolean } {
  const source = error as
    | { errorCode?: unknown; details?: Record<string, unknown> }
    | undefined;
  const details = source?.details ?? {};
  const numeric = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  const text = (value: unknown) =>
    typeof value === "string" && value ? value : undefined;

  return {
    result: {
      error:
        actionErrorMessage(error) ??
        (error instanceof Error ? error.message : undefined) ??
        fallbackMessage,
      rateLimitRetryAfter: numeric(details.retryAfterSeconds),
      rateLimitPlanTier: text(details.planTier),
      rateLimitType: text(details.rateLimitType),
      rateLimitUpgradeUrl: text(details.upgradeUrl),
      quotaSource:
        source?.errorCode === FIGMA_PROVIDER_QUOTA_ERROR_CODE
          ? "design"
          : "figma",
    },
    isRateLimited:
      source?.errorCode === FIGMA_RATE_LIMITED_ERROR_CODE ||
      source?.errorCode === FIGMA_PROVIDER_QUOTA_ERROR_CODE,
  };
}

export function figmaHydrationErrorMessage(
  error: unknown,
  fallbackMessage: string,
  forbiddenMessage: string,
): string {
  const { result } = readFigmaImportFailure(error, fallbackMessage);
  const source = error as
    | {
        errorCode?: unknown;
        statusCode?: unknown;
        details?: Record<string, unknown>;
      }
    | undefined;
  const isFigmaForbidden =
    source?.errorCode === "figma_request_failed" &&
    (source.statusCode === 403 || source.details?.figmaStatus === 403);

  if (isFigmaForbidden) return forbiddenMessage;
  return /internal server error/i.test(result.error)
    ? fallbackMessage
    : result.error;
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

export function isAttemptedFigmaPaste(
  clipboardData: Pick<DataTransfer, "getData"> | null | undefined,
): boolean {
  if (!clipboardData) return false;
  if (getFigmaClipboardContent(clipboardData)) return false;
  const text = (clipboardData.getData("text/plain") ?? "").trim();
  if (/figmeta/i.test(clipboardData.getData("text/html") ?? "")) return true;
  if (/figmeta/i.test(text)) return true;
  return /^https?:\/\/\S+$/i.test(text) && parseFigmaFileKey(text) !== null;
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

export interface JsonParsableResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export async function parseUploadResponse<T extends ImportResult>(
  response: JsonParsableResponse,
  fallbackErrorMessage: string,
): Promise<T> {
  const raw = await response.text();
  const contentLooksJson = /^\s*[{[]/.test(raw);
  if (!contentLooksJson) {
    if (response.ok) {
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

export interface DesignClipboardLayerEntry {
  html: string;
  rootNodeId?: string;
  sourceParentNodeId?: string;
  sourceFileId: string;
  portableStyleSnapshot?: PortableStyleSnapshot;
  styleSnapshotCaptureFailed?: boolean;
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
      (entry.sourceParentNodeId !== undefined &&
        !clipboardString(entry.sourceParentNodeId)) ||
      (entry.styleSnapshotCaptureFailed !== undefined &&
        typeof entry.styleSnapshotCaptureFailed !== "boolean") ||
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

export function serializeDesignClipboardPayload(
  visibleText: string,
  payload: DesignClipboardPayload,
  trustToken?: string,
): string {
  const trustedPrefix = trustToken ? `${trustToken}.` : "";
  const marker = `<!--${CLIPBOARD_MARKER_PREFIX}${trustedPrefix}${encodeClipboardMarkerData(payload)}-->`;
  return `${visibleText}\n${marker}`;
}

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
  return decodeClipboardMarkerData(
    separator > 0 ? markerData.slice(separator + 1) : markerData,
  );
}
