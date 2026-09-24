/**
 * motion-easing.spec.ts
 *
 * Tests for the Figma-Motion-parity easing engine: the curve preset catalog,
 * the spring(bounce[, settle]) token model, the damped-oscillator sampler,
 * spring → CSS linear() compilation, and linear() evaluation.
 */

import { describe, expect, it } from "vitest";

import {
  MOTION_CURVE_PRESETS,
  MOTION_SPRING_DEFAULT_BOUNCE,
  MOTION_SPRING_PRESETS,
  evaluateCssLinear,
  motionEaseToCss,
  parseCssLinearStops,
  parseSpringToken,
  sampleSpring,
  springToCssLinear,
  springToken,
} from "./motion-easing";

// ─── Curve presets ────────────────────────────────────────────────────────────

describe("MOTION_CURVE_PRESETS", () => {
  it("lists Figma Motion's Curve tab presets verbatim, in order", () => {
    expect(MOTION_CURVE_PRESETS.map((p) => p.label)).toEqual([
      "Hold",
      "Linear",
      "Ease in",
      "Ease out",
      "Ease in and out",
      "Ease in back",
      "Ease out back",
      "Ease in and out back",
    ]);
  });

  it("uses the live-verified Ease in and out bezier (.42, 0, .58, 1)", () => {
    const preset = MOTION_CURVE_PRESETS.find(
      (p) => p.label === "Ease in and out",
    );
    expect(preset?.value).toBe("cubic-bezier(0.42, 0, 0.58, 1)");
  });

  it("maps Hold to a step that jumps immediately to the final value", () => {
    const preset = MOTION_CURVE_PRESETS.find((p) => p.label === "Hold");
    expect(preset?.value).toBe("step-start");
  });

  it("gives the back curves overshoot control points (y outside [0, 1])", () => {
    for (const label of [
      "Ease in back",
      "Ease out back",
      "Ease in and out back",
    ]) {
      const preset = MOTION_CURVE_PRESETS.find((p) => p.label === label)!;
      const m = /^cubic-bezier\(([^)]+)\)$/.exec(preset.value);
      expect(m).not.toBeNull();
      const [, y1, , y2] = m![1].split(",").map((n) => parseFloat(n));
      expect(y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1).toBe(true);
    }
  });
});

// ─── Spring token round-trip ──────────────────────────────────────────────────

describe("spring token", () => {
  it("serialises and parses spring(bounce) round-trip", () => {
    const token = springToken({ bounce: 0.69, settle: 1 });
    expect(token).toBe("spring(0.69)");
    expect(parseSpringToken(token)).toEqual({ bounce: 0.69, settle: 1 });
  });

  it("serialises and parses spring(bounce, settle) round-trip", () => {
    const token = springToken({ bounce: 0.2, settle: 0.5 });
    expect(token).toBe("spring(0.2, 0.5)");
    expect(parseSpringToken(token)).toEqual({ bounce: 0.2, settle: 0.5 });
  });

  it("maps the bare `spring` keyword to the default custom spring", () => {
    expect(parseSpringToken("spring")).toEqual({
      bounce: MOTION_SPRING_DEFAULT_BOUNCE,
      settle: 1,
    });
  });

  it("returns null for non-spring strings", () => {
    for (const raw of [
      "linear",
      "cubic-bezier(0.4, 0, 0.2, 1)",
      "springy(0.5)",
      "spring(oops)",
      "",
    ]) {
      expect(parseSpringToken(raw)).toBeNull();
    }
  });

  it("clamps bounce to [0, 1] and settle to [0.05, 1]", () => {
    expect(parseSpringToken("spring(2)")).toEqual({ bounce: 1, settle: 1 });
    expect(parseSpringToken("spring(0.5, 0.001)")?.settle).toBe(0.05);
  });
});

// ─── Spring presets ───────────────────────────────────────────────────────────

describe("MOTION_SPRING_PRESETS", () => {
  it("lists Figma Motion's Spring tab presets verbatim, in order", () => {
    expect(MOTION_SPRING_PRESETS.map((p) => p.label)).toEqual([
      "Gentle",
      "Quick",
      "Bouncy",
      "Slow",
    ]);
  });

  it("uses the live-verified Bouncy bounce of 0.69", () => {
    const bouncy = MOTION_SPRING_PRESETS.find((p) => p.label === "Bouncy");
    expect(bouncy?.spring.bounce).toBe(0.69);
  });

  it("defaults Custom spring bounce to 0.25 (Figma default)", () => {
    expect(MOTION_SPRING_DEFAULT_BOUNCE).toBe(0.25);
  });

  it("every preset value parses back to its own params", () => {
    for (const preset of MOTION_SPRING_PRESETS) {
      expect(parseSpringToken(preset.value)).toEqual(preset.spring);
    }
  });
});

// ─── Spring sampler ───────────────────────────────────────────────────────────

