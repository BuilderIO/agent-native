import { describe, expect, it } from "vitest";

import {
  assertMotionNativeStyleInstance,
  MOTION_NATIVE_STYLE_PROPS_MAX_BYTES,
  MotionNativeStyleInstanceError,
} from "./motion-native-style";
import type { MotionNativeStyleInstance } from "./motion-native-style";

const instance: MotionNativeStyleInstance = {
  type: "FIGMA",
  styleKey: "TextStagger",
  sourceStyleId: ' style/\"雪 ',
  sourceInstanceId: "12:34",
  nameKey: "motion.styles.textStagger",
  duration: 0.48,
  timelineOffset: 1.2,
  targetNodeId: "23:4",
  props: {
    futureProperty: {
      range: [0, 1],
      options: { delimiter: "*/", enabled: true },
    },
    easing: "spring(0.3)",
  },
};

describe("native Figma Motion style instances", () => {
  it("round-trips the native discriminator, raw IDs, timing, target, and unknown props", () => {
    const json = JSON.stringify(instance);
    const parsed: unknown = JSON.parse(json);

    expect(() => assertMotionNativeStyleInstance(parsed)).not.toThrow();
    expect(parsed).toEqual(instance);
  });

  it("rejects a local or unsupported style discriminator without coercion", () => {
    expectCode({ ...instance, type: "local" }, "invalid-type");
    expectCode({ ...instance, styleKey: "Translate" }, "invalid-style-key");
    expectCode({ ...instance, duration: "0.48" }, "invalid-field");
    expectCode(
      { ...instance, timelineOffset: Number.POSITIVE_INFINITY },
      "invalid-field",
    );
  });

  it("rejects malformed JSON props instead of dropping values or invoking accessors", () => {
    expectCode(
      { ...instance, props: { ...instance.props, lost: undefined } },
      "invalid-props",
    );
    expectCode(
      { ...instance, props: { ...instance.props, lost: () => "value" } },
      "invalid-props",
    );

    let getterCalled = false;
    const props = {};
    Object.defineProperty(props, "futureProperty", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "value";
      },
    });
    expectCode({ ...instance, props }, "invalid-props");
    expect(getterCalled).toBe(false);
  });

  it("rejects over-deep and oversized props with explicit limit errors", () => {
    let nested: unknown = "end";
    for (let index = 0; index <= 16; index += 1) {
      nested = { next: nested };
    }
    expectCode({ ...instance, props: { nested } }, "props-too-deep");

    expectCode(
      {
        ...instance,
        props: { payload: "x".repeat(MOTION_NATIVE_STYLE_PROPS_MAX_BYTES) },
      },
      "props-too-large",
    );
  });

  it("rejects unknown top-level fields rather than silently dropping them", () => {
    expectCode({ ...instance, legacyType: "FIGMA" }, "invalid-shape");
  });
});

function expectCode(
  value: unknown,
  code: MotionNativeStyleInstanceError["code"],
) {
  try {
    assertMotionNativeStyleInstance(value);
  } catch (error) {
    expect(error).toBeInstanceOf(MotionNativeStyleInstanceError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected native style validation to fail with ${code}.`);
}
