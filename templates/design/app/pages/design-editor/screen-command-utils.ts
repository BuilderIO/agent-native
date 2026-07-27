import type { DesignEditorCommand } from "@/hooks/use-navigation-state";

import { queryUniqueSelector } from "./dom-utils";
import { normalizeDesignLeftPanel, normalizeDesignTool } from "./tool-state";
import { type DesignFile, FOCUSED_SCREEN_ZOOM } from "./types";

export function normalizeScreenTarget(value: string): string {
  return value
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\.html?$/i, "")
    .toLowerCase();
}

export function findDesignFileByScreenTarget(
  files: DesignFile[],
  target: string | null | undefined,
): DesignFile | null {
  const trimmed = target?.trim();
  if (!trimmed) return null;
  const normalized = normalizeScreenTarget(trimmed);
  return (
    files.find((file) => file.id === trimmed) ??
    files.find((file) => file.filename === trimmed) ??
    files.find((file) => normalizeScreenTarget(file.filename) === normalized) ??
    null
  );
}

export function designEditorCommandFromSearchParams(
  designId: string,
  searchParams: URLSearchParams,
): DesignEditorCommand | null {
  const editorView = searchParams.get("view");
  const inspector = searchParams.get("inspector");
  const leftPanel = normalizeDesignLeftPanel(searchParams.get("panel"));
  const screen =
    searchParams.get("screen") ??
    searchParams.get("fileId") ??
    searchParams.get("filename");
  const selection = searchParams.get("selection");
  const rawZoom = searchParams.get("zoom");
  const zoom = rawZoom !== null ? Number(rawZoom) : NaN;
  const tool = normalizeDesignTool(searchParams.get("tool"));
  if (
    editorView !== "overview" &&
    editorView !== "single" &&
    inspector !== "design" &&
    inspector !== "tweaks" &&
    inspector !== "extensions" &&
    !leftPanel &&
    !screen &&
    !selection &&
    !tool
  ) {
    return null;
  }
  const command: DesignEditorCommand = {
    designId,
    issuedAt: 0,
  };
  if (editorView === "overview" || editorView === "single") {
    command.editorView = editorView;
  }
  if (inspector === "design" || inspector === "tweaks") {
    command.inspectorTab = inspector;
  } else if (inspector === "extensions") {
    command.leftPanel = "tools";
  }
  if (leftPanel) command.leftPanel = leftPanel;
  if (screen) command.screen = screen;
  if (selection) command.selection = selection;
  if (Number.isFinite(zoom)) {
    command.zoom = zoom;
  } else if (editorView === "single") {
    command.zoom = FOCUSED_SCREEN_ZOOM;
  }
  if (tool) command.tool = tool;
  return command;
}

export function applyInlineStyleToHtml(
  content: string,
  selector: string,
  property: string,
  value: string,
): string | null {
  return applyInlineStylesToHtml(content, selector, { [property]: value });
}

export function applyInlineStylesToHtml(
  content: string,
  selector: string,
  styles: Record<string, string>,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, selector) as HTMLElement | null;
    if (!element) return null;
    Object.entries(styles).forEach(([property, value]) => {
      (element.style as any)[property] = value;
    });
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

export const DEFAULT_STATES_PANEL_BREAKPOINTS = [
  { id: "bp-mobile", label: "Mobile", widthPx: 390 },
  { id: "bp-tablet", label: "Tablet", widthPx: 768 },
  { id: "bp-desktop", label: "Desktop", widthPx: 1280 },
] as const;

export interface DesignStatePreviewRow {
  captureData?: Record<string, unknown> | null;
  fixtureData?: Record<string, unknown> | null;
}

const STATE_PREVIEW_HTML_KEYS = [
  "domHtml",
  "domSnapshot",
  "documentHtml",
  "html",
  "content",
  "markup",
] as const;

function looksLikePreviewHtml(value: string): boolean {
  return /<!doctype|<html\b|<body\b|<[a-zA-Z][\s>]/i.test(value);
}

function findStatePreviewHtml(value: unknown, depth = 0): string | null {
  if (typeof value === "string") {
    return looksLikePreviewHtml(value) ? value : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2)
    return null;
  const record = value as Record<string, unknown>;
  for (const key of STATE_PREVIEW_HTML_KEYS) {
    const hit = findStatePreviewHtml(record[key], depth + 1);
    if (hit) return hit;
  }
  for (const entry of Object.values(record)) {
    const hit = findStatePreviewHtml(entry, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function designStatePreviewHtml(
  row: DesignStatePreviewRow | undefined,
): string | null {
  if (!row) return null;
  return (
    findStatePreviewHtml(row.captureData) ??
    findStatePreviewHtml(row.fixtureData)
  );
}