describe("sampleSpring", () => {
  it("starts at 0 and settles at exactly 1", () => {
    for (const preset of MOTION_SPRING_PRESETS) {
      expect(sampleSpring(preset.spring, 0)).toBe(0);
      expect(sampleSpring(preset.spring, 1)).toBe(1);
      expect(sampleSpring(preset.spring, 2)).toBe(1);
    }
  });

  it("never overshoots for bounce 0 (critically damped)", () => {
    for (let i = 0; i <= 50; i++) {
      const y = sampleSpring({ bounce: 0, settle: 1 }, i / 50);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1.0001);
    }
  });

  it("overshoots past 1 for a bouncy spring (bounce 0.69)", () => {
    let max = 0;
    for (let i = 0; i <= 200; i++) {
      max = Math.max(max, sampleSpring({ bounce: 0.69, settle: 1 }, i / 200));
    }
    expect(max).toBeGreaterThan(1.1);
  });

  it("bouncier springs oscillate more (more crossings of 1)", () => {
    const crossings = (bounce: number): number => {
      let count = 0;
      let prev = sampleSpring({ bounce, settle: 1 }, 0) - 1;
      for (let i = 1; i <= 400; i++) {
        const cur = sampleSpring({ bounce, settle: 1 }, i / 400) - 1;
        if ((prev < 0 && cur >= 0) || (prev > 0 && cur <= 0)) count++;
        prev = cur;
      }
      return count;
    };
    expect(crossings(0.69)).toBeGreaterThan(crossings(0.2));
  });

  it("is at rest by the settle fraction", () => {
    const spring = { bounce: 0.3, settle: 0.5 };
    for (const x of [0.5, 0.6, 0.8, 1]) {
      expect(sampleSpring(spring, x)).toBe(1);
    }
    // Still moving just before the settle point.
    expect(sampleSpring(spring, 0.05)).toBeLessThan(1);
  });
});

// ─── Spring → CSS linear() ────────────────────────────────────────────────────

describe("springToCssLinear", () => {
  it("emits a deterministic linear(...) stop list from 0 to 1", () => {
    const css = springToCssLinear({ bounce: 0.69, settle: 1 });
    expect(css).toMatch(/^linear\(0, /);
    expect(css).toMatch(/, 1\)$/);
    expect(springToCssLinear({ bounce: 0.69, settle: 1 })).toBe(css);
  });

  it("contains overshoot stops (> 1) for bouncy springs", () => {
    const css = springToCssLinear({ bounce: 0.69, settle: 1 });
    const stops = css
      .slice("linear(".length, -1)
      .split(",")
      .map((s) => parseFloat(s));
    expect(Math.max(...stops)).toBeGreaterThan(1.05);
  });

  it("gives bouncier springs more stops for fidelity", () => {
    const count = (bounce: number) =>
      springToCssLinear({ bounce, settle: 1 }).split(",").length;
    expect(count(0.9)).toBeGreaterThan(count(0));
  });

  it("is CSS-token safe (no braces, semicolons, or url())", () => {
    const css = springToCssLinear({ bounce: 1, settle: 0.5 });
    expect(css).not.toMatch(/[;{}<>]|url\(/i);
  });
});

describe("motionEaseToCss", () => {
  it("compiles spring tokens to linear() and passes everything else through", () => {
    expect(motionEaseToCss("spring(0.69)")).toMatch(/^linear\(/);
    for (const ease of [
      "linear",
      "ease-in-out",
      "step-start",
      "cubic-bezier(0.42, 0, 0.58, 1)",
      "steps(4, end)",
      "linear(0, 0.5, 1)",
    ]) {
      expect(motionEaseToCss(ease)).toBe(ease);
    }
  });

  it("round-trips: evaluating the compiled linear() matches the spring", () => {
    const spring = { bounce: 0.69, settle: 1 };
    const css = springToCssLinear(spring);
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const viaLinear = evaluateCssLinear(css, x)!;
      const direct = sampleSpring(spring, x);
      // Piecewise-linear approximation: allow a small tolerance.
      expect(Math.abs(viaLinear - direct)).toBeLessThan(0.08);
    }
  });
});

// ─── linear() evaluation ──────────────────────────────────────────────────────

describe("evaluateCssLinear / parseCssLinearStops", () => {
  it("evaluates evenly distributed stops without percentages", () => {
    expect(evaluateCssLinear("linear(0, 0.5, 1)", 0.25)).toBeCloseTo(0.25, 6);
    expect(evaluateCssLinear("linear(0, 1)", 0.4)).toBeCloseTo(0.4, 6);
    expect(evaluateCssLinear("linear(0, 0.8, 1)", 0.5)).toBeCloseTo(0.8, 6);
  });

  it("honours explicit stop percentages", () => {
    expect(evaluateCssLinear("linear(0 0%, 1 100%)", 0.3)).toBeCloseTo(0.3, 6);
    expect(evaluateCssLinear("linear(0, 0.9 20%, 1)", 0.2)).toBeCloseTo(0.9, 6);
  });

  it("supports two-percentage stops (flat plateau)", () => {
    const css = "linear(0, 1 40% 60%, 1)";
    expect(evaluateCssLinear(css, 0.5)).toBeCloseTo(1, 6);
  });

  it("pins the endpoints", () => {
    expect(evaluateCssLinear("linear(0, 1.2, 1)", 0)).toBe(0);
    expect(evaluateCssLinear("linear(0, 1.2, 1)", 1)).toBe(1);
  });

  it("returns null for non-linear() strings", () => {
    for (const raw of ["linear", "cubic-bezier(0,0,1,1)", "linear()"]) {
      expect(evaluateCssLinear(raw, 0.5)).toBeNull();
    }
    expect(parseCssLinearStops("steps(4)")).toBeNull();
  });
});
