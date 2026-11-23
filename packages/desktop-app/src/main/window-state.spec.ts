import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureWindowState,
  createWindowStateStore,
  installWindowStateTracker,
  resolveInitialWindowBounds,
  WINDOW_STATE_SAVE_DELAY_MS,
  type PersistedWindowState,
  type Rect,
  type TrackableWindow,
} from "./window-state.js";

const DEFAULTS = { width: 1280, height: 800, minWidth: 960, minHeight: 600 };
const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const SAVED: PersistedWindowState = {
  x: 200,
  y: 120,
  width: 1400,
  height: 900,
  isMaximized: false,
  isFullScreen: false,
};

const tempDirs: string[] = [];
function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "window-state-"));
  tempDirs.push(dir);
  return path.join(dir, "userData", "window-state.json");
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("window state store", () => {
  it("reports a missing file as absent, not as a default window", () => {
    expect(createWindowStateStore(tempFile()).read()).toEqual({
      status: "absent",
    });
  });

  it("restores what the previous run saved after a relaunch", () => {
    const file = tempFile();
    createWindowStateStore(file).write({ ...SAVED, isMaximized: true });
    expect(createWindowStateStore(file).read()).toEqual({
      status: "ok",
      state: { ...SAVED, isMaximized: true },
    });
  });

  it("reports corrupt or wrong-shaped files as unreadable", () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(createWindowStateStore(file).read().status).toBe("unreadable");
    fs.writeFileSync(file, JSON.stringify({ x: 1, y: 2, width: "wide" }));
    expect(createWindowStateStore(file).read().status).toBe("unreadable");
  });

  it("requires an absolute path", () => {
    expect(() => createWindowStateStore("window-state.json")).toThrow(
      /absolute/,
    );
  });

  it("leaves no temp files behind after a write", () => {
    const file = tempFile();
    createWindowStateStore(file).write(SAVED);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["window-state.json"]);
  });
});

describe("resolveInitialWindowBounds", () => {
  it("uses the defaults with no saved state", () => {
    expect(resolveInitialWindowBounds(null, [SCREEN], DEFAULTS)).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it("restores the saved size and position", () => {
    expect(resolveInitialWindowBounds(SAVED, [SCREEN], DEFAULTS)).toEqual({
      width: 1400,
      height: 900,
      x: 200,
      y: 120,
    });
  });

  it("drops a position on a display that is no longer connected", () => {
    const gone = { ...SAVED, x: 2600, y: 100 };
    expect(resolveInitialWindowBounds(gone, [SCREEN], DEFAULTS)).toEqual({
      width: 1400,
      height: 900,
    });
  });

  it("keeps a position on a second connected display", () => {
    const second: Rect = { x: 1920, y: 0, width: 1920, height: 1080 };
    const onSecond = { ...SAVED, x: 2600 };
    expect(
      resolveInitialWindowBounds(onSecond, [SCREEN, second], DEFAULTS),
    ).toMatchObject({ x: 2600, y: 120 });
  });

  it("clamps an oversize window to the largest display and the minimum size", () => {
    const huge = { ...SAVED, x: 0, y: 0, width: 5000, height: 4000 };
    expect(resolveInitialWindowBounds(huge, [SCREEN], DEFAULTS)).toMatchObject({
      width: 1920,
      height: 1080,
    });
    const tiny = { ...SAVED, width: 100, height: 100 };
    expect(resolveInitialWindowBounds(tiny, [SCREEN], DEFAULTS)).toMatchObject({
      width: 960,
      height: 600,
    });
  });
});

function fakeWindow(overrides: Partial<TrackableWindow> = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const win: TrackableWindow & { emit(event: string): void } = {
    isDestroyed: () => false,
    isMaximized: () => false,
    isFullScreen: () => false,
    isMinimized: () => false,
    getNormalBounds: () => ({ x: 10, y: 20, width: 1000, height: 700 }),
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit(event) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    ...overrides,
  };
  return win;
}

describe("installWindowStateTracker", () => {
  it("captures normal bounds and the maximized and full screen flags", () => {
    const win = fakeWindow({ isMaximized: () => true });
    expect(captureWindowState(win)).toEqual({
      x: 10,
      y: 20,
      width: 1000,
      height: 700,
      isMaximized: true,
      isFullScreen: false,
    });
  });

  it("debounces move and resize into one write", () => {
    vi.useFakeTimers();
    try {
      const writes: PersistedWindowState[] = [];
      const win = fakeWindow();
      installWindowStateTracker(
        win,
        { read: () => ({ status: "absent" }), write: (s) => writes.push(s) },
        () => {},
      );
      win.emit("resize");
      win.emit("move");
      win.emit("resize");
      expect(writes).toHaveLength(0);
      vi.advanceTimersByTime(WINDOW_STATE_SAVE_DELAY_MS);
      expect(writes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves immediately on close, cancelling a pending save", () => {
    vi.useFakeTimers();
    try {
      const writes: PersistedWindowState[] = [];
      const win = fakeWindow();
      installWindowStateTracker(
        win,
        { read: () => ({ status: "absent" }), write: (s) => writes.push(s) },
        () => {},
      );
      win.emit("move");
      win.emit("close");
      vi.advanceTimersByTime(WINDOW_STATE_SAVE_DELAY_MS * 2);
      expect(writes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed save instead of swallowing it", () => {
    const failure = new Error("disk full");
    const onError = vi.fn();
    const win = fakeWindow();
    installWindowStateTracker(
      win,
      {
        read: () => ({ status: "absent" }),
        write: () => {
          throw failure;
        },
      },
      onError,
    );
    win.emit("close");
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("does not save a destroyed window", () => {
    const write = vi.fn();
    const win = fakeWindow({ isDestroyed: () => true });
    installWindowStateTracker(
      win,
      { read: () => ({ status: "absent" }), write },
      () => {},
    );
    win.emit("close");
    expect(write).not.toHaveBeenCalled();
  });
});
