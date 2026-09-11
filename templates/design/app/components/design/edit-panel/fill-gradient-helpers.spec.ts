import { describe, expect, it } from "vitest";

import {
  imageFillChangePatch,
  isLayerHiddenBySize,
  setImageFillLayerPatch,
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
    // Regression: switching the base solid/text fill row's paint type to
    // Image used to call a single-layer `imageFillToBackgroundStyles` patch
    // that overwrote backgroundImage/backgroundSize/backgroundRepeat/
    // backgroundPosition wholesale, silently discarding any gradient/image
    // layer already stacked below the base fill.
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
    // The previously-existing gradient layer must survive, not be wiped.
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

  it("produces a single-layer patch when there is no existing layer stack", () => {
    const patch = imageFillChangePatch(
      {
        backgroundImage: [],
        backgroundSize: [],
        backgroundRepeat: [],
        backgroundPosition: [],
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
  });
});

describe("withLayerSizeMarker restore value (IP: hide/show preserves custom size)", () => {
  it("restores the stashed pre-hide size instead of always resetting to auto", () => {
    // Regression: re-showing a hidden layer always reset its size to "auto",
    // permanently discarding a custom cover/contain/percentage size that was
    // set before it was hidden.
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
