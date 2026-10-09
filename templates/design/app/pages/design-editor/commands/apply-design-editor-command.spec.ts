import { describe, expect, it, vi } from "vitest";

import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  runApplyDesignEditorCommand,
  type ApplyDesignEditorCommandArgs,
} from "./apply-design-editor-command";

function makeArgs(
  overrides: Partial<ApplyDesignEditorCommandArgs> = {},
): ApplyDesignEditorCommandArgs {
  return {
    annotateLab: "on",
    canEditDesign: true,
    canvasFrameGeometryById: {},
    files: [],
    id: "design-1",
    overviewScreens: [],
    setActiveFileId: vi.fn(),
    setActiveLeftPanel: vi.fn(),
    setActiveTool: vi.fn(),
    setDrawMode: vi.fn(),
    setInteractDeviceName: vi.fn(),
    setInteractDeviceSize: vi.fn(),
    setInteractTheme: vi.fn(),
    setMode: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setOverviewInteractScreenId: vi.fn(),
    overviewInteractScreenIdRef: { current: "screen-old" },
    setPinMode: vi.fn(),
    setScreenZoom: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    setViewMode: vi.fn(),
    setZoomForView: vi.fn(),
    viewModeRef: { current: "single" },
    ...overrides,
  };
}

const screenFile: DesignFile = {
  id: "file-1",
  filename: "index.html",
} as DesignFile;
const overviewScreen: OverviewScreen = {
  id: "file-1",
  filename: "index.html",
  content: "",
  updatedAt: "",
  heightPinned: false,
};

describe("runApplyDesignEditorCommand: overview camera fit", () => {
  it("fits the camera to a named screen's real geometry", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      canvasFrameGeometryById: {
        "file-1": { x: 100, y: 200, width: 1440, height: 1024 },
      },
      requestCameraFit,
    });

    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
    });

    expect(applied).toBe(true);
    expect(args.setActiveFileId).toHaveBeenCalledWith("file-1");
    expect(args.setOverviewSelectedScreenIds).toHaveBeenCalledWith(["file-1"]);
    expect(args.setSelectedLayerIdsState).toHaveBeenCalledWith(["file-1"]);
    expect(args.setOverviewInteractScreenId).toHaveBeenCalledWith(null);
    expect(args.overviewInteractScreenIdRef?.current).toBeNull();
    expect(requestCameraFit).toHaveBeenCalledTimes(1);
    const camera = requestCameraFit.mock.calls[0]![0];
    expect(camera.fitBounds).toMatchObject({
      left: 100,
      top: 200,
      right: 100 + 1440,
      bottom: 200 + 1024,
    });
  });

  it("fits using the canvas fallback when geometry is not persisted yet", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      canvasFrameGeometryById: {},
      requestCameraFit,
    });

    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
    });

    expect(applied).toBe(true);
    expect(requestCameraFit).toHaveBeenCalledTimes(1);
    expect(requestCameraFit.mock.calls[0]![0].fitBounds).toMatchObject({
      left: 0,
      top: 0,
      right: 320,
    });
  });

  it("does not treat an overview owner Screen as explicitly selected for a child command selection", () => {
    const setExplicitOverviewScreenSelection = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      setExplicitOverviewScreenSelection,
    });

    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
      selection: "code:layer-1",
    });

    expect(applied).toBe(true);
    expect(args.setOverviewSelectedScreenIds).toHaveBeenCalledWith(["file-1"]);
    expect(setExplicitOverviewScreenSelection).toHaveBeenCalledWith([]);
  });

  it("marks a command that selects a Screen root as explicit overview selection", () => {
    const setExplicitOverviewScreenSelection = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      setExplicitOverviewScreenSelection,
    });

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      selection: "code:file-1",
    });

    expect(setExplicitOverviewScreenSelection).toHaveBeenCalledWith(["file-1"]);
  });

  it("fits the rendered responsive layout-group fallback", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({
      files: [screenFile, { ...screenFile, id: "file-2" }],
      overviewScreens: [
        {
          ...overviewScreen,
          layoutGroupId: "group-1",
          breakpointWidths: [390],
        },
        {
          ...overviewScreen,
          id: "file-2",
          layoutGroupId: "group-1",
          breakpointWidths: [390],
        },
      ],
      requestCameraFit,
    });

    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-2",
    });

    expect(applied).toBe(true);
    expect(requestCameraFit).toHaveBeenCalledTimes(1);
    expect(requestCameraFit.mock.calls[0]![0].fitBounds.left).toBeCloseTo(
      497.5,
      2,
    );
  });

  it("does not fit when the command names no screen", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({ requestCameraFit });

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
    });

    expect(requestCameraFit).not.toHaveBeenCalled();
  });

  it("centers and fits a focused screen when the command also has a zoom", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      requestCameraFit,
    });

    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
      zoom: 50,
    });

    expect(applied).toBe(true);
    expect(args.setZoomForView).not.toHaveBeenCalled();
    expect(requestCameraFit).toHaveBeenCalledOnce();
    expect(requestCameraFit.mock.calls[0]![0].fitBounds).toMatchObject({
      left: 0,
      top: 0,
      right: 320,
    });
  });

  it("defers overview zoom until the design payload has loaded", () => {
    const args = makeArgs({
      files: [screenFile],
      overviewDataReady: false,
    });

    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
      zoom: 200,
    });

    expect(applied).toBe(false);
    expect(args.setZoomForView).not.toHaveBeenCalled();
  });
});

