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

import PptxGenJS from "pptxgenjs";

import {
  assertServerPptxExportable,
  fetchImageAsBase64,
  parseSlideHtml,
  resolveShapeType,
} from "./export-pptx";

/** An imported-PPTX slide wrapper holding one `data-pptx-element-kind` element. */
function importedSlide(element: string, slideStyle = "background:#000000;") {
  return `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" style="${slideStyle}">${element}</div>`;
}

const SHAPE_BOX =
  "position:absolute;left:96px;top:54px;width:192px;height:108px;";

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

describe("resolveShapeType", () => {
  const shapeTypes = new PptxGenJS().ShapeType as unknown as Record<
    string,
    string
  >;

  it("passes through preset geometries PowerPoint knows", () => {
    expect(resolveShapeType(shapeTypes, "trapezoid")).toBe("trapezoid");
    expect(resolveShapeType(shapeTypes, "ellipse")).toBe("ellipse");
    expect(resolveShapeType(shapeTypes, "custGeom")).toBe("custGeom");
    expect(resolveShapeType(shapeTypes, undefined)).toBe("rect");
  });

  it("warns instead of silently writing a prst PowerPoint would reject", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveShapeType(shapeTypes, "notAShape")).toBe("rect");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("notAShape"));

    warnSpy.mockRestore();
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
    // 16:9 decks are 72 px/in, so CSS px and pt match 1:1 — not the fixed
    // 96dpi (0.75x) conversion, which would wrongly give 36 here.
    expect(result.texts[0].fontSize).toBe(48);
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

  it("letterboxes portrait PDF pages during export", () => {
    const result = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pdf" data-imported-pdf="true" data-source-width="900" data-source-height="1600"><img src="https://files.example/portrait.png" alt="" /></div>`,
      "16:9",
      1,
    );

    expect(result.images).toEqual([
      expect.objectContaining({
        src: "https://files.example/portrait.png",
        x: expect.closeTo((13.33 - 7.5 * (900 / 1600)) / 2, 4),
        y: 0,
        w: expect.closeTo(7.5 * (900 / 1600), 4),
        h: expect.closeTo(7.5, 4),
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

  it("derives px-to-pt from the deck's actual px/inch ratio, not a fixed 96dpi assumption", () => {
    // 1:1 decks are 108 px/in (1080px / 10in), not the 96dpi (0.75x) the
    // fixed conversion assumed: 48px at 108dpi is 32pt, not 36pt.
    const result = parseSlideHtml(
      '<div class="fmd-slide"><h1 style="font-size: 48px;">Title</h1></div>',
      "1:1",
      1,
    );

    expect(result.texts[0].fontSize).toBe(32);
  });

  it("threads rgba alpha through as pptxgenjs transparency instead of discarding it", () => {
    const result = parseSlideHtml(
      '<div class="fmd-slide"><h1 style="color: rgba(255, 0, 0, 0.5);">Title</h1></div>',
      undefined,
      1,
    );

    expect(result.texts[0].color).toBe("FF0000");
    expect(result.texts[0].transparency).toBe(50);
  });

  it("preserves 8-digit CSS hex alpha through PPTX export", () => {
    const result = parseSlideHtml(
      '<div class="fmd-slide"><h1 style="color: #11223380;">Title</h1></div>',
      undefined,
      1,
    );

    expect(result.texts[0].color).toBe("112233");
    expect(result.texts[0].transparency).toBe(50);
  });

  it("exports imported tables with cell text, fills, and spans", () => {
    const result = parseSlideHtml(
      [
        '<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" style="background:#000000;">',
        '<div data-pptx-element-kind="table" style="position:absolute;left:72px;top:68px;width:480px;height:180px;">',
        '<table><tr><td colspan="2" style="background:#11223380;border:1px solid rgba(255,255,255,0.25);"><p><span style="font-size:24px;color:#ffffff;font-weight:700;">Header</span></p></td></tr>',
        '<tr><td rowspan="2"><p>Left</p></td><td><p>Right</p></td></tr><tr><td><p>Bottom</p></td></tr></table>',
        "</div></div>",
      ].join(""),
      "16:9",
      1,
    );

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.x).toBeCloseTo(1, 3);
    const [headerRow, bodyRow] = result.tables[0]?.rows ?? [];
    expect(headerRow?.[0]?.options).toMatchObject({
      colspan: 2,
      fill: { color: "112233", transparency: 50 },
    });
    expect(headerRow?.[0]?.text).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Header" })]),
    );
    expect(bodyRow?.[0]?.options).toMatchObject({ rowspan: 2 });
    expect(bodyRow?.[0]?.text).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Left" })]),
    );
    expect(bodyRow?.[1]?.text).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Right" })]),
    );
  });

  it("warns and falls back to white instead of silently defaulting an unrecognized color", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = parseSlideHtml(
      '<div class="fmd-slide"><h1 style="color: hsl(200 50% 50%);">Title</h1></div>',
      undefined,
      1,
    );

    expect(result.texts[0].color).toBe("FFFFFF");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("hsl(200 50% 50%)"),
    );

    warnSpy.mockRestore();
  });

  it("fills a gradient shape with its first opaque stop instead of dropping the fill", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:linear-gradient(135deg, rgba(255,95,109,0) 0%, #FF5F6D 20%, #FFC371 100%);"></div>`,
      ),
      "16:9",
      1,
    );

    expect(result.shapes[0]).toMatchObject({ fill: "FF5F6D" });
    expect(result.shapes[0]?.fillTransparency).toBeUndefined();
  });

  it("keeps the source preset geometry the importer carries on the shape", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" data-pptx-shape-type="trapezoid" style="${SHAPE_BOX}background:#123456;"></div>`,
      ),
      "16:9",
      1,
    );

    expect(result.shapes[0]?.shapeType).toBe("trapezoid");
  });

  it("reads a circle and a real corner radius instead of collapsing both to roundRect", () => {
    const [circle] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;border-radius:50%;"></div>`,
      ),
      "16:9",
      1,
    ).shapes;
    const [rounded] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;border-radius:18px;"></div>`,
      ),
      "16:9",
      1,
    ).shapes;
    const [pill] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;border-radius:9999px;"></div>`,
      ),
      "16:9",
      1,
    ).shapes;

    expect(circle?.shapeType).toBe("ellipse");
    expect(circle?.rectRadius).toBeUndefined();
    // 16:9 decks are 72 px/in, so an 18px radius is 0.25in.
    expect(rounded?.shapeType).toBe("roundRect");
    expect(rounded?.rectRadius).toBeCloseTo((18 / 960) * 13.33, 4);
    // A pill clamps to the half-short-side PowerPoint's `adj` value caps at.
    expect(pill?.rectRadius).toBeCloseTo(((108 / 540) * 7.5) / 2, 4);
  });

  it("traces a clip-path polygon as custom geometry rather than a rectangle", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path:polygon(50% 0%, 100% 100%, 0% 100%);"></div>`,
      ),
      "16:9",
      1,
    );

    const w = (192 / 960) * 13.33;
    const h = (108 / 540) * 7.5;
    expect(result.shapes[0]?.shapeType).toBe("custGeom");
    expect(result.shapes[0]?.points).toEqual([
      { x: expect.closeTo(w / 2, 4), y: 0 },
      { x: expect.closeTo(w, 4), y: expect.closeTo(h, 4) },
      { x: 0, y: expect.closeTo(h, 4) },
      { close: true },
    ]);
  });

  it("exports dashed and dotted outlines instead of dropping the line entirely", () => {
    const [dashed] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}border:2px dashed #FF0000;"></div>`,
      ),
      "16:9",
      1,
    ).shapes;
    const [dotted] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}border:1px dotted #00FF00;"></div>`,
      ),
      "16:9",
      1,
    ).shapes;
    const [solid] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}border:1px solid #0000FF;"></div>`,
      ),
      "16:9",
      1,
    ).shapes;

    expect(dashed).toMatchObject({ lineColor: "FF0000", lineDashType: "dash" });
    expect(dotted).toMatchObject({
      lineColor: "00FF00",
      lineDashType: "sysDot",
    });
    expect(solid?.lineColor).toBe("0000FF");
    expect(solid?.lineDashType).toBeUndefined();
  });

  it("maps a dotted table rule to the nearest border pptxgenjs can draw", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="table" style="${SHAPE_BOX}"><table><tr><td style="border:1px dotted #888888;"><p>Cell</p></td></tr></table></div>`,
      ),
      "16:9",
      1,
    );

    expect(result.tables[0]?.rows[0]?.[0]?.options?.border).toMatchObject({
      type: "dash",
      color: "888888",
    });
  });

  it("writes the source deck's font, not this template's, on a round trip", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="text" style="position:absolute;left:72px;top:68px;width:480px;height:120px;"><p style="line-height:1.5;"><span style="font-size:24px;font-family:'Work Sans',sans-serif;color:#333333;">Heading</span></p></div>`,
        "background:#ffffff;font-family:'Bodoni Moda',serif;",
      ),
      "16:9",
      1,
    );

    expect(result.texts[0]?.fontFace).toBe("Work Sans");
  });

  it("falls back to the imported deck's own theme font when a run declares none", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="text" style="position:absolute;left:72px;top:68px;width:480px;height:120px;"><p>Heading</p></div>`,
        "background:#ffffff;font-family:'Bodoni Moda',serif;",
      ),
      "16:9",
      1,
    );

    expect(result.texts[0]?.fontFace).toBe("Bodoni Moda");
    // No run declared a size, so none is invented on the way out either.
    expect(result.texts[0]?.fontSize).toBeUndefined();
  });

  it("uses the deck wrapper's font family on normal-flow slides", () => {
    const result = parseSlideHtml(
      `<div class="fmd-slide" style="font-family: 'Montserrat', sans-serif;"><h1 style="font-size: 48px;">Title</h1></div>`,
      "16:9",
      1,
    );

    expect(result.texts[0]?.fontFace).toBe("Montserrat");
  });

  it("matches the importer's own defaults so an undecorated round trip keeps its colors", () => {
    const result = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true"><div data-pptx-element-kind="text" style="position:absolute;left:72px;top:68px;width:480px;height:120px;"><p>Heading</p></div></div>`,
      "16:9",
      1,
    );

    expect(result.bgColor).toBe("FFFFFF");
    expect(result.texts[0]?.color).toBe("111827");
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
