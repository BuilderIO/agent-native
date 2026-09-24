import { describe, expect, it } from "vitest";

import {
  addFillLayerPatch,
  buildSolidFillLayer,
  parseSolidFillLayer,
  removeBaseFillPatch,
} from "./edit-panel/fill-gradient-helpers";
import {
  joinCssLayers,
  parseGradientLayer,
  removeFillLayerAtIndex,
  solidToGradientPatch,
  splitCssLayers,
} from "./EditPanel";

describe("removeFillLayerAtIndex", () => {
  it("removes the same index from all four parallel arrays", () => {
    const patch = removeFillLayerAtIndex(
      {
        backgroundImage: [
          "linear-gradient(90deg, red, blue)",
          "url(a.png)",
          "url(b.png)",
        ],
        backgroundSize: ["auto", "cover", "contain"],
        backgroundRepeat: ["no-repeat", "repeat-x", "repeat-y"],
        backgroundPosition: ["0% 0%", "10% 10%", "20% 20%"],
      },
      1, // remove the middle layer (url(a.png) / cover / repeat-x / 10% 10%)
    );

    expect(splitCssLayers(patch.backgroundImage)).toEqual([
      "linear-gradient(90deg, red, blue)",
      "url(b.png)",
    ]);
    expect(splitCssLayers(patch.backgroundSize)).toEqual(["auto", "contain"]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "no-repeat",
      "repeat-y",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "0% 0%",
      "20% 20%",
    ]);
  });

  it("keeps every remaining layer's size/repeat/position paired with its own image, not shifted", () => {
    // Three distinctly-tagged layers so a misalignment is obvious: layer N's
    // size/repeat/position all encode N, e.g. layer 2's size is "2px 2px".
    const layers = {
      backgroundImage: ["url(0.png)", "url(1.png)", "url(2.png)"],
      backgroundSize: ["0px 0px", "1px 1px", "2px 2px"],
      backgroundRepeat: ["repeat 0", "repeat 1", "repeat 2"],
      backgroundPosition: ["0% 0%", "1% 1%", "2% 2%"],
    };

    // Remove layer 0 — layer "1" and layer "2" must keep their own tagged
    // size/repeat/position, not shift to what used to belong to the layer
    // before them (there's nothing before layer 1 now, but a naive 2-array
    // fix would leave size/repeat/position untouched, so index 0 in those
    // arrays — "0px 0px" / "repeat 0" / "0% 0%" — would incorrectly become
    // paired with url(1.png)).
    const patch = removeFillLayerAtIndex(layers, 0);

    expect(splitCssLayers(patch.backgroundImage)).toEqual([
      "url(1.png)",
      "url(2.png)",
    ]);
    expect(splitCssLayers(patch.backgroundSize)).toEqual([
      "1px 1px",
      "2px 2px",
    ]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "repeat 1",
      "repeat 2",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "1% 1%",
      "2% 2%",
    ]);
  });

  it("removing the last layer results in 'none' for every array", () => {
    const patch = removeFillLayerAtIndex(
      {
        backgroundImage: ["url(only.png)"],
        backgroundSize: ["cover"],
        backgroundRepeat: ["no-repeat"],
        backgroundPosition: ["center"],
      },
      0,
    );

    expect(patch.backgroundImage).toBe("none");
    expect(patch.backgroundSize).toBe("none");
    expect(patch.backgroundRepeat).toBe("none");
    expect(patch.backgroundPosition).toBe("none");
  });

  it("is a no-op (arrays unchanged) for an out-of-range index", () => {
    const layers = {
      backgroundImage: ["url(a.png)"],
      backgroundSize: ["cover"],
      backgroundRepeat: ["no-repeat"],
      backgroundPosition: ["center"],
    };
    const patch = removeFillLayerAtIndex(layers, 5);

    expect(splitCssLayers(patch.backgroundImage)).toEqual(["url(a.png)"]);
    expect(splitCssLayers(patch.backgroundSize)).toEqual(["cover"]);
  });

  it("round-trips through joinCssLayers/splitCssLayers for gradients with internal commas", () => {
    const patch = removeFillLayerAtIndex(
      {
        backgroundImage: [
          "linear-gradient(90deg, #111111 0%, #eeeeee 100%)",
          "linear-gradient(45deg, #222222 0%, #dddddd 100%)",
        ],
        backgroundSize: ["auto", "auto"],
        backgroundRepeat: ["no-repeat", "no-repeat"],
        backgroundPosition: ["0% 0%", "0% 0%"],
      },
      0,
    );

    // The comma inside the remaining gradient's stop list must not be
    // misread as a layer separator.
    expect(splitCssLayers(patch.backgroundImage)).toEqual([
      "linear-gradient(45deg, #222222 0%, #dddddd 100%)",
    ]);
  });
});

