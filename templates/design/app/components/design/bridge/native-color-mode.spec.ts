import { describe, expect, it } from "vitest";

import { GRAIN_GRADIENT_EFFECT } from "../../../../shared/native-effect-presets";
import { createWideColorGrainEffect } from "../../../../shared/native-effect-wide-color";
import { packNativeProperties } from "../../../../shared/native-effects";
import {
  detectNativeDisplayDynamicRange,
  encodeDisplayP3,
  linearSrgbToDisplayP3,
} from "./native-color-mode";

const definition = createWideColorGrainEffect(GRAIN_GRADIENT_EFFECT);

describe("linear Display-P3 presentation", () => {
  it("round-trips a wide-gamut P3 primary through the canonical linear-sRGB parameter ABI", () => {
    const packed = packNativeProperties(definition, {
      orange: { space: "display-p3", components: [1, 0, 0], alpha: 1 },
    });
    const linearP3 = linearSrgbToDisplayP3([packed[0], packed[1], packed[2]]);
    expect(linearP3[0]).toBeCloseTo(1, 5);
    expect(linearP3[1]).toBeCloseTo(0, 5);
    expect(linearP3[2]).toBeCloseTo(0, 5);
    expect(packed[0]).toBeGreaterThan(1);
    expect(packed[1]).toBeLessThan(0);
    expect(linearP3.map(encodeDisplayP3)).toEqual(
      expect.arrayContaining([
        expect.closeTo(1, 5),
        expect.closeTo(0, 5),
        expect.closeTo(0, 5),
      ]),
    );
  });
});

describe("display dynamic-range capability", () => {
  it("distinguishes an HDR-capable display from active HDR presentation", () => {
    expect(
      detectNativeDisplayDynamicRange(
        (media) =>
          media === "(dynamic-range: high)" ||
          media === "(dynamic-range: standard)",
      ),
    ).toBe("high-capable");
    expect(
      detectNativeDisplayDynamicRange(
        (media) => media === "(dynamic-range: standard)",
      ),
    ).toBe("standard-only");
  });

  it("keeps missing, nonvisual, and failed media-query reads distinct", () => {
    expect(detectNativeDisplayDynamicRange(undefined)).toBe("unreadable");
    expect(detectNativeDisplayDynamicRange(() => false)).toBe("unreadable");
    expect(
      detectNativeDisplayDynamicRange(() => {
        throw new Error("media query unavailable");
      }),
    ).toBe("unreadable");
  });
});
