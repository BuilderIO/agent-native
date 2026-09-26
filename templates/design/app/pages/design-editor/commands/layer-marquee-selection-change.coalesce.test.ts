import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  coalesceMarqueeSelectionHistory,
  runMarqueeSelectionCancellation,
} from "./layer-marquee-selection-change";

describe("coalesceMarqueeSelectionHistory", () => {
  it("records exactly one history entry for each consecutive gesture", () => {
    const pendingBefore: { current: string[] | null } = { current: null };
    const ticks: Array<{ before: string[]; after: string[]; final: boolean }> =
      [
        { before: [], after: [], final: false },
        { before: [], after: ["a"], final: false },
        { before: ["a"], after: ["a", "b"], final: false },
        { before: ["a", "b"], after: ["a", "b"], final: true },
      ];
    const recorded = ticks.map((tick) =>
      coalesceMarqueeSelectionHistory(
        pendingBefore,
        tick.final,
        tick.before,
        tick.after,
      ),
    );
    expect(recorded.filter(Boolean)).toHaveLength(1);
    expect(recorded[3]).toEqual({ before: [], after: ["a", "b"] });
    const nextRecorded = [
      coalesceMarqueeSelectionHistory(pendingBefore, false, ["a", "b"], ["c"]),
      coalesceMarqueeSelectionHistory(pendingBefore, true, ["c"], ["c", "d"]),
    ];
    expect(nextRecorded.filter(Boolean)).toHaveLength(1);
    expect(nextRecorded[1]).toEqual({
      before: ["a", "b"],
      after: ["c", "d"],
    });
    expect(pendingBefore.current).toBeNull();
  });

  it("forwards the bridge final marker into marquee history", () => {
    const source = readFileSync(
      new URL("../../DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("const handleScreenElementMarqueeSelect");
    const end = source.indexOf("const handleElementMarqueeSelect", start);
    expect(source.slice(start, end)).toContain("final: intent?.final === true");
  });

  it("restores the host element and layer selection when Escape cancels a marquee", () => {
    const source = readFileSync(
      new URL("../../DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf(
      'if (intent.source === "marquee" && intent.cancelled)',
    );
    const end = source.indexOf(
      'if (intent.source === "marquee" && intent.resetHistory)',
      start,
    );
    const cancellation = source.slice(start, end);

    expect(cancellation).toContain(
      "const before = marqueeSelectionHistoryBeforeRef.current",
    );
    expect(cancellation).toContain("runMarqueeSelectionCancellation({");
    expect(cancellation).toContain(
      "restoreHostSelection: intent.restoreHostSelection === true",
    );
    expect(cancellation).not.toContain("pushSelectionHistoryEntry");
    expect(source).toContain(
      "marqueeSelectedElementBeforeRef.current = selectedElementRef.current",
    );
  });

  it("restores the pre-gesture host snapshot atomically without recording history", () => {
    const before = { selectedLayerIds: ["layer-before"] };
    const selectedElementBefore = {
      selector: "#before",
    } as unknown as ElementInfo;
    let selectedLayerIds = ["layer-hit"];
    let selectedElement: ElementInfo | null = {
      selector: "#hit",
    } as unknown as ElementInfo;
    const steps: string[] = [];
    const restoreSelectionSnapshot = vi.fn((selection: typeof before) => {
      selectedLayerIds = selection.selectedLayerIds;
      steps.push("layers");
    });
    const setSelectedElement = vi.fn((element: ElementInfo | null) => {
      selectedElement = element;
      steps.push("element");
    });
    const run = vi.fn(() => steps.push("cancel"));
    const flushSync = vi.fn((callback: () => void) => callback());

    runMarqueeSelectionCancellation({
      before,
      flushSync,
      restoreHostSelection: true,
      restoreSelectionSnapshot,
      run,
      selectedElementBefore,
      setSelectedElement,
    });

    expect(flushSync).toHaveBeenCalledTimes(1);
    expect(selectedLayerIds).toEqual(["layer-before"]);
    expect(selectedElement).toBe(selectedElementBefore);
    expect(steps).toEqual(["layers", "element", "cancel"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves a newer host selection untouched when delayed release cancels", () => {
    const before = { selectedLayerIds: ["layer-before"] };
    const selectedElementBefore = {
      selector: "#before",
    } as unknown as ElementInfo;
    let selectedLayerIds = ["layer-newer"];
    let selectedElement: ElementInfo | null = {
      selector: "#newer",
    } as unknown as ElementInfo;
    const restoreSelectionSnapshot = vi.fn((selection: typeof before) => {
      selectedLayerIds = selection.selectedLayerIds;
    });
    const setSelectedElement = vi.fn((element: ElementInfo | null) => {
      selectedElement = element;
    });
    const run = vi.fn();
    const flushSync = vi.fn((callback: () => void) => callback());

    runMarqueeSelectionCancellation({
      before,
      flushSync,
      restoreHostSelection: false,
      restoreSelectionSnapshot,
      run,
      selectedElementBefore,
      setSelectedElement,
    });

    expect(flushSync).not.toHaveBeenCalled();
    expect(restoreSelectionSnapshot).not.toHaveBeenCalled();
    expect(setSelectedElement).not.toHaveBeenCalled();
    expect(selectedLayerIds).toEqual(["layer-newer"]);
    expect(selectedElement).toEqual({ selector: "#newer" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("captures the gesture's start selection even when the first reported tick already changed it", () => {
    const pendingBefore: { current: string[] | null } = { current: null };
    coalesceMarqueeSelectionHistory(pendingBefore, false, ["x"], ["a"]);
    const entry = coalesceMarqueeSelectionHistory(
      pendingBefore,
      true,
      ["a"],
      ["a", "b"],
    );
    expect(entry).toEqual({ before: ["x"], after: ["a", "b"] });
  });

  it("a click with no drag (a single final tick, no intermediate ticks) still records one entry", () => {
    const pendingBefore: { current: string[] | null } = { current: null };
    const entry = coalesceMarqueeSelectionHistory(
      pendingBefore,
      true,
      ["a"],
      [],
    );
    expect(entry).toEqual({ before: ["a"], after: [] });
  });
});
