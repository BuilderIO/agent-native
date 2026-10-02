import { afterEach, expect, it, vi } from "vitest";

import {
  NativeExportRenderError,
  renderNativeExportPng,
} from "./native-export-render";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("rejects oversized UTF-8 snapshots before making a request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

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
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  { errorCode: "export_too_large", status: 413 },
  { errorCode: "export_resources_unavailable", status: 424 },
  { errorCode: "export_render_timeout", status: 504 },
  { errorCode: "export_chromium_unavailable", status: 503 },
])(
  "preserves the action error code $errorCode",
  async ({ errorCode, status }) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Renderer failed.", errorCode }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);

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
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Request body too large." }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetch);

  await expect(
    renderNativeExportPng({
      html: "<html></html>",
      width: 800,
      height: 600,
      scale: 1,
    }),
  ).rejects.toMatchObject({ code: "export_too_large" });
});
