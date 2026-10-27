import { describe, expect, it, vi } from "vitest";

import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";

import {
  runEnterSingleScreen,
  type EnterSingleScreenArgs,
} from "./enter-single-screen";

function screen(id: string, width: number, height: number): OverviewScreen {
  return {
    id,
    filename: `${id}.html`,
    content: "",
    updatedAt: "",
    heightPinned: false,
    width,
    height,
  };
}

function makeArgs(
  overrides: Partial<EnterSingleScreenArgs> = {},
): EnterSingleScreenArgs {
  return {
    activeFileId: "home",
    canvasFrameGeometryById: {},
    clearPendingOverviewLayerSelectionTimer: vi.fn(),
    overviewScreens: [screen("home", 1440, 900), screen("mobile", 402, 874)],
    pendingOverviewLayerSelectionRef: { current: null },
    pendingOverviewScreenSelectionRef: { current: null },
    runEditorViewTransition: (update: () => void) => update(),
    screenZoomByIdRef: { current: new Map() },
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setCreatedOverviewLayerSelection: vi.fn(),
    setDrawMode: vi.fn(),
    setHoveredElement: vi.fn(),
    setInteractDeviceName: vi.fn(),
    setInteractDeviceSize: vi.fn(),
    setMode: vi.fn(),
    setPinMode: vi.fn(),
    setScreenZoom: vi.fn(),
    setSelectedElement: vi.fn(),
    setVectorEditingState: vi.fn(),
    setViewMode: vi.fn(),
    viewModeRef: { current: "overview" },
    ...overrides,
  };
}

describe("runEnterSingleScreen device", () => {
  it("adopts the entered screen's own size by default", () => {
    const args = makeArgs();

    runEnterSingleScreen(args, "mobile");

    expect(args.setInteractDeviceName).toHaveBeenCalledWith("iPhone 17");
    expect(args.setInteractDeviceSize).toHaveBeenCalledWith({
      width: 402,
      height: 874,
    });
  });

  it("keeps the device the person picked when moving between screens inside Interact", () => {
    const args = makeArgs({ viewModeRef: { current: "single" } });

    runEnterSingleScreen(args, "mobile", { keepInteractDevice: true });

    expect(args.setActiveFileId).toHaveBeenCalledWith("mobile");
    expect(args.setViewMode).toHaveBeenCalledWith("single");
    expect(args.setInteractDeviceName).not.toHaveBeenCalled();
    expect(args.setInteractDeviceSize).not.toHaveBeenCalled();
  });

  it("keeps the device on the in-place re-entry path too", () => {
    const args = makeArgs({ viewModeRef: { current: "single" } });

    runEnterSingleScreen(args, undefined, { keepInteractDevice: true });

    expect(args.setMode).toHaveBeenCalledWith("interact");
    expect(args.setInteractDeviceName).not.toHaveBeenCalled();
  });
});
