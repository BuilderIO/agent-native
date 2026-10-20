// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const nativeCapture = vi.hoisted(() =>
  vi.fn(async () => new Blob(["native pixels"], { type: "image/png" })),
);
vi.mock("@/pages/design-editor/native-current-frame-png", () => ({
  captureNativeCurrentFramePng: nativeCapture,
}));
vi.mock("@/pages/design-editor/png-export-render", async (original) => ({
  ...(await original<
    typeof import("@/pages/design-editor/png-export-render")
  >()),
  resolveExportCropTarget: vi.fn(() => ({
    kind: "rect",
    rect: { x: 4064, y: 3283, width: 1510, height: 270 },
  })),
}));
import type { ElementInfo } from "@/components/design/types";

import { runRenderPngBlob } from "./render-png-blob";

afterEach(() => vi.clearAllMocks());
it("exports a selected native wrapper at its requested density without resizing the board viewport", async () => {
  const screenLease = Symbol("native export");
  const releaseScreenFromExport = vi.fn();
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  Object.defineProperties(iframe, {
    clientWidth: { value: 8192 },
    clientHeight: { value: 8192 },
  });
  iframe.contentDocument!.body.innerHTML =
    '<script type="application/x-agent-native-effects">{}</script><div data-agent-native-node-id="wrapper"></div>';
  const png = await runRenderPngBlob(
    {
      designId: "design",
      fileId: "board",
      activeCanvasSourceType: "inline",
      canEditDesign: true,
      canvasFrameGeometryById: {},
      overviewScreens: [],
      selectedScreenIds: [],
      viewMode: "overview",
      releaseScreenFromExport,
      resolvePngCaptureTarget: async () => ({
        iframe,
        doc: iframe.contentDocument!,
        cropSelection: { sourceId: "wrapper" } as unknown as ElementInfo,
        screenLease,
      }),
    },
    { scope: "element", settings: { scale: 1 } },
  );
  expect(await png.text()).toBe("native pixels");
  expect(nativeCapture).toHaveBeenCalledWith(
    expect.objectContaining({
      iframe,
      pixelRatio: 1,
      selectedNodeIds: ["wrapper"],
      cropRect: { x: 4064, y: 3283, width: 1510, height: 270 },
    }),
  );
  expect(iframe.clientWidth).toBe(8192);
  expect(releaseScreenFromExport).toHaveBeenCalledExactlyOnceWith(screenLease);
  iframe.remove();
});