describe("solidToGradientPatch", () => {
  const fillLayers = (
    backgroundImage: string[],
    backgroundSize: string[] = [],
    backgroundRepeat: string[] = [],
    backgroundPosition: string[] = [],
  ) => ({
    backgroundImage,
    backgroundSize,
    backgroundRepeat,
    backgroundPosition,
  });

  it("solid to gradient converts instead of stacking", () => {
    const patch = solidToGradientPatch("#FFFFFF", fillLayers([]), "linear");

    // One real fill after the switch: the gradient replaces the solid
    // (backgroundColor cleared) instead of stacking on top of it, which
    // used to leave a phantom second row in the Fill panel.
    expect(patch.backgroundColor).toBe("transparent");
    expect(splitCssLayers(patch.backgroundImage)).toHaveLength(1);
  });

  it("appends the converted base gradient under existing background layers", () => {
    const patch = solidToGradientPatch(
      "#FFFFFF",
      fillLayers(["url(a.png)"], ["cover"], ["repeat-x"], ["20% 30%"]),
      "linear",
    );
    const layers = splitCssLayers(patch.backgroundImage);

    expect(layers).toHaveLength(2);
    expect(layers[0]).toBe("url(a.png)");
    expect(layers[1]).toContain("linear-gradient(");
    expect(splitCssLayers(patch.backgroundSize)).toEqual(["cover", "auto"]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "repeat-x",
      "no-repeat",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "20% 30%",
      "0% 0%",
    ]);
  });

  it("round-trips the original color out of the gradient's first stop", () => {
    const patch = solidToGradientPatch("#FF0000", fillLayers([]), "linear");
    const [gradientLayer] = splitCssLayers(patch.backgroundImage);
    const gradient = parseGradientLayer(gradientLayer || "");

    // Switching back to solid recovers the pre-gradient color from the
    // first stop (the panel's solid branch prefers it over the now-
    // "transparent" backgroundColor, which would otherwise fall back to
    // black).
    expect(gradient?.stops[0]?.color).toBe("#ff0000");
    expect(gradient?.stops[0]?.opacity).toBe(100);
  });
});

describe("stacked solid fills", () => {
  it("uses and recognizes the canonical constant-gradient layer", () => {
    const solidLayer = buildSolidFillLayer("#ff0000");

    expect(solidLayer).toBe("linear-gradient(#ff0000 0 0)");
    expect(parseSolidFillLayer(solidLayer)).toBe("#ff0000");
    expect(
      parseSolidFillLayer(
        "linear-gradient(rgb(255, 0, 0) 0px, rgb(255, 0, 0) 0px)",
      ),
    ).toBe("#ff0000");
    expect(() => buildSolidFillLayer("not a color")).toThrow(
      "Invalid solid fill color",
    );
  });

  it("does not classify ordinary uniform two-stop gradients as solids", () => {
    expect(
      parseSolidFillLayer("linear-gradient(90deg, #ff0000 0%, #ff0000 100%)"),
    ).toBeNull();
  });
});

describe("splitCssLayers / joinCssLayers round-trip (sanity for the arrays above)", () => {
  it("splits comma-separated layers while respecting parens", () => {
    expect(
      splitCssLayers(
        "linear-gradient(90deg, red, blue), url(a.png), url(b.png)",
      ),
    ).toEqual([
      "linear-gradient(90deg, red, blue)",
      "url(a.png)",
      "url(b.png)",
    ]);
  });

  it("joins an empty array back to the CSS 'none' sentinel", () => {
    expect(joinCssLayers([])).toBe("none");
  });
});

describe("addFillLayerPatch", () => {
  it("reveals the hidden base solid when there is truly no fill at all", () => {
    const patch = addFillLayerPatch({
      backgroundColor: "transparent",
      backgroundLayers: [],
      backgroundSizeLayers: [],
      backgroundRepeatLayers: [],
      backgroundPositionLayers: [],
    });

    expect(patch).toEqual({ backgroundColor: "#d9d9d9" });
  });

  it("adds a solid layer instead of un-hiding the base solid when layers already exist", () => {
    // Regression: after switching solid -> gradient (solidToGradientPatch
    // clears backgroundColor to "transparent"), clicking "+" again used to
    // just un-hide the base solid instead of stacking a new layer — the
    // opposite of "+", and it reintroduced the exact phantom-fill problem
    // solidToGradientPatch exists to avoid.
    const patch = addFillLayerPatch({
      backgroundColor: "transparent",
      backgroundLayers: ["linear-gradient(90deg, red, blue)"],
      backgroundSizeLayers: ["auto"],
      backgroundRepeatLayers: ["no-repeat"],
      backgroundPositionLayers: ["0% 0%"],
    });

    expect(patch.backgroundColor).toBeUndefined();
    const layers = splitCssLayers(patch.backgroundImage ?? "");
    expect(layers).toHaveLength(2);
    expect(parseSolidFillLayer(layers[0] ?? "")).toBe("#d9d9d9");
    expect(layers[1]).toBe("linear-gradient(90deg, red, blue)");
    expect(splitCssLayers(patch.backgroundSize ?? "")).toEqual([
      "auto",
      "auto",
    ]);
    expect(splitCssLayers(patch.backgroundRepeat ?? "")).toEqual([
      "no-repeat",
      "no-repeat",
    ]);
    expect(splitCssLayers(patch.backgroundPosition ?? "")).toEqual([
      "0% 0%",
      "0% 0%",
    ]);
  });

  it("adds a layer on top of a visible base solid, keeping the solid", () => {
    const patch = addFillLayerPatch({
      backgroundColor: "#ff0000",
      backgroundLayers: [],
      backgroundSizeLayers: [],
      backgroundRepeatLayers: [],
      backgroundPositionLayers: [],
    });

    expect(patch.backgroundColor).toBeUndefined();
    const [newLayer] = splitCssLayers(patch.backgroundImage ?? "");
    expect(parseSolidFillLayer(newLayer ?? "")).toBe("#ff0000");
  });
});

describe("removeBaseFillPatch", () => {
  it("clears only the base color, never backgroundImage", () => {
    // Regression: this used to also set backgroundImage: "none" whenever
    // onStylesChange was available, silently deleting every other stacked
    // gradient/image layer just from clicking the base fill row's remove
    // button.
    const patch = removeBaseFillPatch("backgroundColor");

    expect(patch).toEqual({ backgroundColor: "transparent" });
    expect(patch.backgroundImage).toBeUndefined();
  });

  it("clears the text color property for text fills", () => {
    expect(removeBaseFillPatch("color")).toEqual({ color: "transparent" });
  });
});
