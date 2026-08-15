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
  applyDeckIdentity,
  assertServerPptxExportable,
  cssGradientToDrawingMl,
  fetchImageAsBase64,
  parseSlideHtml,
  resolveShapeType,
  sourcePageInches,
  tableOptions,
  themeClrSchemeXml,
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

  it("traces a freeform clip-path outline as custom geometry instead of a rectangle", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path: path('M0 0 L96 0 C96 27 48 54 0 54 Q0 27 0 0 Z');"></div>`,
      ),
      "16:9",
      1,
    );

    const inX = (px: number) => (px / 960) * 13.33;
    const inY = (px: number) => (px / 540) * 7.5;
    expect(result.shapes[0]?.shapeType).toBe("custGeom");
    expect(result.shapes[0]?.points).toEqual([
      { x: 0, y: 0, moveTo: true },
      { x: inX(96), y: 0 },
      {
        x: 0,
        y: inY(54),
        curve: {
          type: "cubic",
          x1: inX(96),
          y1: inY(27),
          x2: inX(48),
          y2: inY(54),
        },
      },
      { x: 0, y: 0, curve: { type: "quadratic", x1: 0, y1: inY(27) } },
      { close: true },
    ]);
  });

  it("keeps an arc an arc, so a ring segment does not export as its chord", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path: path('M100 50 A50 50 0 0 1 50 100 Z');"></div>`,
      ),
      "16:9",
      1,
    );

    const [start, arc] = (result.shapes[0]?.points ?? []) as Array<
      Record<string, never>
    >;
    // The arc's center is (50px, 50px), so it starts due east and sweeps a
    // quarter turn clockwise onto its endpoint.
    expect(start).toEqual({
      x: (100 / 960) * 13.33,
      y: (50 / 540) * 7.5,
      moveTo: true,
    });
    expect(arc).toMatchObject({
      x: (50 / 960) * 13.33,
      y: (100 / 540) * 7.5,
      curve: {
        type: "arc",
        wR: (50 / 960) * 13.33,
        hR: (50 / 540) * 7.5,
      },
    });
    expect(arc.curve.stAng).toBeCloseTo(0, 6);
    expect(arc.curve.swAng).toBeCloseTo(90, 6);
  });

  it("reads a stroke-only freeform's outline and weight from its SVG overlay", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}"><svg viewBox="0 0 192 108" preserveAspectRatio="none" style="position:absolute;inset:0;"><path d="M0 0 L192 108" fill="none" stroke="#FF0000" stroke-width="4" /></svg></div>`,
      ),
      "16:9",
      1,
    );

    expect(result.shapes[0]).toMatchObject({
      shapeType: "custGeom",
      lineColor: "FF0000",
      lineWidth: 4,
    });
    expect(result.shapes[0]?.points).toEqual([
      { x: 0, y: 0, moveTo: true },
      { x: (192 / 960) * 13.33, y: (108 / 540) * 7.5 },
    ]);
  });

  it("reads the importer's compact relative path, not just the absolute spelling", () => {
    // What `createPathWriter` emits: lowercase commands, no separator before a
    // sign or a bare `.`, and a repeated command left implicit.
    const compact = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path: path('m0 0 96 0-96 54z');"></div>`,
      ),
      "16:9",
      1,
    ).shapes[0];
    const absolute = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path: path('M0 0 L96 0 L0 54 Z');"></div>`,
      ),
      "16:9",
      1,
    ).shapes[0];

    expect(compact?.shapeType).toBe("custGeom");
    expect(compact?.points).toEqual(absolute?.points);
  });

  it("steps a relative curve's control points from the segment start, not the last point", () => {
    const [relative] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path: path('m10 10c5 0 10 5 10 10z');"></div>`,
      ),
      "16:9",
      1,
    ).shapes;
    const [absolute] = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path: path('M10 10 C15 10 20 15 20 20 Z');"></div>`,
      ),
      "16:9",
      1,
    ).shapes;

    expect(relative?.points).toEqual(absolute?.points);
  });

  it("falls back to a whole rectangle, loudly, when an outline cannot be read", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;clip-path: path('M0 0 H96 Z');"></div>`,
      ),
      "16:9",
      1,
    );

    expect(result.shapes[0]?.points).toBeUndefined();
    expect(result.shapes[0]?.shapeType).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("H96"));

    warnSpy.mockRestore();
  });

  it("keeps each element's rotation, so a rotated ring is not six stacked arrows", () => {
    const result = parseSlideHtml(
      importedSlide(
        [
          `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;transform: rotate(60deg);"></div>`,
          `<div data-pptx-element-kind="text" style="${SHAPE_BOX}transform: rotate(-90deg);"><p><span>Side</span></p></div>`,
          `<div data-pptx-element-kind="image" style="${SHAPE_BOX}transform: rotate(12.5deg);"><img src="https://example.com/a.png" /></div>`,
          `<div data-pptx-element-kind="shape" style="${SHAPE_BOX}background:#123456;"></div>`,
        ].join(""),
      ),
      "16:9",
      1,
    );

    expect(result.shapes[0]?.rotate).toBe(60);
    expect(result.texts[0]?.rotate).toBe(-90);
    expect(result.images[0]?.rotate).toBe(12.5);
    expect(result.shapes[1]?.rotate).toBeUndefined();
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

  it("keeps the source column and row tracks instead of an even split", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="table" style="${SHAPE_BOX}"><table>` +
          '<colgroup><col style="width:50%" /><col style="width:25%" /><col style="width:25%" /></colgroup>' +
          '<tr style="height:40%"><td colspan="2"><p>Wide</p></td><td><p>C</p></td></tr>' +
          '<tr style="height:60%"><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr>' +
          "</table></div>",
      ),
      "16:9",
      1,
    );

    // SHAPE_BOX is 192x108px, which is 2.6667x1.5in on a 16:9 deck.
    expect(result.tables[0]?.colW).toEqual([
      expect.closeTo(1.3333, 3),
      expect.closeTo(0.6667, 3),
      expect.closeTo(0.6667, 3),
    ]);
    expect(result.tables[0]?.rowH).toEqual([
      expect.closeTo(0.6, 3),
      expect.closeTo(0.9, 3),
    ]);
  });

  it("drops a column track list that does not cover every column", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="table" style="${SHAPE_BOX}"><table>` +
          '<colgroup><col style="width:50%" /><col style="width:50%" /></colgroup>' +
          "<tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr>" +
          "</table></div>",
      ),
      "16:9",
      1,
    );

    expect(result.tables[0]?.colW).toBeUndefined();
    expect(result.tables[0]?.rowH).toBeUndefined();
  });

  it("reads a cell's alignment and padding, which the importer writes on the paragraph and the cell", () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="table" style="${SHAPE_BOX}"><table>` +
          '<tr><td style="padding:9.6px 19.2px;"><p style="text-align:center;"><span>Centered</span></p></td></tr>' +
          "</table></div>",
      ),
      "16:9",
      1,
    );

    const cell = result.tables[0]?.rows[0]?.[0]?.options;
    expect(cell?.align).toBe("center");
    // 9.6px is 0.1333in tall and 19.2px is 0.2667in wide on a 16:9 deck.
    expect(cell?.margin).toEqual([
      expect.closeTo(0.1333, 3),
      expect.closeTo(0.2667, 3),
      expect.closeTo(0.1333, 3),
      expect.closeTo(0.2667, 3),
    ]);
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

  it("scales onto the source page size, not the preset the import snapped to", () => {
    // creandum-board-deck-template is 9144000x5715000 EMU (16:10). The nearest
    // renderable preset is 16:9, so exporting onto the preset's 13.33x7.5in
    // page stretched every element vertically by 16:9 / 16:10.
    const element = `<div data-pptx-element-kind="text" style="position:absolute;left:96px;top:54px;width:192px;height:108px;"><p><span style="font-size:32px;">Title</span></p></div>`;
    const onSourcePage = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" data-slide-width-emu="9144000" data-slide-height-emu="5715000" style="background:#ffffff;">${element}</div>`,
      "16:9",
      1,
    );
    const onPresetPage = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" style="background:#ffffff;">${element}</div>`,
      "16:9",
      1,
    );

    // 96px of a 960px box on a 10in page is exactly the source's own 914400 EMU.
    expect(onSourcePage.texts[0].x).toBeCloseTo(1, 6);
    expect(onSourcePage.texts[0].y).toBeCloseTo((54 / 540) * 6.25, 6);
    // 96 px/in here, so the source's 24pt run comes back 24pt, not 32pt.
    expect(onSourcePage.texts[0].fontSize).toBe(24);
    expect(onPresetPage.texts[0].x).toBeCloseTo((96 / 960) * 13.33, 6);
    expect(onPresetPage.texts[0].y).toBeCloseTo((54 / 540) * 7.5, 6);
    expect(onPresetPage.texts[0].fontSize).toBe(32);
  });

  it("keeps a gradient background alongside the solid stop it falls back to", () => {
    const result = parseSlideHtml(
      `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" style="background: linear-gradient(140.02deg, #2A80D0 0%, #67A99C 50%, #9CCB5A 100%);"><div data-pptx-element-kind="text" style="left:0px;top:0px;width:100px;height:40px;"><p>Title</p></div></div>`,
      "16:9",
      1,
    );

    expect(result.bgGradient).toBe(
      "linear-gradient(140.02deg, #2A80D0 0%, #67A99C 50%, #9CCB5A 100%)",
    );
    expect(result.bgColor).toBe("2A80D0");
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

describe("sourcePageInches", () => {
  it("reads the page size the importer stamped on the slide root", () => {
    expect(
      sourcePageInches(
        '<div data-slide-width-emu="9144000" data-slide-height-emu="5715000">',
      ),
    ).toEqual({ w: 10, h: 6.25 });
  });

  it("falls back to the deck preset when the slide declares no source size", () => {
    expect(sourcePageInches('<div class="fmd-slide">')).toBeUndefined();
  });

  it("warns instead of re-paging the deck onto an out-of-range size", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      sourcePageInches(
        '<div data-slide-width-emu="914400000" data-slide-height-emu="5143500">',
      ),
    ).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("out-of-range source page size"),
    );

    warnSpy.mockRestore();
  });
});

