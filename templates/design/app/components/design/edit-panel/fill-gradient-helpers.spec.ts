import { readGradientFillOpacity } from "@shared/gradient-opacity";
import { describe, expect, it } from "vitest";

import {
  imageFillChangePatch,
  isLayerHiddenBySize,
  removeFillLayerAtIndex,
  reorderFillLayerArrays,
  setImageFillLayerPatch,
  buildGradientLayer,
  parseGradientLayer,
  splitCssLayers,
  withLayerSizeMarker,
  type FillLayerArrays,
} from "./fill-gradient-helpers";

describe("setImageFillLayerPatch (IP: layer-index-aware image fill)", () => {
  it("overwrites only the targeted layer's four values, preserving siblings", () => {
    const layers: FillLayerArrays = {
      backgroundImage: [
        "linear-gradient(90deg, red 0%, blue 100%)",
        'url("old.png")',
      ],
      backgroundSize: ["auto", "cover"],
      backgroundRepeat: ["no-repeat", "no-repeat"],
      backgroundPosition: ["0% 0%", "center"],
    };
    const patch = setImageFillLayerPatch(layers, 1, {
      backgroundImage: 'url("new.png")',
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });

    const imageLayers = splitCssLayers(patch.backgroundImage);
    expect(imageLayers[0]).toBe("linear-gradient(90deg, red 0%, blue 100%)");
    expect(imageLayers[1]).toBe('url("new.png")');
    expect(splitCssLayers(patch.backgroundSize)).toEqual(["auto", "contain"]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "0% 0%",
      "center",
    ]);
  });

  it("appends a new layer when index is one past the current end, padding siblings with CSS defaults", () => {
    const layers: FillLayerArrays = {
      backgroundImage: ['url("a.png")'],
      backgroundSize: ["cover"],
      backgroundRepeat: ["no-repeat"],
      backgroundPosition: ["center"],
    };
    const patch = setImageFillLayerPatch(layers, 1, {
      backgroundImage: 'url("b.png")',
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
    expect(splitCssLayers(patch.backgroundImage)).toEqual([
      'url("a.png")',
      'url("b.png")',
    ]);
  });
});

describe("imageFillChangePatch (IP: base-fill Image switch preserves the layer stack)", () => {
  it("replaces CSS-wide shorthand defaults instead of emitting an invalid comma layer", () => {
    const patch = imageFillChangePatch(
      {
        backgroundImage: splitCssLayers("initial"),
        backgroundSize: splitCssLayers("initial"),
        backgroundRepeat: splitCssLayers("initial"),
        backgroundPosition: splitCssLayers("initial"),
      },
      null,
      {
        backgroundImage: 'url("tile.png")',
        backgroundSize: "auto",
        backgroundRepeat: "repeat",
        backgroundPosition: "top left",
      },
    );

    expect(patch).toEqual({
      backgroundImage: 'url("tile.png")',
      backgroundSize: "auto",
      backgroundRepeat: "repeat",
      backgroundPosition: "top left",
    });
  });

  it("prepends the image as a new layer instead of replacing the whole stack when no layer is selected", () => {
    const existingLayers: FillLayerArrays = {
      backgroundImage: ["linear-gradient(90deg, red 0%, blue 100%)"],
      backgroundSize: ["auto"],
      backgroundRepeat: ["no-repeat"],
      backgroundPosition: ["0% 0%"],
    };
    const patch = imageFillChangePatch(existingLayers, null, {
      backgroundImage: 'url("photo.png")',
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });

    const imageLayers = splitCssLayers(patch.backgroundImage);
    expect(imageLayers).toHaveLength(2);
    expect(imageLayers[0]).toBe('url("photo.png")');
    expect(imageLayers[1]).toBe("linear-gradient(90deg, red 0%, blue 100%)");
    expect(splitCssLayers(patch.backgroundSize)).toEqual(["cover", "auto"]);
  });

  it("delegates to setImageFillLayerPatch when a real layer index is selected", () => {
    const existingLayers: FillLayerArrays = {
      backgroundImage: ['url("old.png")', "linear-gradient(0deg, red, blue)"],
      backgroundSize: ["cover", "auto"],
      backgroundRepeat: ["no-repeat", "no-repeat"],
      backgroundPosition: ["center", "0% 0%"],
    };
    const patch = imageFillChangePatch(existingLayers, 0, {
      backgroundImage: 'url("new.png")',
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "top left",
    });
    const imageLayers = splitCssLayers(patch.backgroundImage);
    expect(imageLayers[0]).toBe('url("new.png")');
    expect(imageLayers[1]).toBe("linear-gradient(0deg, red, blue)");
    expect(splitCssLayers(patch.backgroundSize)).toEqual(["contain", "auto"]);
  });

  it("preserves repeated longhand values when editing an existing layer", () => {
    const patch = imageFillChangePatch(
      {
        backgroundImage: ['url("first.png")', 'url("second.png")'],
        backgroundSize: ["cover"],
        backgroundRepeat: ["repeat-x"],
        backgroundPosition: ["left top"],
      },
      0,
      {
        backgroundImage: 'url("new.png")',
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      },
    );

    expect(splitCssLayers(patch.backgroundSize)).toEqual(["contain", "cover"]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "no-repeat",
      "repeat-x",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "center",
      "left top",
    ]);
  });

  it("produces a single-layer patch when there is no existing layer stack", () => {
    const patch = imageFillChangePatch(
      {
        backgroundImage: [],
        backgroundSize: ["auto"],
        backgroundRepeat: ["repeat"],
        backgroundPosition: ["0% 0%"],
      },
      null,
      {
        backgroundImage: 'url("solo.png")',
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      },
    );
    expect(patch.backgroundImage).toBe('url("solo.png")');
    expect(patch.backgroundSize).toBe("cover");
    expect(patch.backgroundRepeat).toBe("no-repeat");
    expect(patch.backgroundPosition).toBe("center");
  });

  it("keeps explicit none layers and drops only unused parallel entries", () => {
    const patch = imageFillChangePatch(
      {
        backgroundImage: [
          "none",
          'url("legacy,cover.png")',
          "linear-gradient(90deg, #111111, #eeeeee)",
        ],
        backgroundSize: ["contain", "cover", "auto", "unused"],
        backgroundRepeat: ["repeat-x", "no-repeat", "repeat", "unused"],
        backgroundPosition: ["top left", "center", "0% 0%", "unused"],
      },
      null,
      {
        backgroundImage: 'url("new.png")',
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      },
    );

    expect(splitCssLayers(patch.backgroundImage)).toEqual([
      'url("new.png")',
      "none",
      'url("legacy,cover.png")',
      "linear-gradient(90deg, #111111, #eeeeee)",
    ]);
    expect(splitCssLayers(patch.backgroundSize)).toEqual([
      "cover",
      "contain",
      "cover",
      "auto",
    ]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "no-repeat",
      "repeat-x",
      "no-repeat",
      "repeat",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "center",
      "top left",
      "center",
      "0% 0%",
    ]);
  });

  it("repeats shorter authored longhands across existing image layers", () => {
    const patch = imageFillChangePatch(
      {
        backgroundImage: ['url("first.png")', 'url("second.png")'],
        backgroundSize: ["contain"],
        backgroundRepeat: ["repeat-x"],
        backgroundPosition: ["left top"],
      },
      null,
      {
        backgroundImage: 'url("new.png")',
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      },
    );

    expect(splitCssLayers(patch.backgroundImage)).toEqual([
      'url("new.png")',
      'url("first.png")',
      'url("second.png")',
    ]);
    expect(splitCssLayers(patch.backgroundSize)).toEqual([
      "cover",
      "contain",
      "contain",
    ]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "no-repeat",
      "repeat-x",
      "repeat-x",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "center",
      "left top",
      "left top",
    ]);
  });

  it("uses CSS defaults when authored longhands are absent", () => {
    const patch = imageFillChangePatch(
      {
        backgroundImage: ['url("first.png")', 'url("second.png")'],
        backgroundSize: [],
        backgroundRepeat: [],
        backgroundPosition: [],
      },
      null,
      {
        backgroundImage: 'url("new.png")',
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      },
    );

    expect(splitCssLayers(patch.backgroundSize)).toEqual([
      "cover",
      "auto",
      "auto",
    ]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "no-repeat",
      "repeat",
      "repeat",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "center",
      "0% 0%",
      "0% 0%",
    ]);
  });
});