describe("runApplyDesignEditorCommand: widget open", () => {
  const responsiveScreen: OverviewScreen = {
    ...overviewScreen,
    width: 1440,
    height: 900,
    breakpointWidths: [390],
    breakpointHeights: { "390": 1181 },
  };

  it("fits the screen together with its breakpoint frames", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [responsiveScreen],
      canvasFrameGeometryById: {
        "file-1": { x: 0, y: 0, width: 1440, height: 900 },
      },
      requestCameraFit,
    });

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
    });

    expect(requestCameraFit.mock.calls[0]![0].fitBounds).toMatchObject({
      left: 0,
      top: 0,
      right: 1440 + 24 + 390,
      bottom: 1181,
    });
  });

  it("frames the opened screen without selecting it, so no inspector opens over the canvas", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      requestCameraFit,
      selectTargetScreen: false,
    });

    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
    });

    expect(applied).toBe(true);
    expect(args.setViewMode).toHaveBeenCalledWith("overview");
    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setOverviewSelectedScreenIds).not.toHaveBeenCalled();
    expect(args.setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(requestCameraFit).toHaveBeenCalledTimes(1);
  });

  it("still selects an explicitly requested layer", () => {
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      selectTargetScreen: false,
    });

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "overview",
      screen: "file-1",
      selection: "code:layer-1",
    });

    expect(args.setSelectedLayerIdsState).toHaveBeenCalledWith([
      "code:layer-1",
    ]);
  });
});

describe("runApplyDesignEditorCommand: screen focus stays on All screens", () => {
  it("keeps legacy single-screen focus commands in the overview and fits the target", () => {
    const requestCameraFit = vi.fn();
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      requestCameraFit,
    });
    const applied = runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      editorView: "single",
      screen: "file-1",
      mode: "interact",
    });
    expect(applied).toBe(true);
    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setViewMode).toHaveBeenCalledWith("overview");
    expect(args.setSelectedLayerIdsState).toHaveBeenCalledWith(["file-1"]);
    expect(requestCameraFit).toHaveBeenCalledTimes(1);
    expect(args.setScreenZoom).not.toHaveBeenCalled();
  });
});

describe("runApplyDesignEditorCommand: Interact device and theme", () => {
  const focus = {
    designId: "design-1",
    issuedAt: 0,
    editorView: "single",
    screen: "file-1",
  } as const;

  it("applies a requested device after the one derived from the screen", () => {
    const calls: string[] = [];
    const args = makeArgs({
      files: [screenFile],
      overviewScreens: [overviewScreen],
      setInteractDeviceName: vi.fn((name) =>
        calls.push(`name:${String(name)}`),
      ),
    });

    runApplyDesignEditorCommand(args, {
      ...focus,
      interactDevice: "iPhone 17",
    });

    expect(calls[calls.length - 1]).toBe("name:iPhone 17");
    expect(args.setInteractDeviceSize).toHaveBeenLastCalledWith({
      width: 402,
      height: 874,
    });
  });

  it("applies a requested device without changing the view", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactDevice: 'iPad Pro 11" Landscape',
    });

    expect(args.setInteractDeviceName).toHaveBeenCalledWith(
      'iPad Pro 11" Landscape',
    );
    expect(args.setInteractDeviceSize).toHaveBeenCalledWith({
      width: 1194,
      height: 834,
    });
    expect(args.setViewMode).not.toHaveBeenCalled();
  });

  it("ignores a device that is not a selectable preset", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactDevice: "Custom",
    });
    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactDevice: "Toaster",
    });

    expect(args.setInteractDeviceName).not.toHaveBeenCalled();
    expect(args.setInteractDeviceSize).not.toHaveBeenCalled();
  });

  it("applies a requested theme and ignores an unknown one", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactTheme: "dark",
    });
    expect(args.setInteractTheme).toHaveBeenCalledWith("dark");

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactTheme: "sepia",
    });
    expect(args.setInteractTheme).toHaveBeenCalledTimes(1);
  });

  it("reads a retired System request as Light", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactTheme: "system",
    });

    expect(args.setInteractTheme).toHaveBeenCalledWith("light");
  });
});