describe("cssGradientToDrawingMl", () => {
  it("re-orients a linear gradient back to the OOXML angle the importer read", () => {
    // CSS measures clockwise from "up", `<a:lin ang>` from the positive x-axis:
    // 140.02deg is (140.02 - 90) * 60000 = 3001200, not 8401200.
    expect(
      cssGradientToDrawingMl(
        "linear-gradient(140.02deg, #2A80D0 0%, #67A99C 50%, #9CCB5A 100%)",
      ),
    ).toBe(
      '<a:gradFill rotWithShape="1"><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="2A80D0"/></a:gs>' +
        '<a:gs pos="50000"><a:srgbClr val="67A99C"/></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="9CCB5A"/></a:gs>' +
        '</a:gsLst><a:lin ang="3001200" scaled="0"/></a:gradFill>',
    );
  });

  it("puts a radial gradient's focus back where fillToRect had it", () => {
    expect(
      cssGradientToDrawingMl(
        "radial-gradient(circle at 0% 0%, #013445 0%, #018589 100%)",
      ),
    ).toContain('<a:fillToRect l="0" t="0" r="100000" b="100000"/>');
  });

  it("keeps the alpha an rgba stop carries", () => {
    expect(
      cssGradientToDrawingMl(
        "linear-gradient(90deg, rgba(255,0,0,0.5) 0%, #00FF00 100%)",
      ),
    ).toContain('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>');
  });

  it("declines gradients DrawingML cannot express instead of writing a broken fill", () => {
    expect(
      cssGradientToDrawingMl("conic-gradient(#fff, #000)"),
    ).toBeUndefined();
    expect(
      cssGradientToDrawingMl("linear-gradient(90deg, #ffffff 0%)"),
    ).toBeUndefined();
  });

  it("reads a `to <side>` direction as its angle rather than as a color stop", () => {
    // Regression: only `<angle>` was recognized as the configuration argument,
    // so `to right` reached `colorToHex`, which reported an unreadable color
    // the way it is meant to — by defaulting to white. The gradient came out
    // with a phantom white stop the deck never had, pointing down instead of
    // right.
    expect(cssGradientToDrawingMl("linear-gradient(to right, #013445, #018589)")).toBe(
      '<a:gradFill rotWithShape="1"><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="013445"/></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="018589"/></a:gs>' +
        '</a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>',
    );
    expect(
      cssGradientToDrawingMl("linear-gradient(to bottom, #013445, #018589)"),
    ).toContain('<a:lin ang="5400000" scaled="0"/>');
    expect(
      cssGradientToDrawingMl("linear-gradient(to top right, #013445, #018589)"),
    ).toContain('<a:lin ang="18900000" scaled="0"/>');
  });

  it("centers a radial gradient that names only its shape, without inventing a stop", () => {
    for (const css of [
      "radial-gradient(circle, #013445, #018589)",
      "radial-gradient(ellipse at center, #013445, #018589)",
    ]) {
      const xml = cssGradientToDrawingMl(css);
      expect(xml).toContain(
        '<a:fillToRect l="50000" t="50000" r="50000" b="50000"/>',
      );
      expect(xml).not.toContain("FFFFFF");
      expect(xml?.match(/<a:gs /g)).toHaveLength(2);
    }
  });

  it("resolves a radial focus written with position keywords", () => {
    expect(
      cssGradientToDrawingMl(
        "radial-gradient(circle at top left, #013445, #018589)",
      ),
    ).toContain('<a:fillToRect l="0" t="0" r="100000" b="100000"/>');
  });

  it("flattens rather than whitens a configuration or stop it cannot read", () => {
    for (const css of [
      "linear-gradient(0.25turn, #013445, #018589)", // angle unit we do not convert
      "linear-gradient(in oklab, #013445, #018589)", // color-interpolation syntax
      "radial-gradient(circle at 10px 20px, #013445, #018589)", // non-percent focus
      "linear-gradient(90deg, #013445, notacolor)", // unreadable stop
    ]) {
      expect(cssGradientToDrawingMl(css)).toBeUndefined();
    }
  });
});

