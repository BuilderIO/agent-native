import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runMarqueeSelectionCancellation } from "./layer-marquee-selection-change";

describe("runMarqueeSelectionCancellation", () => {
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
});
