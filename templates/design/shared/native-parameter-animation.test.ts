import { describe, expect, it } from "vitest";

import { FLOCKING_SWARM_EFFECT } from "./native-effect-owned-aa-flocking";
import { TEMPORAL_IMAGE_DEFINITIONS } from "./native-effect-owned-ag-temporal-images";
import {
  nativeParameterCanAnimate,
  resolveNativeParameterAnimation,
  validateNativeParameterAnimation,
  type NativeParameterAnimation,
} from "./native-parameter-animation";

const definition = FLOCKING_SWARM_EFFECT;
const animation: NativeParameterAnimation = {
  duration: 2,
  loop: true,
  tracks: {
    speed: {
      keys: [
        { time: 0, value: 20, easing: "linear" },
        { time: 2, value: 100 },
      ],
    },
    colorA: {
      keys: [
        { time: 0, value: { space: "srgb", components: [1, 0, 0], alpha: 1 } },
        {
          time: 2,
          value: { space: "srgb", components: [0, 0, 1], alpha: 0.5 },
        },
      ],
    },
  },
};

const validateValue = (
  _property: unknown,
  _value: unknown,
  _name: string,
  _errors: string[],
) => {};

describe("native parameter animation", () => {
  it("samples physics and colors by local time, including repeat and finite hold", () => {
    expect(
      validateNativeParameterAnimation(definition, animation, validateValue),
    ).toEqual([]);
    expect(
      resolveNativeParameterAnimation(definition, {}, animation, 1).speed,
    ).toBe(60);
    expect(
      resolveNativeParameterAnimation(definition, {}, animation, 3).speed,
    ).toBe(60);
    expect(
      resolveNativeParameterAnimation(
        definition,
        {},
        { ...animation, loop: false },
        3,
      ).speed,
    ).toBe(100);
    expect(
      resolveNativeParameterAnimation(definition, {}, animation, 1).colorA,
    ).toEqual({
      space: "srgb",
      components: [0.5, 0, 0.5],
      alpha: 0.75,
    });
  });

  it("uses discrete values for bool and rounds interpolated integers", () => {
    const typed = {
      ...definition,
      properties: {
        ...definition.properties,
        mode: { type: "bool" as const, label: "Mode", default: false },
        phase: {
          type: "int" as const,
          label: "Phase",
          default: 0,
          min: 0,
          max: 5,
        },
      },
    };
    const tracks: NativeParameterAnimation = {
      duration: 2,
      loop: false,
      tracks: {
        mode: {
          keys: [
            { time: 0, value: false },
            { time: 2, value: true },
          ],
        },
        phase: {
          keys: [
            { time: 0, value: 0 },
            { time: 2, value: 5 },
          ],
        },
      },
    };
    expect(resolveNativeParameterAnimation(typed, {}, tracks, 1)).toMatchObject(
      {
        mode: false,
        phase: 3,
      },
    );
    expect(resolveNativeParameterAnimation(typed, {}, tracks, 2)).toMatchObject(
      {
        mode: true,
        phase: 5,
      },
    );
  });

  it("rejects state count and live pointer tracks plus malformed key timing", () => {
    expect(
      nativeParameterCanAnimate(
        {
          ...definition,
          interaction: {
            positionProperty: "perception",
            activeProperty: "cohesion",
          },
        },
        "perception",
      ),
    ).toBe(false);
    const count = {
      duration: 2,
      loop: true,
      tracks: {
        agentCount: {
          keys: [
            { time: 0, value: 64 },
            { time: 2, value: 256 },
          ],
        },
      },
    };
    expect(
      validateNativeParameterAnimation(definition, count, validateValue),
    ).toContain("animation track agentCount is not animatable");
    const bad = {
      ...animation,
      tracks: {
        speed: {
          keys: [
            { time: 0, value: 20 },
            { time: 0, value: 100 },
          ],
        },
      },
    };
    expect(
      validateNativeParameterAnimation(definition, bad, validateValue),
    ).toEqual(
      expect.arrayContaining([
        "animation track speed key 1 time must increase within duration",
        "animation track speed must end at duration",
      ]),
    );
  });

  it("keeps feedback seeds and reset controls out of animation tracks", () => {
    const feedback = TEMPORAL_IMAGE_DEFINITIONS[0];
    const withSeparateReset = {
      ...feedback,
      feedback: {
        ...feedback.feedback!,
        resetProperties: ["hold"],
      },
    };
    expect(nativeParameterCanAnimate(withSeparateReset, "patternSeed")).toBe(
      false,
    );
    expect(nativeParameterCanAnimate(withSeparateReset, "hold")).toBe(false);
    expect(nativeParameterCanAnimate(withSeparateReset, "threshold")).toBe(
      true,
    );
    const makeAnimationTrack = (name: string) => ({
      duration: 2,
      loop: false,
      tracks: {
        [name]: {
          keys: [
            { time: 0, value: 0 },
            { time: 2, value: 1 },
          ],
        },
      },
    });
    expect(
      validateNativeParameterAnimation(
        withSeparateReset,
        makeAnimationTrack("patternSeed"),
        validateValue,
      ),
    ).toContain("animation track patternSeed is not animatable");
    expect(
      validateNativeParameterAnimation(
        withSeparateReset,
        makeAnimationTrack("hold"),
        validateValue,
      ),
    ).toContain("animation track hold is not animatable");
    expect(
      validateNativeParameterAnimation(
        withSeparateReset,
        makeAnimationTrack("threshold"),
        validateValue,
      ),
    ).toEqual([]);
  });
});