describe("themeClrSchemeXml", () => {
  const palette = {
    dk1: "#000000",
    lt1: "#FFFFFF",
    dk2: "#595959",
    lt2: "#EEEEEE",
    accent1: "#FFAB40",
    accent2: "#212121",
    accent3: "#78909C",
    accent4: "#FFAB40",
    accent5: "#0097A7",
    accent6: "#EEFF41",
    hlink: "#0097A7",
    folHlink: "#0097A7",
  };

  it("writes the deck's own palette in the slot order PowerPoint requires", () => {
    const xml = themeClrSchemeXml(palette);

    expect(xml).toContain('<a:accent1><a:srgbClr val="FFAB40"/></a:accent1>');
    expect(xml).not.toContain("4472C4"); // the Office default accent1
    expect(xml?.indexOf("<a:dk1>")).toBeLessThan(xml?.indexOf("<a:lt1>") ?? -1);
  });

  it("keeps the Office default rather than writing a partial scheme", () => {
    const { accent4: _dropped, ...incomplete } = palette;

    expect(themeClrSchemeXml(incomplete)).toBeUndefined();
  });
});

describe("tableOptions", () => {
  it("writes the source grid and no border the HTML never declared", async () => {
    const result = parseSlideHtml(
      importedSlide(
        `<div data-pptx-element-kind="table" style="${SHAPE_BOX}"><table>` +
          '<colgroup><col style="width:60%" /><col style="width:40%" /></colgroup>' +
          '<tr style="height:25%"><td><p>A</p></td><td><p>B</p></td></tr>' +
          '<tr style="height:75%"><td><p>C</p></td><td><p>D</p></td></tr>' +
          "</table></div>",
      ),
      "16:9",
      1,
    );
    const table = result.tables[0];
    if (!table) throw new Error("no table parsed");

    const pptx = new PptxGenJS();
    pptx.addSlide().addTable(table.rows, tableOptions(table));
    const JSZip = (await import("jszip")).default;
    const slideXml = await (
      await JSZip.loadAsync(
        (await pptx.write({ outputType: "nodebuffer" })) as Buffer,
      )
    )
      .file("ppt/slides/slide1.xml")
      ?.async("string");

    // 60/40 of 2.6667in, and 25/75 of 1.5in, in EMUs.
    expect(slideXml).toContain(
      '<a:gridCol w="1462674"/><a:gridCol w="975116"/>',
    );
    expect(slideXml).toContain('<a:tr h="342900">');
    expect(slideXml).toContain('<a:tr h="1028700">');
    expect(slideXml).not.toContain('<a:srgbClr val="FFFFFF"/></a:solidFill>');
  });
});

