// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecordingPlayheadConfirmChange,
  RecordingPlayheadLabels,
} from "./recording-playhead";
import { RecordingPlayhead } from "./recording-playhead";

const labels: RecordingPlayheadLabels = {
  controls: "Recording controls",
  stop: "Stop",
  pause: "Pause",
  resume: "Resume",
  pauseShortcut: "Pause",
  resumeShortcut: "Resume",
  restart: "Restart",
  restartShortcut: "Restart",
  delete: "Delete",
  deleteShortcut: "Delete",
  restartQuestion: "Start a new recording?",
  deleteQuestion: () => "Delete recording?",
  restartConfirm: "Restart",
  deleteConfirm: "Delete",
  resumeConfirm: "Resume",
};
const clipsRoot = resolve(process.cwd());

describe("the recording playhead has a shared visual source", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("keeps the component and its styles in shared/", () => {
    expect(
      existsSync(resolve(clipsRoot, "shared/recording-playhead.tsx")),
    ).toBe(true);
    expect(
      existsSync(resolve(clipsRoot, "shared/recording-playhead.css")),
    ).toBe(true);
  });

  it("routes both recorder surfaces through the shared component", () => {
    const consumers = [
      resolve(clipsRoot, "app/components/recorder/recording-toolbar.tsx"),
      resolve(clipsRoot, "desktop/src/overlays/record-pill.tsx"),
    ];
    for (const consumer of consumers) {
      expect(readFileSync(consumer, "utf8"), consumer).toContain(
        "recording-playhead",
      );
    }
  });

  it("closes confirmation through the parent callback when disabled", async () => {
    const changes: RecordingPlayheadConfirmChange[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const render = (enabled: boolean) =>
      createElement(RecordingPlayhead, {
        elapsedMs: 1_000,
        paused: false,
        enabled,
        meter: createElement("span"),
        labels,
        confirmRequest: { intent: "delete", token: 1 },
        onStop: () => {},
        onTogglePause: () => {},
        onConfirmAction: () => {},
        onConfirmChange: (change) => changes.push(change),
      });

    await act(async () => {
      root?.render(render(true));
      await Promise.resolve();
    });
    expect(changes).toContainEqual({
      type: "open",
      intent: "delete",
      enteredPaused: false,
    });

    await act(async () => {
      root?.render(render(false));
      await Promise.resolve();
    });
    expect(changes[changes.length - 1]).toEqual({
      type: "close",
      intent: "delete",
      enteredPaused: false,
      resume: false,
    });
  });

  it("guards native layout reports while a playhead transition is pending", () => {
    const source = readFileSync(
      resolve(clipsRoot, "shared/recording-playhead.tsx"),
      "utf8",
    );
    expect(source).toContain("if (layoutTransitionPendingRef.current) return;");
    expect(source).toContain("layoutTransitionPendingRef.current = true;");
    expect(source).toContain("layoutTransitionPendingRef.current = false;");
  });

  it("feeds measured playhead bounds into the web drag clamp", () => {
    const source = readFileSync(
      resolve(clipsRoot, "app/components/recorder/recording-toolbar.tsx"),
      "utf8",
    );
    expect(source).toContain("onLayoutChange={handlePlayheadLayoutChange}");
    expect(source).toContain("toolbarLayoutRef.current");
    expect(source).toContain("nextLayout");
  });
});
