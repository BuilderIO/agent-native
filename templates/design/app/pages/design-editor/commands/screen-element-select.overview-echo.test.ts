import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runScreenElementSelect } from "./screen-element-select";

function makeArgs(overrides: {
  overviewSelectedScreenIds: string[];
  onOverviewSelectedScreenIdsChange: (next: string[]) => void;
}) {
  let overviewSelectedScreenIds = overrides.overviewSelectedScreenIds;
  const pendingOverviewLayerSelectionRef = {
    current: null as string | null,
  };
  const pendingOverviewScreenSelectionRef = {
    current: null as string | null,
  };
  return {
    activeBreakpointWidthStateRef: { current: undefined },
    applyFileContentUpdate: vi.fn(),
    clearPendingOverviewLayerSelectionTimer: vi.fn(),
    focusDesignInspectorForSelection: vi.fn(),
    getCodeLayerProjectionForScreen: () => null,
    getScreenContent: () => "",
    handleBreakpointBarSelect: vi.fn(),
    id: "design-1",
    createdOverviewLayerSelection: null,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    selectedLayerIdsState: [],
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setCreatedOverviewLayerSelection: vi.fn(),
    setHoveredElement: vi.fn(),
    setHoveredElementScreenId: vi.fn(),
    setMode: vi.fn(),
    setOverviewSelectedScreenIds: (
      updater: string[] | ((current: string[]) => string[]),
    ) => {
      overviewSelectedScreenIds =
        typeof updater === "function"
          ? updater(overviewSelectedScreenIds)
          : updater;
      overrides.onOverviewSelectedScreenIdsChange(overviewSelectedScreenIds);
    },
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    shouldPreserveBlockedOverviewLayerSelectionRef: { current: () => false },
    t: (key: string) => key,
    viewModeRef: { current: "overview" as const },
  };
}

const info: ElementInfo = {
  tagName: "DIV",
  selector: "div",
} as ElementInfo;

describe("runScreenElementSelect — overview screen selection on intent-less echo", () => {
  it("preserves a live overview screen selection on an intent-less re-anchoring echo", () => {
    let result: string[] = ["desk-screen"];
    const args = makeArgs({
      overviewSelectedScreenIds: ["desk-screen"],
      onOverviewSelectedScreenIdsChange: (next) => {
        result = next;
      },
    });
    expect(runScreenElementSelect(args, "screen-1", info)).toBe(true);
    expect(result).toEqual(["desk-screen"]);
  });

  it("still clears the overview screen selection on a real, intent-carrying pick", () => {
    let result: string[] = ["desk-screen"];
    const args = makeArgs({
      overviewSelectedScreenIds: ["desk-screen"],
      onOverviewSelectedScreenIdsChange: (next) => {
        result = next;
      },
    });
    expect(
      runScreenElementSelect(args, "screen-1", info, { metaKey: false }),
    ).toBe(true);
    expect(result).toEqual([]);
  });

  it("rejects the mirrored layer-panel echo before guidance can count it", () => {
    const args = makeArgs({
      overviewSelectedScreenIds: ["desk-screen"],
      onOverviewSelectedScreenIdsChange: () => {},
    });
    args.pendingOverviewLayerSelectionRef.current = "layer-1";
    args.pendingOverviewScreenSelectionRef.current = "screen-1";

    expect(
      runScreenElementSelect(
        args,
        "screen-1",
        { ...info, sourceId: "layer-1" },
        { source: "pointer" },
      ),
    ).toBe(false);
  });
});
