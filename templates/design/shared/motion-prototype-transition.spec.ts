import { describe, expect, it } from "vitest";

import {
  decodeMotionPrototypeTransitionAttribute,
  encodeMotionPrototypeTransitionAttribute,
  MOTION_PROTOTYPE_TRANSITION_ATTRIBUTE,
  validateMotionPrototypeNavigationTransition,
} from "./motion-prototype-transition";
import type { MotionPrototypeNavigationTransition } from "./motion-prototype-transition";

const instant: MotionPrototypeNavigationTransition = {
  version: 1,
  trigger: "click",
  action: "navigate",
  transition: "instant",
};
const timing = {
  durationMs: 500,
  ease: { kind: "preset", preset: "ease-out" } as const,
};

describe("prototype navigation transition source model", () => {
  it("names a source attribute and keeps the observed immediate default explicit", () => {
    expect(MOTION_PROTOTYPE_TRANSITION_ATTRIBUTE).toBe(
      "data-an-prototype-transition",
    );
    expect(encodeMotionPrototypeTransitionAttribute(instant)).toBe(
      JSON.stringify(instant),
    );
  });

  it("distinguishes absent source from malformed and non-string attributes", () => {
    expect(decodeMotionPrototypeTransitionAttribute(undefined)).toEqual({
      status: "absent",
    });
    expect(decodeMotionPrototypeTransitionAttribute(null)).toEqual({
      status: "absent",
    });
    expect(decodeMotionPrototypeTransitionAttribute("{")).toMatchObject({
      status: "invalid",
      error: { code: "malformed-json" },
    });
    expect(decodeMotionPrototypeTransitionAttribute(42)).toMatchObject({
      status: "invalid",
      error: { code: "not-a-string" },
    });
  });

  it("rejects unknown fields and versions instead of silently normalizing them", () => {
    expect(
      decodeMotionPrototypeTransitionAttribute(
        JSON.stringify({ ...instant, futureField: true }),
      ),
    ).toMatchObject({
      status: "invalid",
      error: { code: "invalid-document", path: "transition.futureField" },
    });
    expect(
      decodeMotionPrototypeTransitionAttribute(
        JSON.stringify({ ...instant, version: 2 }),
      ),
    ).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-version" },
    });
  });

  it.each(["dissolve", "smart-animate"] as const)(
    "round-trips explicit %s timing",
    (transition) => {
      const value = { ...instant, transition, ...timing };
      expect(
        decodeMotionPrototypeTransitionAttribute(
          encodeMotionPrototypeTransitionAttribute(value),
        ),
      ).toEqual({ status: "valid", transition: value });
    },
  );

  it.each(["move-in", "move-out", "push", "slide-in", "slide-out"] as const)(
    "round-trips the %s direction and custom easing",
    (transition) => {
      const value: MotionPrototypeNavigationTransition = {
        ...instant,
        ...timing,
        transition,
        direction: "right",
        ease: {
          kind: "custom-bezier",
          x1: 0.2,
          y1: 1.4,
          x2: 0.8,
          y2: 1,
        },
      };
      const encoded = encodeMotionPrototypeTransitionAttribute(value);
      expect(decodeMotionPrototypeTransitionAttribute(encoded)).toEqual({
        status: "valid",
        transition: value,
      });
    },
  );

  it("does not invent timing for a non-instant transition", () => {
    for (const value of [
      { ...instant, transition: "dissolve" },
      { ...instant, transition: "dissolve", durationMs: 300 },
    ]) {
      expect(validateMotionPrototypeNavigationTransition(value)).toMatchObject({
        valid: false,
        error: { code: "invalid-value" },
      });
    }
  });

  it.each([
    [{ ...instant, trigger: "hover" }, "transition.trigger"],
    [{ ...instant, action: "open" }, "transition.action"],
    [{ ...instant, transition: "fade" }, "transition.transition"],
    [{ ...instant, durationMs: 0 }, "transition.durationMs"],
    [{ ...instant, transition: "push", ...timing }, "transition.direction"],
    [
      { ...instant, transition: "dissolve", ...timing, direction: "left" },
      "transition.direction",
    ],
    [
      {
        ...instant,
        transition: "dissolve",
        durationMs: 300,
        ease: { kind: "custom-bezier", x1: -0.1, y1: 0, x2: 1, y2: 1 },
      },
      "ease.x1",
    ],
  ])("rejects invalid values at %s", (value, path) => {
    expect(validateMotionPrototypeNavigationTransition(value)).toMatchObject({
      valid: false,
      error: { path },
    });
  });
});
