/**
 * Tests for the URL/`navigate`-command → overview camera-fit wiring.
 *
 * A command naming a screen (`screen=`/`fileId=` etc. — see
 * screen-command-utils.ts) only ever comes from a URL query string or an
 * equivalent `navigate` app-state write, never an ordinary in-canvas
 * interaction. Landing in overview mode with such a command should reveal
 * the named screen the same way a freshly-created screen is revealed
 * (`focusCreatedScreen`), instead of leaving the camera wherever it was.
 */
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
    setActiveInspectorTab: vi.fn(),
    setActiveLeftPanel: vi.fn(),
    setActiveTool: vi.fn(),
    setDrawMode: vi.fn(),
    setInteractDeviceName: vi.fn(),
    setInteractDeviceSize: vi.fn(),
    setMode: vi.fn(),
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
});
