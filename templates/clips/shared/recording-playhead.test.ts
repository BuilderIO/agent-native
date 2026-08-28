// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
function findClipsRoot(): string {
  let current = resolve(process.cwd());
  while (true) {
    for (const candidate of [current, resolve(current, "templates/clips")]) {
      if (existsSync(resolve(candidate, "shared/recording-playhead.tsx"))) {
        return candidate;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not locate the Clips template from the test CWD");
    }
    current = parent;
  }
}

const clipsRoot = findClipsRoot();

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
    const confirmButton = container.querySelector<HTMLButtonElement>(
      ".recording-playhead__confirm-action",
    );
    expect(document.activeElement).toBe(confirmButton);
    expect(
      container.querySelector<HTMLButtonElement>(
        ".recording-playhead__extras-restart",
      )?.tabIndex,
    ).toBe(-1);

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

  it("reveals actions on the first touch or pen interaction", async () => {
    let expanded = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(RecordingPlayhead, {
          elapsedMs: 1_000,
          paused: false,
          meter: createElement("span"),
          labels,
          onStop: () => {},
          onTogglePause: () => {},
          onConfirmAction: () => {},
          onExpandedChange: (next) => {
            expanded = next;
          },
        }),
      );
      await Promise.resolve();
    });

    const event = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
    });
    await act(async () => {
      container
        ?.querySelector<HTMLElement>('[role="toolbar"]')
        ?.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(expanded).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    const expandedTouchEvent = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
    });
    await act(async () => {
      container
        ?.querySelector<HTMLElement>(".recording-playhead__timer")
        ?.dispatchEvent(expandedTouchEvent);
      await Promise.resolve();
    });
    expect(expandedTouchEvent.defaultPrevented).toBe(true);
  });

  it("keeps visible stop and pause buttons one-tap actions on touch", async () => {
    let stops = 0;
    let pauses = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(RecordingPlayhead, {
          elapsedMs: 1_000,
          paused: false,
          meter: createElement("span"),
          labels,
          onStop: () => {
            stops += 1;
          },
          onTogglePause: () => {
            pauses += 1;
          },
          onConfirmAction: () => {},
        }),
      );
      await Promise.resolve();
    });

    const stopButton = container.querySelector<HTMLButtonElement>(
      ".recording-playhead__stop",
    );
    const pauseButton = container.querySelector<HTMLButtonElement>(
      ".recording-playhead__pause",
    );
    for (const button of [stopButton, pauseButton]) {
      expect(button).not.toBeNull();
      const pointerEvent = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
      });
      await act(async () => {
        button?.dispatchEvent(pointerEvent);
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(pointerEvent.defaultPrevented).toBe(false);
    }

    expect(stops).toBe(1);
    expect(pauses).toBe(1);
  });

  it("keeps hidden confirmation actions out of tab navigation", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(RecordingPlayhead, {
          elapsedMs: 1_000,
          paused: false,
          meter: createElement("span"),
          labels,
          onStop: () => {},
          onTogglePause: () => {},
          onConfirmAction: () => {},
        }),
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLButtonElement>(
        ".recording-playhead__confirm-action",
      )?.tabIndex,
    ).toBe(-1);
    expect(
      container.querySelector<HTMLButtonElement>(
        ".recording-playhead__resume-action",
      )?.tabIndex,
    ).toBe(-1);
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

  it("guards desktop layout moves from position persistence", () => {
    const source = readFileSync(
      resolve(clipsRoot, "desktop/src/overlays/record-pill.tsx"),
      "utf8",
    );
    expect(source).toContain("NATIVE_LAYOUT_GUARD_MS");
    expect(source).toContain(
      "animatingUntilRef.current = Date.now() + NATIVE_LAYOUT_GUARD_MS",
    );
  });
});