describe("applyDeckIdentity", () => {
  async function writeDeck(): Promise<Buffer> {
    const pptx = new PptxGenJS();
    const slide = pptx.addSlide();
    slide.background = { color: "013445" };
    slide.addText("Title", { x: 1, y: 1, w: 4, h: 1 });
    return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  }

  async function readPart(buffer: Buffer, partPath: string): Promise<string> {
    const JSZip = (await import("jszip")).default;
    const part = await (
      await JSZip.loadAsync(buffer)
    )
      .file(partPath)
      ?.async("string");
    if (part === undefined) throw new Error(`missing ${partPath}`);
    return part;
  }

  it("carries a gradient background pptxgenjs has no fill type for", async () => {
    const gradFill = cssGradientToDrawingMl(
      "radial-gradient(circle at 0% 0%, #013445 0%, #018589 100%)",
    );
    const patched = await applyDeckIdentity(await writeDeck(), {
      slideGradients: new Map([[0, gradFill ?? ""]]),
    });

    const slideXml = await readPart(patched, "ppt/slides/slide1.xml");
    expect(slideXml).toContain('<p:bg><p:bgPr><a:gradFill rotWithShape="1">');
    expect(slideXml).toContain('<a:srgbClr val="018589"/>');
    expect(slideXml).not.toContain('<a:solidFill><a:srgbClr val="013445"/>');
  });

  it("replaces the hardcoded Office palette with the deck's theme", async () => {
    const patched = await applyDeckIdentity(await writeDeck(), {
      themeColors: {
        dk1: "#000000",
        lt1: "#FFFFFF",
        dk2: "#595959",
        lt2: "#EEEEEE",
        accent1: "#FFAB40",
        accent2: "#212121",
        accent3: "#78909C",
        accent4: "#FFAB40",
        accent5: "#0097A7",
        accent6: "#EEFF41",
        hlink: "#0097A7",
        folHlink: "#0097A7",
      },
      slideGradients: new Map(),
    });

    const themeXml = await readPart(patched, "ppt/theme/theme1.xml");
    expect(themeXml).toContain(
      '<a:accent1><a:srgbClr val="FFAB40"/></a:accent1>',
    );
    expect(themeXml).not.toContain("4472C4");
  });

  it("returns the package untouched when the deck has nothing of its own", async () => {
    const buffer = await writeDeck();

    expect(await applyDeckIdentity(buffer, { slideGradients: new Map() })).toBe(
      buffer,
    );
  });

  it("fails loudly rather than shipping a deck that silently lost its gradient", async () => {
    await expect(
      applyDeckIdentity(await writeDeck(), {
        slideGradients: new Map([[7, "<a:gradFill/>"]]),
      }),
    ).rejects.toThrowError(/missing ppt\/slides\/slide8\.xml/);
  });
});
