import { afterEach, expect, it, vi } from "vitest";

const actionClient = vi.hoisted(() => ({ callActionBlob: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => actionClient);

import {
  NativeExportRenderError,
  renderNativeExportPng,
} from "./native-export-render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("rejects oversized UTF-8 snapshots before making a request", async () => {
  await expect(
    renderNativeExportPng({
      html: "é".repeat(2_500_000),
      width: 1,
      height: 1,
      scale: 1,
    }),
  ).rejects.toMatchObject({
    name: "NativeExportRenderError",
    code: "export_too_large",
    message: expect.stringContaining("5 MB"),
  });
  expect(actionClient.callActionBlob).not.toHaveBeenCalled();
});

it.each([
  { errorCode: "export_too_large", status: 413 },
  { errorCode: "export_resources_unavailable", status: 424 },
  { errorCode: "export_render_timeout", status: 504 },
  { errorCode: "export_chromium_unavailable", status: 503 },
])(
  "preserves the action error code $errorCode",
  async ({ errorCode, status }) => {
    actionClient.callActionBlob.mockRejectedValueOnce(
      Object.assign(new Error("Renderer failed."), { errorCode, status }),
    );

    await expect(
      renderNativeExportPng({
        html: "<html></html>",
        width: 800,
        height: 600,
        scale: 1,
      }),
    ).rejects.toMatchObject({
      code: errorCode,
      message: "Renderer failed.",
    } satisfies Partial<NativeExportRenderError>);
  },
);

it("maps an untyped 413 response to the typed size error", async () => {
  actionClient.callActionBlob.mockRejectedValueOnce(
    Object.assign(new Error("Request body too large."), { status: 413 }),
  );

  await expect(
    renderNativeExportPng({
      html: "<html></html>",
      width: 800,
      height: 600,
      scale: 1,
    }),
  ).rejects.toMatchObject({ code: "export_too_large" });
});

it("maps a shared action timeout to the typed export timeout", async () => {
  actionClient.callActionBlob.mockRejectedValueOnce(
    Object.assign(new Error("Action render-export-png timed out."), {
      timedOut: true,
      status: 408,
    }),
  );

  await expect(
    renderNativeExportPng({
      html: "<html></html>",
      width: 800,
      height: 600,
      scale: 1,
    }),
  ).rejects.toMatchObject({ code: "export_render_timeout" });
});

it("sends an optional crop rectangle with the render request", async () => {
  actionClient.callActionBlob.mockResolvedValueOnce(
    new Blob(["png"], { type: "image/png" }),
  );

  await renderNativeExportPng({
    html: "<html></html>",
    width: 800,
    height: 600,
    scale: 2,
    clip: { x: 20, y: 30, width: 100, height: 80 },
  });

  expect(actionClient.callActionBlob).toHaveBeenCalledWith(
    "render-export-png",
    expect.objectContaining({
      clip: { x: 20, y: 30, width: 100, height: 80 },
    }),
    { timeoutMs: 45_000 },
  );
});
