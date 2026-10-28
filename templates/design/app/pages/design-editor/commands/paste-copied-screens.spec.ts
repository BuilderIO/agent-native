// @vitest-environment happy-dom

import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import type { VisibleCanvasRect } from "@/components/design/multi-screen/types";
import type { DesignClipboardScreenEntry } from "@/lib/design-import";

import {
  runPasteCopiedScreens,
  type PasteCopiedScreensArgs,
} from "./paste-copied-screens";

const SCREEN_CONTENT = `<!doctype html><html><body><div data-agent-native-node-id="box"></div></body></html>`;
const OFF_SCREEN_VIEW: VisibleCanvasRect = {
  x: 3000,
  y: 3000,
  width: 1000,
  height: 600,
};

const IN_VIEW: VisibleCanvasRect = { x: 0, y: 0, width: 1000, height: 800 };

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

function screen(
  canvasFrame: DesignClipboardScreenEntry["canvasFrame"],
  filename = "index.html",
  sourceScreenId?: string,
): DesignClipboardScreenEntry {
  return {
    filename,
    fileType: "html",
    content: SCREEN_CONTENT,
    sourceScreenId,
    canvasFrame,
  };
}

function harness(
  overrides: {
    visibleRect?: VisibleCanvasRect | null;
    currentFrames?: CanvasFrameGeometryById;
  } = {},
) {
  const saved: CanvasFrameGeometryById[] = [];
  let created = 0;
  const args: PasteCopiedScreensArgs = {
    canEditDesign: true,
    canvasFrameGeometryById: overrides.currentFrames ?? {},
    createFileMutation: {
      mutate: (_variables: unknown, options: any) => {
        created += 1;
        options.onSuccess({ id: `copy-${created}` });
      },
    } as unknown as PasteCopiedScreensArgs["createFileMutation"],
    files: [],
    getVisibleCanvasRect: () => overrides.visibleRect ?? null,
    id: "design-1",
    overviewScreens: Object.keys(overrides.currentFrames ?? {}).map(
      (screenId) => ({
        id: screenId,
        filename: `${screenId}.html`,
        content: SCREEN_CONTENT,
        updatedAt: "2026-01-01T00:00:00.000Z",
        heightPinned: false,
        width: 390,
        height: 844,
      }),
    ),
    pasteCascadeRef: ref(0),
    queryClient: {
      invalidateQueries: vi.fn(),
    } as unknown as PasteCopiedScreensArgs["queryClient"],
    queueFrameGeometrySave: (geometry) => {
      saved.push(geometry);
    },
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    setViewMode: vi.fn(),
    t: (key) => key,
    viewModeRef: ref("overview" as "single" | "overview"),
  };
  return { args, saved };
}