describe("withLayerSizeMarker restore value (IP: hide/show preserves custom size)", () => {
  it("restores the stashed pre-hide size instead of always resetting to auto", () => {
    const shown = withLayerSizeMarker(
      ["0px 0px", "auto"],
      2,
      0,
      false,
      "150% 150%",
    );
    expect(splitCssLayers(shown)).toEqual(["150% 150%", "auto"]);
  });

  it("still defaults to auto when no restore value is provided (back-compat)", () => {
    const shown = withLayerSizeMarker(["0px 0px"], 1, 0, false);
    expect(splitCssLayers(shown)).toEqual(["auto"]);
    expect(isLayerHiddenBySize(splitCssLayers(shown)[0])).toBe(false);
  });

  it("still hides via the zero-size marker regardless of a restore value", () => {
    const hidden = withLayerSizeMarker(["cover"], 1, 0, true, "cover");
    expect(isLayerHiddenBySize(splitCssLayers(hidden)[0])).toBe(true);
  });
});

describe("fill longhand alignment follows CSS background-list repetition", () => {
  it("keeps the repeated size when removing a layer from a short list", () => {
    const patch = removeFillLayerAtIndex(
      {
        backgroundImage: ["url(a.png)", "url(b.png)"],
        backgroundSize: ["cover"],
        backgroundRepeat: ["no-repeat"],
        backgroundPosition: ["center"],
      },
      0,
    );

    expect(splitCssLayers(patch.backgroundImage)).toEqual(["url(b.png)"]);
    expect(splitCssLayers(patch.backgroundSize)).toEqual(["cover"]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual(["no-repeat"]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual(["center"]);
  });

  it("moves the repeated size with its image when reordering", () => {
    const patch = reorderFillLayerArrays(
      {
        backgroundImage: ["url(a.png)", "url(b.png)", "url(c.png)"],
        backgroundSize: ["cover", "contain"],
        backgroundRepeat: ["no-repeat", "repeat-x"],
        backgroundPosition: ["left", "right"],
      },
      2,
      0,
    );

    expect(splitCssLayers(patch.backgroundImage)).toEqual([
      "url(c.png)",
      "url(a.png)",
      "url(b.png)",
    ]);
    expect(splitCssLayers(patch.backgroundSize)).toEqual([
      "cover",
      "cover",
      "contain",
    ]);
    expect(splitCssLayers(patch.backgroundRepeat)).toEqual([
      "no-repeat",
      "no-repeat",
      "repeat-x",
    ]);
    expect(splitCssLayers(patch.backgroundPosition)).toEqual([
      "left",
      "left",
      "right",
    ]);
  });
});

describe("gradient opacity CSS wrapper parsing", () => {
  const originalStops = [
    { id: "red", color: "#ff0000", position: 0, opacity: 100 },
    {
      id: "transparent-blue",
      color: "rgba(0, 0, 255, 0)",
      position: 100,
      opacity: 0,
    },
  ];
  const cssomZero =
    "linear-gradient(90deg, color-mix(in srgb, color-mix(in srgb, rgb(255, 0, 0) 20%, transparent 80%) 0%, transparent 100%) 0%, color-mix(in srgb, color-mix(in srgb, rgba(0, 0, 255, 0) 20%, transparent 80%) 0%, transparent 100%) 100%)";

  it("reads CSSOM-weighted zero, then rewrites the fill opacity without nesting or losing stop alpha", () => {
    const parsed = parseGradientLayer(cssomZero);
    expect(parsed?.opacity).toBe(0);
    expect(parsed?.stops.map((stop) => stop.opacity)).toEqual([100, 100]);

    const atTwenty = buildGradientLayer("linear", originalStops, "90deg", 20);
    expect(parseGradientLayer(atTwenty)?.opacity).toBe(20);
    expect(
      parseGradientLayer(atTwenty)?.stops.map((stop) => stop.opacity),
    ).toEqual([100, 0]);
    const reparsedTwenty = parseGradientLayer(atTwenty)!;

    const atZero = buildGradientLayer(
      reparsedTwenty.type,
      reparsedTwenty.stops,
      reparsedTwenty.prefix,
      0,
    );
    expect(atZero).not.toContain("color-mix(in srgb, color-mix");
    expect(parseGradientLayer(atZero)?.opacity).toBe(0);
    expect(
      parseGradientLayer(atZero)?.stops.map((stop) => stop.opacity),
    ).toEqual([100, 0]);

    const atFifty = buildGradientLayer("linear", originalStops, "90deg", 50);
    expect(parseGradientLayer(atFifty)?.opacity).toBe(50);
    expect(
      parseGradientLayer(atFifty)?.stops.map((stop) => stop.opacity),
    ).toEqual([100, 0]);
    const atFull = buildGradientLayer("linear", originalStops, "90deg", 100);
    expect(atFull).not.toContain("color-mix");
    expect(
      parseGradientLayer(atFull)?.stops.map((stop) => stop.opacity),
    ).toEqual([100, 0]);
  });

  it("keeps a valid nested authored color-mix as a stop expression", () => {
    const innerStart = "color-mix(in srgb, #ff0000 50%, transparent 50%)";
    const innerEnd = "color-mix(in srgb, #0000ff 50%, transparent 50%)";
    const nested = `linear-gradient(90deg, color-mix(in srgb, ${innerStart} 20%, transparent 80%) 0%, color-mix(in srgb, ${innerEnd} 20%, transparent 80%) 100%)`;
    const parsed = parseGradientLayer(nested);
    expect(parsed?.opacity).toBe(20);
    expect(parsed?.stops.map((stop) => stop.color)).toEqual([
      innerStart,
      innerEnd,
    ]);
    const rewritten = buildGradientLayer(
      parsed!.type,
      parsed!.stops,
      parsed!.prefix,
      parsed!.opacity,
    );
    expect(rewritten).toContain(
      `color-mix(in srgb, ${innerStart} 20%, transparent) 0%`,
    );
    expect(rewritten).toContain(
      `color-mix(in srgb, ${innerEnd} 20%, transparent) 100%`,
    );
    const reparsed = parseGradientLayer(rewritten);
    expect(reparsed?.opacity).toBe(20);
    expect(reparsed?.stops.map((stop) => stop.color)).toEqual([
      innerStart,
      innerEnd,
    ]);
    // Retaining both nested percentages preserves the effective 10% paint.
  });

  it("keeps an outer hidden marker distinct and restores the prior nested paint", () => {
    const hidden =
      "color-mix(in srgb, color-mix(in srgb, #f97316 50%, transparent 50%) 0%, transparent 100%)";
    const stored = readGradientFillOpacity([{ color: hidden }]);
    expect(stored.opacity).toBe(0);
    expect(stored.stops[0]?.color).toBe(
      "color-mix(in srgb, #f97316 50%, transparent 50%)",
    );
    expect(
      readGradientFillOpacity([{ color: stored.stops[0]!.color }]),
    ).toEqual({ stops: [{ color: "#f97316" }], opacity: 50 });
  });
});
