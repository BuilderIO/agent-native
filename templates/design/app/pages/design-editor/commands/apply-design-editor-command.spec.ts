// oracle-change: Annotate and the Draw tool were removed from Design, so their assertions are gone
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
    canEditDesign: true,
    canvasFrameGeometryById: {},
    files: [],
    id: "design-1",
    overviewScreens: [],
    setActiveFileId: vi.fn(),
    setActiveLeftPanel: vi.fn(),
    setActiveTool: vi.fn(),
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

  it("centers a focused screen at the command zoom", () => {
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
    expect(requestCameraFit.mock.calls[0]![1]).toEqual({
      screenId: "file-1",
      displayZoom: 50,
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

describe("runApplyDesignEditorCommand: single-screen focus", () => {
  it("enters the requested screen without fitting the overview", () => {
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
    expect(args.setViewMode).toHaveBeenCalledWith("single");
    expect(args.setActiveFileId).toHaveBeenCalledWith("file-1");
    expect(requestCameraFit).not.toHaveBeenCalled();
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

  it("applies a requested theme, and reads an unknown one as System", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactTheme: "dark",
    });
    expect(args.setInteractTheme).toHaveBeenLastCalledWith("dark");

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactTheme: "sepia",
    });
    expect(args.setInteractTheme).toHaveBeenLastCalledWith("system");
    expect(args.setInteractTheme).toHaveBeenCalledTimes(2);
  });

  it("keeps a requested Light as Light", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactTheme: "light",
    });

    expect(args.setInteractTheme).toHaveBeenCalledWith("light");
  });

  it("leaves the theme alone when a command names none", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactDevice: "Custom",
    });

    expect(args.setInteractTheme).not.toHaveBeenCalled();
  });

  it("applies a System request as System, not as a fixed scheme", () => {
    const args = makeArgs();

    runApplyDesignEditorCommand(args, {
      designId: "design-1",
      issuedAt: 0,
      interactTheme: "system",
    });

    expect(args.setInteractTheme).toHaveBeenCalledWith("system");
  });
});

describe("runApplyDesignEditorCommand: retired Draw tool", () => {
  it("lands a stale tool=draw on Move and Design", () => {
    const args = makeArgs();

    expect(
      runApplyDesignEditorCommand(args, {
        designId: "design-1",
        issuedAt: 0,
        tool: "draw",
      }),
    ).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledExactlyOnceWith("move");
    expect(args.setMode).toHaveBeenCalledWith("edit");
    expect(args.setPinMode).toHaveBeenCalledWith(false);
  });
});

describe("runApplyDesignEditorCommand: retired Agent tool and Comment tool", () => {
  it("lands a stale tool=agent on Move and leaves the left panel alone", () => {
    const args = makeArgs();

    expect(
      runApplyDesignEditorCommand(args, {
        designId: "design-1",
        issuedAt: 0,
        tool: "agent",
      }),
    ).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledExactlyOnceWith("move");
    expect(args.setActiveLeftPanel).not.toHaveBeenCalled();
    expect(args.setMode).toHaveBeenCalledWith("edit");
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

  it("arms the Comment tool in pin mode and opens the Threads panel for tool=comment", () => {
    const args = makeArgs();

    expect(
      runApplyDesignEditorCommand(args, {
        designId: "design-1",
        issuedAt: 0,
        tool: "comment",
      }),
    ).toBe(true);

    expect(args.setActiveTool).toHaveBeenCalledWith("comment");
    expect(args.setPinMode).toHaveBeenCalledWith(true);
    expect(args.setMode).toHaveBeenCalledWith("comment");
    expect(args.setActiveLeftPanel).toHaveBeenCalledWith("threads");
  });
});
