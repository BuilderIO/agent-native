import { describe, expect, it } from "vitest";

import { FOLDED_MESH_EFFECT } from "./native-effect-folded-mesh";
import {
  nativeParameterCanAnimate,
  validateNativeParameterAnimation,
} from "./native-parameter-animation";

describe("native parameter animation", () => {
  it.each(["lights", "noiseBands"])(
    "rejects record-array track %s before interpolation",
    (name) => {
      expect(nativeParameterCanAnimate(FOLDED_MESH_EFFECT, name)).toBe(false);
      expect(
        validateNativeParameterAnimation(
          FOLDED_MESH_EFFECT,
          {
            duration: 1,
            loop: false,
            tracks: {
              [name]: {
                keys: [
                  { time: 0, value: [] },
                  { time: 1, value: [] },
                ],
              },
            },
          },
          () => {},
        ),
      ).toEqual([`animation track ${name} is not animatable`]);
    },
  );
});
