// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerNativeViewedSource } from "@/components/design/design-canvas/native-viewed-source-lease";
import type { ElementInfo } from "@/components/design/types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";

const mocks = vi.hoisted(() => ({
  renderSelectedNativeSceneMp4Blob: vi.fn(),
}));

vi.mock(
  "@/pages/design-editor/native-scene-export-client",
  async (importOriginal) => ({
    ...(await importOriginal()),
    renderSelectedNativeSceneMp4Blob: mocks.renderSelectedNativeSceneMp4Blob,
  }),
);

import { DEFAULT_NATIVE_VIDEO_SETTINGS } from "../native-scene-export-client";
import { runRenderNativeMp4Blob } from "./render-native-mp4-blob";

function target() {
  const iframe = document.createElement("iframe");
  const doc = document.implementation.createHTMLDocument("Native Design");
  const manifest = doc.createElement("script");
  manifest.type = "application/x-agent-native-effects";
  doc.head.appendChild(manifest);
  Object.defineProperties(iframe, {
    clientWidth: { configurable: true, value: 640 },
    clientHeight: { configurable: true, value: 480 },
    contentDocument: { configurable: true, value: doc },
    contentWindow: {
      configurable: true,
      value: { __agentNativeSourceProvenance: { versionHash: "12:abc" } },
    },
  });
  document.body.appendChild(iframe);
  registerNativeViewedSource(iframe, doc, "12:abc");
  return {
    doc,
    iframe,
    sourceFileId: "screen-1",
    cropSelection: null,
  };
}

describe("native MP4 selected scene command", () => {
  afterEach(() => document.body.replaceChildren());
  beforeEach(() => {
    mocks.renderSelectedNativeSceneMp4Blob.mockReset();
    mocks.renderSelectedNativeSceneMp4Blob.mockResolvedValue(
      new Blob(["mp4"], { type: "video/mp4" }),
    );
  });

  it("uses the one selected Design file and exact iframe viewport", async () => {
    const resolvePngCaptureTarget = vi.fn(async () => target());
    const blob = await runRenderNativeMp4Blob({
      designId: "design-1",
      canvasFrameGeometryById: {},
      overviewScreens: [
        { id: "screen-1", width: 640, height: 480 },
      ] as OverviewScreen[],
      selectedScreenIds: ["screen-1"],
      viewMode: "overview",
      scope: "screens",
      resolvePngCaptureTarget,
      settings: { ...DEFAULT_NATIVE_VIDEO_SETTINGS, pixelRatio: 2 },
    });
    expect(blob.type).toBe("video/mp4");
    expect(resolvePngCaptureTarget).toHaveBeenCalledWith("screens", "screen-1");
    expect(mocks.renderSelectedNativeSceneMp4Blob).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "12:abc",
        assertStillViewed: expect.any(Function),
        viewport: { width: 640, height: 480 },
        settings: expect.objectContaining({ pixelRatio: 2 }),
      }),
    );
  });

  it("rejects multiple or transformed overview targets before capturing frames", async () => {
    const resolvePngCaptureTarget = vi.fn(async () => target());
    const common = {
      designId: "design-1",
      overviewScreens: [
        { id: "screen-1", width: 640, height: 480 },
      ] as OverviewScreen[],
      viewMode: "overview" as const,
      scope: "screens" as const,
      resolvePngCaptureTarget,
      settings: DEFAULT_NATIVE_VIDEO_SETTINGS,
    };
    await expect(
      runRenderNativeMp4Blob({
        ...common,
        canvasFrameGeometryById: {},
        selectedScreenIds: ["screen-1", "screen-2"],
      }),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
    await expect(
      runRenderNativeMp4Blob({
        ...common,
        canvasFrameGeometryById: { "screen-1": { rotation: 20 } },
        selectedScreenIds: ["screen-1"],
      }),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
    expect(mocks.renderSelectedNativeSceneMp4Blob).not.toHaveBeenCalled();
  });

  it("uses the exact selected native element crop for every video frame", async () => {
    const sceneTarget = target();
    const doc = sceneTarget.doc;
    const node = doc.createElement("div");
    node.id = "selected";
    node.setAttribute("data-agent-native-node-id", "frame-1");
    node.getBoundingClientRect = () =>
      ({ left: 200, top: 100, width: 240, height: 160 }) as DOMRect;
    doc.body.append(node);
    const resolvePngCaptureTarget = vi.fn(async () => ({
      ...sceneTarget,
      cropSelection: {
        tagName: "DIV",
        selector: "#selected",
      } as ElementInfo,
    }));
    await runRenderNativeMp4Blob({
      designId: "design-1",
      canvasFrameGeometryById: {},
      overviewScreens: [],
      selectedScreenIds: [],
      viewMode: "single",
      scope: "element",
      resolvePngCaptureTarget,
      settings: DEFAULT_NATIVE_VIDEO_SETTINGS,
    });
    expect(resolvePngCaptureTarget).toHaveBeenCalledWith("element", undefined);
    expect(mocks.renderSelectedNativeSceneMp4Blob).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 240, height: 160 },
        sourceViewport: { width: 640, height: 480 },
        crop: {
          x: 200,
          y: 100,
          width: 240,
          height: 160,
          nodeId: "frame-1",
        },
      }),
    );
    const call = mocks.renderSelectedNativeSceneMp4Blob.mock.lastCall?.[0];
    expect(call?.assertStillViewed).toBeTypeOf("function");
    Object.defineProperty(sceneTarget.iframe, "clientWidth", {
      configurable: true,
      value: 641,
    });
    expect(() => call?.assertStillViewed?.()).toThrowError(
      expect.objectContaining({ code: "source-stale" }),
    );
  });
});
