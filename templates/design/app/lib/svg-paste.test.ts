// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  buildPastedSvgLayer,
  extractSvgMarkup,
  svgLayerName,
  type SvgShapeMeasurement,
} from "./svg-paste";

const TABLER_OUTLINE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12m-9 0a9 9 0 1 0 18 0" /><g transform="translate(1 1)"><path d="M9 12l2 2l4 -4" onclick="alert(1)" /></g><script>alert(1)</script></svg>`;

/** Stands in for layout: each shape reports the box and paint given by its d. */
function fakeMeasure(
  paints: Record<string, Record<string, string>>,
  boxes: Record<string, [number, number, number, number]>,
) {
  return (root: SVGSVGElement) => {
    const results = new Map<Element, SvgShapeMeasurement | null>();
    root.querySelectorAll("path").forEach((shape) => {
      const d = shape.getAttribute("d")!;
      const [x, y, width, height] = boxes[d] ?? [0, 0, 24, 24];
      results.set(shape, {
        box: { x, y, width, height },
        userBox: { x, y, width, height },
        paint: paints[d] ?? { fill: "none", stroke: "none" },
        opacity: 1,
        transform: shape.parentElement?.getAttribute("transform") ?? "",
      });
    });
    return results;
  };
}

describe("extractSvgMarkup", () => {
  it("accepts SVG code copied from an icon site, with or without an XML prolog", () => {
    expect(extractSvgMarkup(`  ${TABLER_OUTLINE}\n`)).toBe(TABLER_OUTLINE);
    expect(
      extractSvgMarkup(`<?xml version="1.0"?>\n<!-- x -->${TABLER_OUTLINE}`),
    ).toBe(TABLER_OUTLINE);
  });

  it("rejects text that merely mentions an svg", () => {
    expect(extractSvgMarkup("use <svg> here")).toBeNull();
    expect(extractSvgMarkup("<div><svg></svg></div>")).toBeNull();
  });
});

