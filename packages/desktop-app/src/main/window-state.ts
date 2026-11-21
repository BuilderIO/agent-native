import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface PersistedWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isFullScreen: boolean;
}

export type WindowStateRead =
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "ok"; state: PersistedWindowState };

export interface WindowStateStore {
  read(): WindowStateRead;
  write(state: PersistedWindowState): void;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowStateFileSystem {
  mkdirSync(path: string, options: { recursive: true }): unknown;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(
    path: string,
    contents: string,
    options: { encoding: "utf8"; mode: number },
  ): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
}

const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 60;

export function createWindowStateStore(
  filePath: string,
  fileSystem: WindowStateFileSystem = fs,
): WindowStateStore {
  if (!path.isAbsolute(filePath)) {
    throw new Error("Window state requires an absolute file path.");
  }

  return {
    read() {
      let raw: string;
      try {
        raw = fileSystem.readFileSync(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { status: "absent" };
        }
        return { status: "unreadable", reason: describeError(error) };
      }
      let candidate: unknown;
      try {
        candidate = JSON.parse(raw);
      } catch (error) {
        return { status: "unreadable", reason: describeError(error) };
      }
      const state = parsePersistedWindowState(candidate);
      if (!state) {
        return {
          status: "unreadable",
          reason: "unexpected window state shape",
        };
      }
      return { status: "ok", state };
    },
    write(state) {
      const directory = path.dirname(filePath);
      fileSystem.mkdirSync(directory, { recursive: true });
      const tempPath = path.join(
        directory,
        `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
      );
      try {
        fileSystem.writeFileSync(tempPath, JSON.stringify(state, null, 2), {
          encoding: "utf8",
          mode: 0o600,
        });
        fileSystem.renameSync(tempPath, filePath);
      } catch (error) {
        try {
          fileSystem.unlinkSync(tempPath);
        } catch {}
        throw error;
      }
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePersistedWindowState(
  value: unknown,
): PersistedWindowState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { x, y, width, height, isMaximized, isFullScreen } = record;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    typeof isMaximized !== "boolean" ||
    typeof isFullScreen !== "boolean"
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    isMaximized,
    isFullScreen,
  };
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

export interface InitialWindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export function resolveInitialWindowBounds(
  saved: PersistedWindowState | null,
  workAreas: readonly Rect[],
  defaults: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  },
): InitialWindowBounds {
  if (!saved) return { width: defaults.width, height: defaults.height };

  const largest = workAreas.reduce<Rect | null>(
    (best, area) =>
      !best || area.width * area.height > best.width * best.height
        ? area
        : best,
    null,
  );
  const width = Math.max(
    defaults.minWidth,
    largest ? Math.min(saved.width, largest.width) : saved.width,
  );
  const height = Math.max(
    defaults.minHeight,
    largest ? Math.min(saved.height, largest.height) : saved.height,
  );

  const placed: Rect = { x: saved.x, y: saved.y, width, height };
  const visible = workAreas.some((area) => {
    const shared = overlap(placed, area);
    return (
      shared.width >= Math.min(MIN_VISIBLE_WIDTH, width) &&
      shared.height >= Math.min(MIN_VISIBLE_HEIGHT, height)
    );
  });
  return visible
    ? { width, height, x: saved.x, y: saved.y }
    : { width, height };
}

export interface TrackableWindow {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  isMinimized(): boolean;
  getNormalBounds(): Rect;
  on(event: string, listener: () => void): unknown;
}

export const WINDOW_STATE_SAVE_DELAY_MS = 400;

export function captureWindowState(win: TrackableWindow): PersistedWindowState {
  const bounds = win.getNormalBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  };
}

export function installWindowStateTracker(
  win: TrackableWindow,
  store: WindowStateStore,
  onError: (error: unknown) => void,
  timers: {
    setTimeout: (callback: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  } = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): void {
  let pending: unknown = null;

  const save = () => {
    pending = null;
    if (win.isDestroyed()) return;
    try {
      store.write(captureWindowState(win));
    } catch (error) {
      onError(error);
    }
  };
  const schedule = () => {
    if (pending !== null) timers.clearTimeout(pending);
    pending = timers.setTimeout(save, WINDOW_STATE_SAVE_DELAY_MS);
  };

  for (const event of [
    "resize",
    "move",
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
  ]) {
    win.on(event, schedule);
  }
  win.on("close", () => {
    if (pending !== null) timers.clearTimeout(pending);
    save();
  });
}
