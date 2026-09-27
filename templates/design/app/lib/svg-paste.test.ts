// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  buildPastedSvgLayer,
  extractSvgMarkup,
  svgLayerName,
  type SvgShapeMeasurement,
} from "./svg-paste";

const TABLER_OUTLINE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12m-9 0a9 9 0 1 0 18 0" /><g transform="translate(1 1)"><path d="M9 12l2 2l4 -4" onclick="alert(1)" /></g><script>alert(1)</script></svg>`;

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

  it("accepts mixed-case SVG roots and removes mixed-case unsafe elements", () => {
    let importedRoot: SVGSVGElement | undefined;
    let stylesheet = "";
    const layer = buildPastedSvgLayer(
      '<SVG width="10" height="10"><STYLE>.logo { fill: url(https://evil.example/paint.svg); stroke: red }</STYLE><path class="logo" d="M0 0h10"/><SCRIPT>alert(1)</SCRIPT><ANIMATETRANSFORM/></SVG>',
      "Logo",
      (root) => {
        importedRoot = root;
        stylesheet =
          Array.from(root.querySelectorAll("*")).find(
            (element) => element.localName.toLowerCase() === "style",
          )?.textContent ?? "";
        return measureAll(fill("red"))(root);
      },
    );

    expect(layer).not.toBeNull();
    expect(importedRoot?.localName.toLowerCase()).toBe("svg");
    expect(
      Array.from(importedRoot!.querySelectorAll("*")).some((element) =>
        ["script", "animatetransform"].includes(
          element.localName.toLowerCase(),
        ),
      ),
    ).toBe(false);
    expect(stylesheet).not.toContain("evil.example");
    expect(stylesheet).toContain("stroke: red");
  });

  it.each(["IMAGE", "foreignOBJECT", "TEXT", "USE"])(
    "rejects unsupported mixed-case <%s> elements",
    (tag) => {
      expect(
        buildPastedSvgLayer(
          `<svg width="10" height="10"><path d="M0 0h10"/><${tag}/></svg>`,
          "Logo",
          measureAll(fill("red")),
        ),
      ).toBeNull();
    },
  );

  it("strips editor metadata from drawable and cloned definition elements", () => {
    const layer = buildPastedSvgLayer(
      '<svg width="10" height="10"><path d="M0 0h10" clip-path="url(#clip)" data-an-open-fill-opacity="forged" data-agent-native-node-id="forged"/><defs><clipPath id="clip"><path d="M0 0h10" data-an-open-fill-opacity="forged" data-agent-native-node-id="forged"/></clipPath></defs></svg>',
      "Logo",
      measureAll(fill("red")),
    )!;

    expect(layer.html).not.toContain("data-an-open-fill-opacity");
    expect(layer.html).not.toContain('data-agent-native-node-id="forged"');
    expect(layer.html).toContain("clipPath");
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

  it("removes external URLs but keeps safe inline style declarations", () => {
    const measuredRoots: SVGSVGElement[] = [];
    const layer = buildPastedSvgLayer(
      '<svg width="10" height="10"><rect width="10" height="10" filter="url(https://example.com/filter.svg#f)" style="clip-path:url(https://example.com/clip.svg#c);stroke:red"/></svg>',
      "Logo",
      (root) => {
        measuredRoots.push(root);
        return measureAll(fill("red"))(root);
      },
    )!;

    const measuredRoot = measuredRoots[0];
    const measuredRect = Array.from(
      measuredRoot?.querySelectorAll("*") ?? [],
    ).find((element) => element.tagName.toLowerCase() === "rect");
    expect(measuredRect?.hasAttribute("filter")).toBeFalsy();
    expect(measuredRect?.getAttribute("style")).toContain("stroke: red");
    expect(measuredRect?.getAttribute("style")).not.toContain("clip-path");
    expect(layer.html).not.toContain("https://example.com");
  });

  it("removes external URLs obscured by CSS escaped newlines", () => {
    for (const lineBreak of ["\n", "\r\n"]) {
      const lineContinuation = "\\" + lineBreak;
      const measuredRoots: SVGSVGElement[] = [];
      buildPastedSvgLayer(
        `<svg width="10" height="10">
        <style>.shape { fill: u${lineContinuation}rl(https://example.com/paint.svg); stroke: red }</style>
        <rect class="shape" width="10" height="10"
          filter="url(${lineContinuation}https://example.com/filter.svg)"
          style="clip-path:u${lineContinuation}rl(https://example.com/clip.svg);stroke:blue" />
      </svg>`,
        "Logo",
        (root) => {
          measuredRoots.push(root);
          return measureAll(fill("red"))(root);
        },
      );

      const root = measuredRoots[0]!;
      const rect = root.querySelector("rect")!;
      expect(rect.hasAttribute("filter")).toBe(false);
      expect(rect.getAttribute("style")).toContain("stroke: blue");
      expect(rect.getAttribute("style")).not.toContain("clip-path");
      expect(
        root.ownerDocument.querySelector("style")?.textContent,
      ).not.toContain("example.com");
      expect(root.ownerDocument.querySelector("style")?.textContent).toContain(
        "stroke: red",
      );
    }
  });

  it("removes external URLs after a hex escape with a CRLF terminator", () => {
    const measuredRoots: SVGSVGElement[] = [];
    buildPastedSvgLayer(
      '<svg width="10" height="10"><rect width="10" height="10"/><style>.shape { fill: u\\72&#13;&#10;l(https://example.com/payload.svg); stroke: red }</style></svg>',
      "Logo",
      (root) => {
        measuredRoots.push(root);
        return measureAll(fill("red"))(root);
      },
    );

    const css =
      measuredRoots[0]?.ownerDocument.querySelector("style")?.textContent;
    expect(css).not.toContain("https://example.com/payload.svg");
    expect(css).toContain("stroke: red");
  });

  it("imports namespace-less clipboard SVG markup into the SVG namespace", () => {
    const importNode = vi.spyOn(document, "importNode");
    let importedRoot: SVGSVGElement | undefined;
    try {
      buildPastedSvgLayer(
        '<svg data-title="a > b"><path d="M0 0h10" /></svg>',
        "Logo",
      );
      importedRoot = importNode.mock.results[0]?.value as
        | SVGSVGElement
        | undefined;
    } finally {
      importNode.mockRestore();
    }

    expect(importedRoot?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(importedRoot?.getAttribute("data-title")).toBe("a > b");
    expect(importedRoot?.firstElementChild?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
  });

  it("keeps a multiline default namespace when the root has quoted greater-than attributes", () => {
    const importNode = vi.spyOn(document, "importNode");
    let importedRoot: SVGSVGElement | undefined;
    try {
      buildPastedSvgLayer(
        '<svg data-title="a > b"\n  xmlns\n    = "http://www.w3.org/2000/svg"><path d="M0 0h10" /></svg>',
        "Logo",
      );
      importedRoot = importNode.mock.results[0]?.value as
        | SVGSVGElement
        | undefined;
    } finally {
      importNode.mockRestore();
    }

    expect(importedRoot?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(importedRoot?.getAttribute("xmlns")).toBe(
      "http://www.w3.org/2000/svg",
    );
    expect(importedRoot?.getAttribute("data-title")).toBe("a > b");
    expect(importedRoot?.firstElementChild?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
  });

  it("measures namespace-less clipboard shapes as SVG elements", () => {
    let measuredShape: Element | undefined;
    const layer = buildPastedSvgLayer(
      '<svg width="10" height="10"><path d="M0 0H10" fill="#123456" /></svg>',
      "Logo",
      (root) => {
        const shape = root.querySelector("path")!;
        measuredShape = shape;
        return new Map([
          [
            shape,
            {
              box: { x: 0, y: 0, width: 10, height: 10 },
              userBox: { x: 0, y: 0, width: 10, height: 10 },
              paint: fill("#123456"),
              opacity: 1,
              transform: "",
            },
          ],
        ]);
      },
    );

    expect(measuredShape?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(layer?.html).toContain('data-an-primitive="path"');
  });

  it("keeps safe stylesheet declarations and rules around external URLs", () => {
    const measuredRoots: SVGSVGElement[] = [];
    buildPastedSvgLayer(
      '<svg width="10" height="10"><rect class="shape" width="10" height="10"/><style>.shape { fill: url(https://example.com/paint.svg#p); stroke: red } .safe { fill: blue }</style></svg>',
      "Logo",
      (root) => {
        measuredRoots.push(root);
        return measureAll(fill("red"))(root);
      },
    );

    const measuredRoot = measuredRoots[0];
    const css = Array.from(
      measuredRoot?.ownerDocument.getElementsByTagName("style") ?? [],
      (style) => style.textContent ?? "",
    ).join("\n");
    expect(css).toContain("stroke: red");
    expect(css).toContain(".safe");
    expect(css).not.toContain("https://example.com");
    expect(css).not.toContain("fill: url");
  });

  it("preserves local URL references and ordinary attributes", () => {
    const measuredRoots: SVGSVGElement[] = [];
    const layer = buildPastedSvgLayer(
      '<svg width="10" height="10"><defs><clipPath id="clip"><rect width="8" height="8"/></clipPath></defs><rect width="10" height="10" clip-path="url(#clip)" data-label="kept"/></svg>',
      "Logo",
      (root) => {
        measuredRoots.push(root);
        return measureAll(fill("red"))(root);
      },
    )!;
    const measuredRoot = measuredRoots[0];
    const doc = new DOMParser().parseFromString(layer.html, "text/html");
    expect(
      doc.querySelector("rect[clip-path]")?.getAttribute("clip-path"),
    ).toMatch(/^url\(#.+-clip\)$/);
    expect(
      measuredRoot
        ?.querySelector("rect[data-label]")
        ?.getAttribute("data-label"),
    ).toBe("kept");
  });

  it("removes remote hrefs and CSS URLs after CSS parsing", () => {
    const measuredRoots: SVGSVGElement[] = [];
    buildPastedSvgLayer(
      '<svg width="10" height="10" xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="10" height="10" href="https://example.com/a.svg" xlink:href="https://example.com/b.svg" data-local="#safe" aria-label="safe" data-safe-href="#local" style="fill:url(#inline) URL( https://example.com/a.svg );stroke:red"/><style>@import "https://example.com/import.css";.shape{fill:u\\72 l(https://example.com/escaped.svg);stroke:blue}.mixed{fill:url(#local) url(https://example.com/mixed.svg);stroke:purple}.commented{fill:u/**/rl(https://example.com/comment.svg);stroke:teal}.safe{fill:url(#local);stroke:green}</style></svg>',
      "Logo",
      (root) => {
        measuredRoots.push(root);
        return measureAll(fill("red"))(root);
      },
    );
    const rect = measuredRoots[0]?.querySelector("rect");
    expect(rect?.hasAttribute("href")).toBe(false);
    expect(rect?.hasAttribute("xlink:href")).toBe(false);
    expect(rect?.getAttribute("data-local")).toBe("#safe");
    expect(rect?.getAttribute("data-safe-href")).toBe("#local");
    expect(rect?.getAttribute("style")).toContain("stroke: red");
    expect(rect?.getAttribute("style")).toContain("url(#inline)");
    expect(rect?.getAttribute("style")).not.toMatch(/example\.com/i);

    const css = Array.from(
      measuredRoots[0]?.ownerDocument.querySelectorAll("style") ?? [],
      (style) => style.textContent ?? "",
    ).join("\n");
    expect(css).not.toMatch(/@import|example\.com/i);
    expect(css).toContain("stroke:green");
    expect(css).toContain("url(#local)");
    expect(css).toContain("stroke:purple");
    expect(css).toContain("stroke:teal");
  });

  it("drops malformed stylesheets containing external references", () => {
    const measuredRoots: SVGSVGElement[] = [];
    buildPastedSvgLayer(
      '<svg width="10" height="10"><rect width="10" height="10"/><style>.safe{stroke:red}.broken{fill:url(https://example.com/a.svg)</style></svg>',
      "Logo",
      (root) => {
        measuredRoots.push(root);
        return measureAll(fill("red"))(root);
      },
    );
    expect(measuredRoots[0]?.ownerDocument.querySelector("style")).toBeNull();
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
