import { describe, expect, it } from "vitest";

import {
  imageAdjustmentFilter,
  imageAdjustmentsFromFilter,
  imageScaleModeFromStyles,
  imageScaleModePatch,
} from "./image-element-fill";

describe("image scale modes", () => {
  it("reads Figma's scale modes back from object-fit and the crop marker", () => {
    expect(imageScaleModeFromStyles({ objectFit: "cover" })).toBe("fill");
    expect(imageScaleModeFromStyles({ objectFit: "contain" })).toBe("fit");
    expect(imageScaleModeFromStyles({ objectFit: "fill" })).toBe("fill");
    expect(imageScaleModeFromStyles({})).toBe("fill");
    expect(
      imageScaleModeFromStyles({
        objectFit: "cover",
        "--an-image-scale": "crop",
      }),
    ).toBe("crop");
  });

  it("switches to Crop without stretching the image to the box", () => {
    expect(imageScaleModePatch("crop")).toEqual({
      objectFit: "cover",
      "--an-image-scale": "crop",
    });
    expect(imageScaleModePatch("fill")).toEqual({
      objectFit: "cover",
      "--an-image-scale": "none",
    });
  });

  it("reads Fill back after leaving Crop", () => {
    expect(
      imageScaleModeFromStyles({
        objectFit: "cover",
        "--an-image-scale": "none",
      }),
    ).toBe("fill");
  });
});

describe("image adjustments", () => {
  it("writes Figma's measured strength and keeps unrelated filters", () => {
    expect(
      imageAdjustmentFilter("blur(4px)", {
        opacity: 100,
        exposure: 0,
        contrast: 100,
        saturation: -100,
      }),
    ).toBe("blur(4px) contrast(1.1) saturate(0)");
    expect(
      imageAdjustmentFilter("blur(4px) contrast(1.1)", {
        opacity: 100,
        exposure: 0,
        contrast: 0,
        saturation: 0,
      }),
    ).toBe("blur(4px)");
    expect(
      imageAdjustmentFilter("none", {
        opacity: 100,
        exposure: 0,
        contrast: 0,
        saturation: 0,
      }),
    ).toBe("none");
  });

  it("reads slider values back from the filter it wrote", () => {
    expect(
      imageAdjustmentsFromFilter(
        imageAdjustmentFilter(undefined, {
          opacity: 100,
          exposure: 0,
          contrast: -50,
          saturation: 75,
        }),
      ),
    ).toEqual({ opacity: 100, exposure: 0, contrast: -50, saturation: 75 });
  });

  it("keeps Exposure as a self-contained filter that round-trips with the others", () => {
    const filter = imageAdjustmentFilter("blur(4px)", {
      opacity: 100,
      exposure: 40,
      contrast: 50,
      saturation: -100,
    });
    expect(filter).toMatch(
      /^blur\(4px\) url\("data:image\/svg\+xml,.*#an-exposure-40"\) contrast\(1\.06\) saturate\(0\)$/,
    );
    expect(imageAdjustmentsFromFilter(filter)).toEqual({
      opacity: 100,
      exposure: 40,
      contrast: 50,
      saturation: -100,
    });
    expect(
      imageAdjustmentFilter(filter, {
        opacity: 100,
        exposure: 0,
        contrast: 0,
        saturation: 0,
      }),
    ).toBe("blur(4px)");
  });

  it("writes the row's opacity as a filter so layer opacity stays separate", () => {
    const filter = imageAdjustmentFilter("none", {
      opacity: 60,
      exposure: 0,
      contrast: 0,
      saturation: 0,
    });
    expect(filter).toBe("opacity(0.6)");
    expect(imageAdjustmentsFromFilter(filter).opacity).toBe(60);
  });
});
