import { describe, expect, it } from "vitest";

import { applyVisualEdit, buildCodeLayerProjection } from "./code-layer";
import {
  parseSvgPaintGradient,
  svgPaintGradientOpacity,
  svgPaintGradientWithOpacity,
} from "./svg-paint-gradient";

const PATH = `<svg data-agent-native-node-id="v1" data-an-primitive="path" viewBox="0 0 200 100" style="position:absolute;width:200px;height:100px"><path d="M 0 100 L 100 0 L 200 100" fill="none" stroke="#000000" stroke-width="2" style="stroke: #a62e2e"></path></svg>`;

describe("parseSvgPaintGradient", () => {
  it("reads angle and stops, including color-mix opacity stops", () => {
    expect(
      parseSvgPaintGradient(
        "linear-gradient(90deg in srgb, color-mix(in srgb, #ff0000 50%, transparent) 0%, rgb(0, 0, 255) 100%)",
      ),
    ).toEqual({
      type: "linear",
      angle: 90,
      stops: [
        { color: "color-mix(in srgb, #ff0000 50%, transparent)", offset: 0 },
        { color: "rgb(0, 0, 255)", offset: 100 },
      ],
    });
  });

  it("has no SVG paint server for conic or diamond gradients", () => {
    expect(parseSvgPaintGradient("conic-gradient(from 0deg, red, blue)")).toBe(
      null,
    );
    expect(
      parseSvgPaintGradient(
        "radial-gradient(ellipse closest-side at center, #fff 0%, #000 100%)",
      ),
    ).toBe(null);
  });
});

describe("vector stroke gradient source edits", () => {
  it("writes a userSpaceOnUse def, points the stroke at it, and drops the inline stroke", () => {
    const gradient = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
    const result = applyVisualEdit(PATH, {
      kind: "style",
      target: { nodeId: "v1" },
      property: "stroke",
      value: gradient,
    });
    expect(result.result.status).toBe("applied");
    expect(result.content).toContain(
      '<defs data-an-vector-stroke-gradient=""><linearGradient id="v1-stroke-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="200" y2="50">',
    );
    expect(result.content).toMatch(
      /<path[^>]*style="[^"]*stroke: url\(#v1-stroke-gradient\)/,
    );
    expect(result.content).not.toContain("stroke: #a62e2e");
    expect(
      buildCodeLayerProjection(result.content).nodes[0]?.style,
    ).toMatchObject({ "--an-vector-stroke-gradient": gradient });

    const cleared = applyVisualEdit(result.content, {
      kind: "style",
      target: { nodeId: "v1" },
      property: "stroke",
      value: "none",
    });
    expect(cleared.result.status).toBe("applied");
    expect(cleared.content).not.toContain("linearGradient");
    expect(cleared.content).not.toContain("url(#v1-stroke-gradient)");
    expect(cleared.content).not.toContain("--an-vector-stroke-gradient");
  });

  it("refuses a gradient SVG cannot draw", () => {
    const result = applyVisualEdit(PATH, {
      kind: "style",
      target: { nodeId: "v1" },
      property: "stroke",
      value: "conic-gradient(from 0deg, red, blue)",
    });
    expect(result.result.status).not.toBe("applied");
  });
});

describe("border-area gradient stroke fallback in source", () => {
  const BOX = `<div data-agent-native-node-id="b1" style="width:100px;height:60px;border:8px solid #f08989;background-color:#d9d9d9"></div>`;
  const edit = (html: string, property: string, value: string) => {
    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "b1" },
      property,
      value,
    });
    expect(result.result.status).toBe("applied");
    return result.content;
  };
  const style = (html: string) => html.match(/style="([^"]*)"/)![1]!;

  it("writes the fallback after a border-area layer and keeps the real size in the alias", () => {
    let html = edit(
      BOX,
      "background-image",
      "linear-gradient(90deg, #ff0000 0%, #0000ff 100%), none",
    );
    html = edit(html, "background-size", "100% 100%, auto");
    html = edit(html, "background-clip", "border-area, border-box");
    const written = style(html);
    expect(written).toContain("background-size: 0px 0px, auto");
    expect(written).toContain(
      "-webkit-background-size: if(supports(background-clip: border-area): 100% 100%, auto; else: 0px 0px, auto)",
    );
    expect(written).toContain(
      "border-image: linear-gradient(90deg, #ff0000 0%, #0000ff 100%) 1",
    );
    expect(written.indexOf("-webkit-background-size")).toBeGreaterThan(
      written.indexOf(" background-size"),
    );
    expect(written.indexOf("-webkit-border-image")).toBeGreaterThan(
      written.indexOf(" border-image"),
    );

    // An unrelated edit keeps the real size, not the fallback.
    html = edit(html, "border-width", "4px");
    expect(style(html)).toContain("border-area): 100% 100%, auto;");

    // Removing the stroke layer restores a plain background-size and drops the fallback.
    html = edit(html, "background-clip", "border-box");
    expect(style(html)).not.toContain("webkit");
    expect(style(html)).not.toContain("border-image");
    expect(style(html)).toContain("background-size: 100% 100%, auto");
  });

  it("projects the real size so the inspector does not read the stroke as hidden", () => {
    let html = edit(
      BOX,
      "background-image",
      "linear-gradient(90deg, #ff0000 0%, #0000ff 100%), none",
    );
    html = edit(html, "background-size", "100% 100%, auto");
    html = edit(html, "background-clip", "border-area, border-box");
    expect(
      buildCodeLayerProjection(html).nodes[0]?.style["-webkit-background-size"],
    ).toContain("100% 100%, auto;");
  });
});

describe("svgPaintGradientWithOpacity", () => {
  it("round-trips a hidden gradient back to its original stops", () => {
    const gradient = "linear-gradient(180deg, #782f2f 0%, rgb(0, 0, 255) 100%)";
    const hidden = svgPaintGradientWithOpacity(gradient, 0);
    expect(hidden).toBe(
      "linear-gradient(180deg, color-mix(in srgb, #782f2f 0%, transparent) 0%, color-mix(in srgb, rgb(0, 0, 255) 0%, transparent) 100%)",
    );
    expect(svgPaintGradientOpacity(hidden)).toEqual({ gradient, opacity: 0 });
    expect(svgPaintGradientWithOpacity(hidden, 100)).toBe(gradient);
  });
});
