import type { CanvasFramePlacement } from "./canvas-frames.js";

export const SHELL_CANVAS_PATH = "/visual-edit/shell";

export const DEFAULT_SHELL_SCREEN_WIDTH = 1280;
export const DEFAULT_SHELL_SCREEN_HEIGHT = 900;
const DEFAULT_SHELL_GAP = 160;
export const MAX_SHELL_SCREENS = 100;

export interface ShellScreen {
  fileId: string;
  filename: string;
  path: string;
  url: string;
  title: string;
  width: number;
  height: number;
}

export interface ShellScreensResult {
  screens: ShellScreen[];
  placedFrames: Array<{
    fileId: string;
    filename?: string;
    frame: CanvasFramePlacement;
  }>;
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
  let filename = base;
  let suffix = 2;
  while (used.has(filename)) {
    filename = `${base.replace(/\.html$/, "")}-${suffix}.html`;
    suffix += 1;
  }
  used.add(filename);
  return filename;
}

function shellFileId(filename: string): string {
  return `shell-${filename.replace(/\.html$/, "")}`;
}

export function buildShellScreens(args: {
  previewOrigin: string;
  paths: string[];
  width?: number;
  height?: number;
  startX?: number;
  startY?: number;
  gap?: number;
}): ShellScreensResult {
  const {
    previewOrigin,
    paths,
    width = DEFAULT_SHELL_SCREEN_WIDTH,
    height = DEFAULT_SHELL_SCREEN_HEIGHT,
    startX = 0,
    startY = 0,
    gap = DEFAULT_SHELL_GAP,
  } = args;

  const baseWithSlash = previewOrigin.endsWith("/")
    ? previewOrigin
    : `${previewOrigin}/`;
  const baseOrigin = new URL(baseWithSlash).origin;

  const used = new Set<string>();
  const screens: ShellScreen[] = [];
  const placedFrames: ShellScreensResult["placedFrames"] = [];
  const seenPaths = new Set<string>();
  let nextX = startX;

  for (const rawPath of paths.slice(0, MAX_SHELL_SCREENS)) {
    const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);

    const resolved = new URL(path.replace(/^\/+/, ""), baseWithSlash);
    if (resolved.origin !== baseOrigin) continue;

    const filename = uniqueFilename(path, used);
    const fileId = shellFileId(filename);
    screens.push({
      fileId,
      filename,
      path,
      url: resolved.toString(),
      title: titleFromPath(path),
      width,
      height,
    });
    placedFrames.push({
      fileId,
      filename,
      frame: { fileId, filename, x: nextX, y: startY, width, height },
    });
    nextX += width + gap;
  }

  return { screens, placedFrames };
}