describe("runApplyDesignEditorCommand: Annotate lab", () => {
  const drawCommand = {
    designId: "design-1",
    issuedAt: 0,
    tool: "draw",
  } as const;
  const annotateFocusCommand = {
    designId: "design-1",
    issuedAt: 0,
    editorView: "single",
    screen: "file-1",
    mode: "annotate",
  } as const;
  const focusFiles = {
    files: [screenFile],
    overviewScreens: [overviewScreen],
  };

  it("starts the Draw tool when the lab is on", () => {
    const args = makeArgs({ annotateLab: "on" });

    expect(runApplyDesignEditorCommand(args, drawCommand)).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledWith("draw");
    expect(args.setMode).toHaveBeenCalledWith("annotate");
    expect(args.setDrawMode).toHaveBeenCalledWith(true);
    expect(args.setPinMode).toHaveBeenCalledWith(false);
  });

  it("lands a stale Draw request on Move and Design when the lab is off", () => {
    const args = makeArgs({ annotateLab: "off" });

    expect(runApplyDesignEditorCommand(args, drawCommand)).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledWith("move");
    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setDrawMode).toHaveBeenCalledWith(false);
    expect(args.setActiveTool).not.toHaveBeenCalledWith("draw");
    expect(args.setMode).not.toHaveBeenCalledWith("annotate");
    expect(args.setDrawMode).not.toHaveBeenCalledWith(true);
  });

  it("lands a focused-screen Annotate request on the Overview in Design when the lab is on", () => {
    const args = makeArgs({ annotateLab: "on", ...focusFiles });

    expect(runApplyDesignEditorCommand(args, annotateFocusCommand)).toBe(true);

    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setMode).not.toHaveBeenCalledWith("annotate");
    expect(args.setViewMode).toHaveBeenCalledWith("overview");
  });

  it("lands a stale Annotate request on Design when the lab is off", () => {
    const args = makeArgs({ annotateLab: "off", ...focusFiles });

    expect(runApplyDesignEditorCommand(args, annotateFocusCommand)).toBe(true);

    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setMode).not.toHaveBeenCalledWith("annotate");
    expect(args.setViewMode).toHaveBeenCalledWith("overview");
  });

  it("waits for the Labs answer instead of refusing Draw or Annotate", () => {
    for (const command of [drawCommand, annotateFocusCommand]) {
      const args = makeArgs({ annotateLab: "loading", ...focusFiles });

      expect(runApplyDesignEditorCommand(args, command)).toBe(false);

      expect(args.setActiveTool).not.toHaveBeenCalled();
      expect(args.setMode).not.toHaveBeenCalled();
      expect(args.setDrawMode).not.toHaveBeenCalled();
      expect(args.setViewMode).not.toHaveBeenCalled();
    }
  });

  it("does not hold up a command that needs no lab while it loads", () => {
    const args = makeArgs({ annotateLab: "loading" });

    expect(
      runApplyDesignEditorCommand(args, {
        designId: "design-1",
        issuedAt: 0,
        tool: "rect",
      }),
    ).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledWith("rect");
  });
});

describe("runApplyDesignEditorCommand: Agent and Comment tools", () => {
  it("arms the Agent tool and opens the Agent panel for tool=agent", () => {
    const args = makeArgs();

    expect(
      runApplyDesignEditorCommand(args, {
        designId: "design-1",
        issuedAt: 0,
        tool: "agent",
      }),
    ).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledWith("agent");
    expect(args.setActiveLeftPanel).toHaveBeenCalledWith("agent");
    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setDrawMode).toHaveBeenCalledWith(false);
    expect(args.setPinMode).toHaveBeenCalledWith(false);
  });

  it("leaves the left panel alone for every other tool", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      tool: "pen",
    });

    expect(args.setActiveLeftPanel).not.toHaveBeenCalled();
  });

  it("lands a request for the hidden Comment tool on Move, with no pin mode", () => {
    const args = makeArgs();

    expect(
      runApplyDesignEditorCommand(args, {
        designId: "design-1",
        issuedAt: 0,
        tool: "comment",
      }),
    ).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledWith("move");
    expect(args.setActiveTool).not.toHaveBeenCalledWith("comment");
    expect(args.setPinMode).toHaveBeenCalledWith(false);
    expect(args.setPinMode).not.toHaveBeenCalledWith(true);
    expect(args.setMode).toHaveBeenCalledWith("edit");
  });
});
