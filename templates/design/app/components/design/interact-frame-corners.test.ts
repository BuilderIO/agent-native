import { INTERACT_DEVICE_PRESETS } from "@shared/interact-device-presets";
import { describe, expect, it } from "vitest";

import { getInteractFrameCornerClass } from "./interact-frame-corners";

describe("getInteractFrameCornerClass", () => {
  it("rounds a phone the most, a tablet less and a desktop the least", () => {
    expect(getInteractFrameCornerClass({ category: "phone", width: 402 })).toBe(
      "rounded-4xl",
    );
    expect(
      getInteractFrameCornerClass({ category: "tablet", width: 834 }),
    ).toBe("rounded-3xl");
    expect(
      getInteractFrameCornerClass({ category: "desktop", width: 1440 }),
    ).toBe("rounded-xl");
  });

  it("goes by the preset's category, not its width, so a landscape tablet stays a tablet", () => {
    const landscape = INTERACT_DEVICE_PRESETS.find(
      (preset) => preset.width === 1194 && preset.category === "tablet",
    )!;
    expect(
      getInteractFrameCornerClass({
        category: landscape.category,
        width: landscape.width,
      }),
    ).toBe("rounded-3xl");
  });

  it("gives every selectable preset a corner", () => {
    for (const preset of INTERACT_DEVICE_PRESETS) {
      expect(
        getInteractFrameCornerClass({
          category: preset.category,
          width: preset.width,
        }),
        preset.name,
      ).toMatch(/^rounded-(xl|3xl|4xl)$/);
    }
  });

  it("reads a screen that matches no preset by its width", () => {
    expect(
      getInteractFrameCornerClass({ category: "custom", width: 390 }),
    ).toBe("rounded-4xl");
    expect(
      getInteractFrameCornerClass({ category: "custom", width: 768 }),
    ).toBe("rounded-3xl");
    expect(
      getInteractFrameCornerClass({ category: "custom", width: 1280 }),
    ).toBe("rounded-xl");
  });

  it("reads an unknown device by its width too", () => {
    expect(getInteractFrameCornerClass({ width: 320 })).toBe("rounded-4xl");
    expect(getInteractFrameCornerClass({ width: 1920 })).toBe("rounded-xl");
  });
});