describe("pasting copied screens with no explicit drop point", () => {
  it("centers a screen in the view when its original is off-screen", () => {
    const { args, saved } = harness({ visibleRect: OFF_SCREEN_VIEW });

    runPasteCopiedScreens(args, [
      screen({ x: 0, y: 0, width: 390, height: 844 }),
    ]);

    expect(saved[0]!["copy-1"]).toMatchObject({
      x: 3500 - 195,
      y: 3300 - 422,
    });
  });

  it("keeps copied screens' layout relative to each other when centering", () => {
    const { args, saved } = harness({ visibleRect: OFF_SCREEN_VIEW });

    runPasteCopiedScreens(args, [
      screen({ x: 0, y: 0, width: 390, height: 844 }),
      screen({ x: 500, y: 100, width: 390, height: 844 }, "second.html"),
    ]);

    const first = saved[0]!["copy-1"]!;
    const second = saved[1]!["copy-2"]!;
    expect(first.x! + 445).toBe(3500);
    expect(second.x! - first.x!).toBe(500);
    expect(second.y! - first.y!).toBe(100);
  });

  it("puts a screen with no recorded position at the view center, not the canvas origin", () => {
    const { args, saved } = harness({ visibleRect: OFF_SCREEN_VIEW });

    runPasteCopiedScreens(args, [screen(undefined)]);

    expect(saved[0]!["copy-1"]).toMatchObject({ x: 3500, y: 3300 });
  });

  it("keeps the offset beside the original while it is in view", () => {
    const { args, saved } = harness({
      visibleRect: { x: 0, y: 0, width: 1000, height: 800 },
    });

    runPasteCopiedScreens(args, [
      screen({ x: 100, y: 50, width: 390, height: 844 }),
    ]);

    expect(saved[0]!["copy-1"]).toMatchObject({ x: 132, y: 82 });
  });

  it("steps repeated pastes so the copies do not stack exactly", () => {
    const { args, saved } = harness({ visibleRect: OFF_SCREEN_VIEW });
    const source = screen({ x: 0, y: 0, width: 390, height: 844 });

    runPasteCopiedScreens(args, [source]);
    runPasteCopiedScreens(args, [source]);

    const first = saved[0]!["copy-1"]!;
    const second = saved[1]!["copy-2"]!;
    expect(second.x! - first.x!).toBe(16);
    expect(second.y! - first.y!).toBe(16);
  });

  it("pastes at an explicit point even when the original is off-screen", () => {
    const { args, saved } = harness({ visibleRect: OFF_SCREEN_VIEW });

    runPasteCopiedScreens(
      args,
      [screen({ x: 0, y: 0, width: 390, height: 844 })],
      { x: 40, y: 60 },
    );

    expect(saved[0]!["copy-1"]).toMatchObject({ x: 40, y: 60 });
  });

  it("does not consult the view outside the overview", () => {
    const { args, saved } = harness({ visibleRect: OFF_SCREEN_VIEW });
    args.viewModeRef.current = "single";

    runPasteCopiedScreens(args, [
      screen({ x: 0, y: 0, width: 390, height: 844 }),
    ]);

    expect(saved[0]!["copy-1"]).toMatchObject({ x: 32, y: 32 });
  });

  it("centers a screen in the view when it was in view at copy time but has since moved off-screen", () => {
    const { args, saved } = harness({
      visibleRect: IN_VIEW,
      currentFrames: { source: { x: 5000, y: 0, width: 390, height: 844 } },
    });

    runPasteCopiedScreens(args, [
      screen(
        { x: 100, y: 50, width: 390, height: 844 },
        "index.html",
        "source",
      ),
    ]);

    expect(saved[0]!["copy-1"]).toMatchObject({
      x: 500 - 195,
      y: 400 - 422,
    });
  });

  it("pastes beside the original's current position when it moved into view after being copied off-screen", () => {
    const { args, saved } = harness({
      visibleRect: IN_VIEW,
      currentFrames: { source: { x: 100, y: 50, width: 390, height: 844 } },
    });

    runPasteCopiedScreens(args, [
      screen(
        { x: 5000, y: 0, width: 390, height: 844 },
        "index.html",
        "source",
      ),
    ]);

    expect(saved[0]!["copy-1"]).toMatchObject({ x: 132, y: 82 });
  });

  it("falls back to where the screen was copied from when the clipboard has no source id", () => {
    const { args, saved } = harness({
      visibleRect: IN_VIEW,
      currentFrames: { other: { x: 5000, y: 0, width: 390, height: 844 } },
    });

    runPasteCopiedScreens(args, [
      screen({ x: 100, y: 50, width: 390, height: 844 }),
    ]);

    expect(saved[0]!["copy-1"]).toMatchObject({ x: 132, y: 82 });
  });

  it("falls back to where the screen was copied from when the original was deleted", () => {
    const { args, saved } = harness({
      visibleRect: IN_VIEW,
      currentFrames: { other: { x: 0, y: 0, width: 390, height: 844 } },
    });

    runPasteCopiedScreens(args, [
      screen({ x: 5000, y: 0, width: 390, height: 844 }, "index.html", "gone"),
    ]);
    runPasteCopiedScreens(args, [
      screen({ x: 100, y: 50, width: 390, height: 844 }, "index.html", "gone"),
    ]);

    expect(saved[0]!["copy-1"]).toMatchObject({
      x: 500 - 195,
      y: 400 - 422,
    });
    expect(saved[1]!["copy-2"]).toMatchObject({ x: 148, y: 98 });
  });

  it("lays out screens copied together by where their originals are now", () => {
    const { args, saved } = harness({
      visibleRect: OFF_SCREEN_VIEW,
      currentFrames: {
        first: { x: 0, y: 0, width: 390, height: 844 },
        second: { x: 800, y: 300, width: 390, height: 844 },
      },
    });

    runPasteCopiedScreens(args, [
      screen({ x: 0, y: 0, width: 390, height: 844 }, "first.html", "first"),
      screen(
        { x: 500, y: 100, width: 390, height: 844 },
        "second.html",
        "second",
      ),
    ]);

    const first = saved[0]!["copy-1"]!;
    const second = saved[1]!["copy-2"]!;
    expect(second.x! - first.x!).toBe(800);
    expect(second.y! - first.y!).toBe(300);
  });

  it("keeps pasting beside a screen whose current frame was never saved, using where it renders now", () => {
    const { args, saved } = harness({
      visibleRect: IN_VIEW,
      currentFrames: { source: {} },
    });

    runPasteCopiedScreens(args, [screen(undefined, "index.html", "source")]);

    expect(saved[0]!["copy-1"]).toMatchObject({ x: 32, y: 32 });
  });
});