describe("buildPastedSvgLayer", () => {
  const stroke = {
    fill: "none",
    stroke: "rgb(0, 0, 0)",
    "stroke-width": "2px",
  };

  it("builds a frame of recolourable Vector layers at the SVG's natural size", () => {
    const layer = buildPastedSvgLayer(
      TABLER_OUTLINE,
      "Frame",
      fakeMeasure(
        { "M12 12m-9 0a9 9 0 1 0 18 0": stroke, "M9 12l2 2l4 -4": stroke },
        { "M9 12l2 2l4 -4": [10, 11, 6, 4] },
      ),
    )!;
    expect(layer).toMatchObject({ width: 24, height: 24 });
    const frame = new DOMParser()
      .parseFromString(layer.html, "text/html")
      .querySelector<HTMLElement>('[data-an-primitive="frame"]')!;
    expect(frame.dataset.agentNativeLayerName).toBe("Frame");
    expect(frame.style.width).toBe("24px");

    const vectors = Array.from(frame.querySelectorAll(":scope > svg"));
    expect(
      vectors.map((vector) => vector.getAttribute("data-an-primitive")),
    ).toEqual(["path", "path"]);
    const check = vectors[1]!;
    expect(check.getAttribute("viewBox")).toBe("10 11 6 4");
    expect((check as unknown as HTMLElement).style.left).toBe("10px");
    const path = check.querySelector(":scope > path")!;
    expect(path.getAttribute("stroke")).toBe("rgb(0, 0, 0)");
    expect(path.getAttribute("stroke-width")).toBe("2");
    expect(path.getAttribute("transform")).toBe("translate(1 1)");
  });

  it("drops invisible geometry, scripts, and event handlers", () => {
    const layer = buildPastedSvgLayer(
      TABLER_OUTLINE,
      "Frame",
      fakeMeasure(
        { "M12 12m-9 0a9 9 0 1 0 18 0": stroke, "M9 12l2 2l4 -4": stroke },
        {},
      ),
    )!;
    expect(layer.html).not.toContain("M0 0h24v24H0z");
    expect(layer.html).not.toMatch(/script|onclick|alert/);
  });

  it("falls back to an image upload for SVGs with embedded rasters", () => {
    expect(
      buildPastedSvgLayer(
        '<svg width="10" height="10"><image href="data:image/png;base64,AAAA"/><path d="M0 0H1"/></svg>',
        "Logo",
        fakeMeasure({}, {}),
      ),
    ).toBeNull();
  });

  it("names a pasted file after the file, as Figma does", () => {
    expect(svgLayerName("builderLogo.svg")).toBe("builderLogo");
    expect(svgLayerName("")).toBe("Frame");
  });

  const fill = (value: string) => ({ fill: value, stroke: "none" });
  const measureAll = (paint: Record<string, string>) => (root: SVGSVGElement) =>
    new Map(
      Array.from(root.querySelectorAll("rect, circle, path"), (shape) => [
        shape as Element,
        {
          box: { x: 0, y: 0, width: 10, height: 10 },
          userBox: { x: 0, y: 0, width: 10, height: 10 },
          paint,
          opacity: 1,
          transform: "",
        } satisfies SvgShapeMeasurement,
      ]),
    );

  it("copies a gradient that sits under the root, as Illustrator exports it", () => {
    const layer = buildPastedSvgLayer(
      '<svg width="10" height="10"><linearGradient id="SVGID_1_"><stop offset="0" stop-color="red"/></linearGradient><g><rect width="10" height="10" fill="url(#SVGID_1_)"/></g></svg>',
      "Logo",
      measureAll(fill('url("#SVGID_1_")')),
    )!;
    const doc = new DOMParser().parseFromString(layer.html, "text/html");
    const gradient = doc.querySelector("linearGradient")!;
    expect(gradient.id).toMatch(/-SVGID_1_$/);
    expect(doc.querySelector("rect")!.getAttribute("fill")).toBe(
      `url(#${gradient.id})`,
    );
  });

  it("keeps group clips and filters, as Figma's own SVG export uses them", () => {
    const layer = buildPastedSvgLayer(
      '<svg width="10" height="10"><g clip-path="url(#clip0)"><g filter="url(#shadow)"><circle cx="5" cy="5" r="4"/></g></g><defs><clipPath id="clip0"><rect width="8" height="8"/></clipPath><filter id="shadow"><feGaussianBlur stdDeviation="1"/></filter></defs></svg>',
      "Icon",
      measureAll(fill("rgb(0, 0, 0)")),
    )!;
    const doc = new DOMParser().parseFromString(layer.html, "text/html");
    const circle = doc.querySelector("circle")!;
    const groups = [
      circle.parentElement!,
      circle.parentElement!.parentElement!,
    ];
    expect(groups[0]!.getAttribute("filter")).toMatch(/^url\(#.+-shadow\)$/);
    expect(groups[1]!.getAttribute("clip-path")).toMatch(/^url\(#.+-clip0\)$/);
    expect(doc.querySelectorAll("clipPath, filter")).toHaveLength(2);
  });

  it("gives every Vector its own defs, with ids unique per paste", () => {
    const svg =
      '<svg width="10" height="10"><defs><linearGradient id="a"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="5" height="5" fill="url(#a)"/><rect x="5" width="5" height="5" fill="url(#a)"/></svg>';
    const ids = (html: string) =>
      Array.from(
        new DOMParser()
          .parseFromString(html, "text/html")
          .querySelectorAll("linearGradient"),
        (gradient) => gradient.id,
      );
    const first = ids(
      buildPastedSvgLayer(svg, "A", measureAll(fill('url("#a")')))!.html,
    );
    const second = ids(
      buildPastedSvgLayer(svg, "B", measureAll(fill('url("#a")')))!.html,
    );
    expect(first).toHaveLength(2);
    expect(new Set([...first, ...second]).size).toBe(4);
  });

  it("falls back to an image when a reference needs an element outside the allowlist", () => {
    expect(
      buildPastedSvgLayer(
        '<svg width="10" height="10"><defs><filter id="f"><feImage href="#x"/></filter></defs><rect width="10" height="10" filter="url(#f)"/></svg>',
        "Logo",
        measureAll(fill("red")),
      ),
    ).toBeNull();
  });
});
