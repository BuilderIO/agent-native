import { describe, expect, it } from "vitest";

import {
  defaultGradient,
  gradientToCss,
  parseGradientCss,
} from "./GradientEditor";
import {
  imageFillToCss,
  mergeImageFitDraft,
  parseImageFillCss,
  type ImageFillValue,
} from "./ImageFillControls";
import {
  descriptorFromPreset,
  shaderDescriptorToCss,
} from "./ShaderFillsPanel";

describe("gradient serialization", () => {
  it("builds a valid linear-gradient with angle + percent stops", () => {
    const css = gradientToCss({
      kind: "linear",
      angle: 90,
      stops: [
        { id: "a", color: "#ff0000", position: 0 },
        { id: "b", color: "#0000ff", position: 100 },
      ],
    });
    expect(css).toMatch(/^linear-gradient\(90deg, /);
    expect(css).toContain("0%");
    expect(css).toContain("100%");
  });

  it("maps each gradient kind to the right CSS function", () => {
    const stops = [
      { id: "a", color: "#000", position: 0 },
      { id: "b", color: "#fff", position: 100 },
    ];
    expect(gradientToCss({ kind: "radial", angle: 0, stops })).toMatch(
      /^radial-gradient\(circle/,
    );
    expect(gradientToCss({ kind: "diamond", angle: 0, stops })).toMatch(
      /^radial-gradient\(ellipse/,
    );
    expect(gradientToCss({ kind: "angular", angle: 45, stops })).toMatch(
      /^conic-gradient\(from 45deg/,
    );
  });

  it("round-trips a linear gradient through parse", () => {
    const original = defaultGradient("linear", "#3366ff");
    const css = gradientToCss(original);
    const parsed = parseGradientCss(css);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("linear");
    expect(parsed?.angle).toBe(90);
    expect(parsed?.stops.length).toBe(2);
  });

  it("parses standard ellipse radial gradients as radial, not diamond", () => {
    const parsed = parseGradientCss(
      "radial-gradient(ellipse at center, #000 0%, #fff 100%)",
    );

    expect(parsed?.kind).toBe("radial");
  });

  it("round-trips design-editor diamond gradients", () => {
    const parsed = parseGradientCss(
      "radial-gradient(ellipse closest-side at center, #000 0%, #fff 100%)",
    );

    expect(parsed?.kind).toBe("diamond");
  });

  it("returns null for non-gradient input", () => {
    expect(parseGradientCss("#ff0000")).toBeNull();
    expect(parseGradientCss("transparent")).toBeNull();
  });
});

describe("image fill serialization", () => {
  it("maps fit modes to CSS", () => {
    const base: ImageFillValue = { url: "https://x.test/a.png", fit: "fill" };
    expect(imageFillToCss(base)).toContain("cover");
    expect(imageFillToCss({ ...base, fit: "fit" })).toContain("contain");
    expect(imageFillToCss({ ...base, fit: "tile" })).toContain("repeat");
  });

  it("parses url + fit back out", () => {
    const css = imageFillToCss({ url: "https://x.test/a.png", fit: "tile" });
    const parsed = parseImageFillCss(css);
    expect(parsed?.url).toBe("https://x.test/a.png");
    expect(parsed?.fit).toBe("tile");
  });

  it("round-trips crop separately from fill", () => {
    const crop = imageFillToCss({
      url: "https://x.test/a.png",
      fit: "crop",
    });
    const fill = imageFillToCss({
      url: "https://x.test/a.png",
      fit: "fill",
    });

    expect(crop).toContain("cover");
    expect(fill).toContain("cover");
    expect(parseImageFillCss(crop)?.fit).toBe("crop");
    expect(parseImageFillCss(fill)?.fit).toBe("fill");
  });

  it("hydrates fit from computed-style-like longhands without a marker", () => {
    expect(
      parseImageFillCss({
        backgroundImage: 'url("https://x.test/a.png")',
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      })?.fit,
    ).toBe("fit");
  });

  it("hydrates tile from computed-style-like longhands without a marker", () => {
    expect(
      parseImageFillCss({
        backgroundImage: 'url("https://x.test/a.png")',
        backgroundSize: "auto",
        backgroundRepeat: "repeat",
        backgroundPosition: "top left",
      })?.fit,
    ).toBe("tile");
  });

  it("hydrates tile from normalized computed background positions", () => {
    for (const position of ["0% 0%", "left top", "0px 0px"]) {
      expect(
        parseImageFillCss({
          backgroundImage: 'url("https://x.test/a.png")',
          backgroundSize: "auto",
          backgroundRepeat: "repeat",
          backgroundPosition: position,
        })?.fit,
      ).toBe("tile");
    }
  });

  it("returns transparent for empty url", () => {
    expect(imageFillToCss({ url: "", fit: "fill" })).toBe("transparent");
  });

  it("preserves an uncommitted URL draft when the fit mode changes", () => {
    expect(
      mergeImageFitDraft(
        { url: "https://x.test/old.png", fit: "fill" },
        " https://x.test/new.png ",
        "fit",
      ),
    ).toEqual({ url: "https://x.test/new.png", fit: "fit" });
  });
});

describe("shader fill serialization", () => {
  it("produces a CSS fallback gradient for a preset descriptor", () => {
    const descriptor = descriptorFromPreset({
      name: "MeshGradient",
      label: "Mesh Gradient",
      description: "",
      defaultColors: ["#e0eaff", "#241d9a", "#f75092"],
      params: [],
    });
    const css = shaderDescriptorToCss(descriptor);
    expect(css).toContain("#e0eaff");
    expect(css).toContain("linear-gradient");
  });
});
