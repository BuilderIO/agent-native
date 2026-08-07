import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "local@example.com"),
}));

vi.mock("../server/db/index.js", () => ({}));

import {
  assertServerPptxExportable,
  fetchImageAsBase64,
  parseSlideHtml,
} from "./export-pptx";

describe("fetchImageAsBase64", () => {
  beforeEach(() => {
    mocks.ssrfSafeFetch.mockReset();
  });

  it("downloads images through the SSRF-safe fetch helper", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      fetchImageAsBase64("https://cdn.example/logo.png"),
    ).resolves.toBe("data:image/png;base64,AQID");
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://cdn.example/logo.png",
      { signal: expect.any(AbortSignal) },
      { maxRedirects: 3 },
    );
  });

  it("rejects non-image responses", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(fetchImageAsBase64("https://cdn.example/page")).resolves.toBe(
      null,
    );
  });

  it("returns null when SSRF-safe fetch blocks a URL", async () => {
    mocks.ssrfSafeFetch.mockRejectedValue(
      new Error("SSRF blocked: refusing to fetch private/internal address"),
    );

    await expect(
      fetchImageAsBase64("http://127.0.0.1/image.png"),
    ).resolves.toBe(null);
  });
});

describe("parseSlideHtml", () => {
  it("allows normal-flow slide HTML", () => {
    expect(() =>
      parseSlideHtml(
        '<div class="fmd-slide"><h1>Title</h1></div>',
        undefined,
        1,
      ),
    ).not.toThrow();
  });

  it("fails loudly instead of reflowing freeform objects", () => {
    expect(() =>
      parseSlideHtml(
        `<div class="fmd-slide">
          <div
            data-slide-object-id="freeform-1"
            style="position: absolute; left: 120px; top: 80px"
          >Text</div>
        </div>`,
        undefined,
        3,
      ),
    ).toThrowError(
      /Slide 3 contains freeform positioned objects.*Export > PowerPoint.*stopped instead of silently reflowing/s,
    );
  });

  it("allows an absolute uploaded background without a persisted object id", () => {
    expect(() =>
      assertServerPptxExportable(
        `<div class="fmd-slide">
          <img
            class="fmd-img-uploaded"
            src="https://cdn.example/background.png"
            style="position: absolute; inset: 0; width: 100%; height: 100%"
          />
          <h1>Title</h1>
        </div>`,
        2,
      ),
    ).not.toThrow();
  });

  it("rejects the persisted freeform class even if its object id is absent", () => {
    expect(() =>
      assertServerPptxExportable(
        `<div class="fmd-slide"><div class="fmd-freeform-object" style="position: absolute">Text</div></div>`,
        4,
      ),
    ).toThrowError(/Slide 4 contains freeform positioned objects/);
  });

  it("preserves imported scene geometry, rich text runs, and placed images", () => {
    const result = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" style="position:relative;background:#000000;">
        <div class="fmd-pptx-text" data-pptx-element-kind="text" style="position:absolute;left:72px;top:68px;width:480px;height:120px;">
          <p style="line-height:1.5;"><span style="font-size:48px;font-family:'Poppins',sans-serif;color:#ffffff;font-weight:700;">Title</span></p>
          <p style="line-height:1.5;"><span style="font-size:25.333px;font-family:'Poppins',sans-serif;color:#d9d9d9;">Body </span><span style="font-size:25.333px;font-family:'Poppins',sans-serif;color:#28e2fa;">accent</span></p>
        </div>
        <div class="fmd-pptx-image" data-pptx-element-kind="image" style="position:absolute;left:100px;top:300px;width:200px;height:100px;"><img src="/api/import-assets/token" alt="" /></div>
      </div>`,
      "16:9",
      2,
    );

    expect(result.bgColor).toBe("000000");
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0].x).toBeCloseTo(1, 3);
    expect(result.texts[0].y).toBeCloseTo((68 / 540) * 7.5, 4);
    expect(result.texts[0].fontSize).toBe(36);
    expect(result.texts[0].runs?.map((run) => run.text).join("")).toContain(
      "Body accent",
    );
    expect(result.images).toEqual([
      expect.objectContaining({
        src: "/api/import-assets/token",
        x: expect.closeTo((100 / 960) * 13.33, 4),
        y: expect.closeTo((300 / 540) * 7.5, 4),
      }),
    ]);
  });

  it("keeps a source-faithful PDF page as a full-slide image", () => {
    const result = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pdf" data-imported-pdf="true" style="background: #101820;"><img src="https://files.example/page.png" alt="" /></div>`,
      "16:9",
      1,
    );

    expect(result.texts).toHaveLength(0);
    expect(result.images).toEqual([
      expect.objectContaining({
        src: "https://files.example/page.png",
        x: 0,
        y: 0,
        w: expect.closeTo(13.33, 2),
        h: expect.closeTo(7.5, 2),
      }),
    ]);
  });

  it("decodes escaped query parameters in imported PDF image URLs", () => {
    const result = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pdf" data-imported-pdf="true"><img src="https://files.example/page.png?token=abc&amp;signature=def" alt="" /></div>`,
      "16:9",
      1,
    );

    expect(result.images[0]?.src).toBe(
      "https://files.example/page.png?token=abc&signature=def",
    );
  });

  it("ignores imported grids with non-positive spacing", () => {
    for (const backgroundSize of [
      "0px 24px",
      "-1px 24px",
      "24px 0px",
      "24px -1px",
    ]) {
      const result = parseSlideHtml(
        `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" style="background-image:linear-gradient(#ffffff 0 1px, transparent 1px);background-size:${backgroundSize};background-position:0px 0px;"><div data-pptx-element-kind="text" style="left:0px;top:0px;width:100px;height:40px;">Title</div></div>`,
        "16:9",
        1,
      );

      expect(result.grid).toBeUndefined();
    }
  });
});
