import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These tests exercise the REAL motion-preview bridge script that
 * `DesignCanvas.tsx` injects into the design iframe. Rather than copy the
 * interpolation logic (which would drift), we import the compiled bridge
 * string from the generated module, strip the IIFE wrapper, and pull out
 * `lerp` / `interpolate` so we can assert the live-scrub preview produces
 * smoothly interpolated values instead of snapping at the midpoint.
 *
 * Source: app/components/design/bridge/motion-preview.bridge.ts
 * Compiled: .generated/bridge/motion-preview.generated.ts
 */
function loadBridge(): {
  lerp: (a: string, b: string, ratio: number) => string;
  interpolate: (
    keyframes: Array<{ t: number; value: string; ease?: string }>,
    t: number,
  ) => string;
  parseColor: (value: string) => number[] | null;
  evalEase: (ease: string | undefined, x: number) => number;
} {
  // Import the compiled bridge string from the generated module. Using
  // require() so the import is synchronous and the function can be called
  // at module evaluation time (loadBridge() is called at top level).
  const generatedPath = fileURLToPath(
    new URL(
      "../../../.generated/bridge/motion-preview.generated.ts",
      import.meta.url,
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { motionPreviewBridgeScript } = require(generatedPath) as {
    motionPreviewBridgeScript: string;
  };

  // The generated string is the compiled IIFE JS (no <script> tags).
  // esbuild wraps the source IIFE in an outer arrow-IIFE:
  //   "use strict";\n(() => {\n  // source-file-comment\n  (function() {\n    ...\n  })();\n})();\n
  // Strip both wrappers so only the function body is left, then pull out
  // lerp / interpolate / parseColor by appending a return statement.
  let body = motionPreviewBridgeScript;
  // Remove leading "use strict"; and outer (() => { ... })() opening
  body = body.replace(/^["']use strict["'];\s*\(\(\)\s*=>\s*\{/, "");
  // Remove outer IIFE closing
  body = body.replace(/\}\)\(\);\s*$/, "");
  // Remove source-location comment (// app/components/design/bridge/...)
  body = body.replace(/^\s*\/\/[^\n]*\n/, "");
  // Remove inner (function() { ... })() opening
  body = body.replace(/^\s*\(function\s*\(\s*\)\s*\{/, "");
  // Remove inner IIFE closing
  body = body.replace(/\}\)\(\);\s*$/, "");

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "window",
    "document",
    body + "\n; return { lerp, interpolate, parseColor, evalEase };",
  );
  return factory({ addEventListener() {} }, { querySelector: () => null });
}

const bridge = loadBridge();
// Value-interpolation tests pin ease to "linear" so they assert exact
// midpoints; easing behavior itself is covered separately below. Keyframes
// without an ease fall back to the CSS "ease" curve (the compiled
// stylesheet's defaultEase default), not linear.
const at = (from: string, to: string, t: number, ease = "linear") =>
  bridge.interpolate(
    [
      { t: 0, value: from, ease },
      { t: 1, value: to, ease },
    ],
    t,
  );

describe("motion-preview bridge interpolation", () => {
  it("interpolates plain numbers with units (opacity / translateY px)", () => {
    expect(at("0", "1", 0.5)).toBe("0.5");
    expect(at("0", "1", 0.25)).toBe("0.25");
    expect(at("translateY(16px)", "translateY(0px)", 0.5)).toBe(
      "translateY(8px)",
    );
    expect(at("translateY(16px)", "translateY(0px)", 0.25)).toBe(
      "translateY(12px)",
    );
  });

  it("interpolates scale() and blur() function values instead of snapping", () => {
    expect(at("scale(0.8)", "scale(1)", 0.5)).toBe("scale(0.9)");
    expect(at("blur(8px)", "blur(0px)", 0.5)).toBe("blur(4px)");
    expect(at("blur(8px)", "blur(0px)", 0.25)).toBe("blur(6px)");
  });

  it("interpolates compound transforms component-wise", () => {
    expect(
      at("translateY(20px) scale(0.5)", "translateY(0px) scale(1)", 0.5),
    ).toBe("translateY(10px) scale(0.75)");
  });

  it("interpolates hex colors through rgb (color / background-color)", () => {
    // #000000 -> #ffffff at 0.5 is mid-grey.
    expect(at("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    // #ff0000 -> #0000ff at 0.5.
    expect(at("#ff0000", "#0000ff", 0.5)).toBe("rgb(128, 0, 128)");
  });

  it("interpolates rgb()/rgba() and hsl() colors", () => {
    expect(at("rgb(0, 0, 0)", "rgb(100, 200, 50)", 0.5)).toBe(
      "rgb(50, 100, 25)",
    );
    expect(at("rgba(0,0,0,0)", "rgba(0,0,0,1)", 0.5)).toBe(
      "rgba(0, 0, 0, 0.5)",
    );
    // hsl red -> hsl(120 ...) green-ish; just assert it produced an rgb mix.
    expect(at("hsl(0, 100%, 50%)", "hsl(120, 100%, 50%)", 0)).toBe(
      "rgb(255, 0, 0)",
    );
  });

  it("snaps only for non-interpolable keyword values", () => {
    expect(at("none", "block", 0.4)).toBe("none");
    expect(at("none", "block", 0.6)).toBe("block");
  });

  it("never snaps mid-scrub for the shipped presets", () => {
    const presets: Array<[string, string]> = [
      ["0", "1"],
      ["translateY(16px)", "translateY(0px)"],
      ["scale(0.8)", "scale(1)"],
      ["blur(8px)", "blur(0px)"],
      ["#000000", "#3366ff"],
      ["#ffffff", "#101820"],
    ];
    for (const [from, to] of presets) {
      const mid = at(from, to, 0.5);
      // A correctly-interpolated midpoint must differ from at least one
      // endpoint (the old snap returned an endpoint verbatim).
      expect(mid === from && mid === to).toBe(false);
      if (from !== to) {
        expect(mid).not.toBe(from);
        expect(mid).not.toBe(to);
      }
    }
  });

  it("maps a `none` endpoint to the identity of the other endpoint", () => {
    // transform: none -> translateY(16px) lerps from translateY(0px)
    // instead of midpoint-snapping.
    expect(at("none", "translateY(16px)", 0.5)).toBe("translateY(8px)");
    expect(at("translateY(16px)", "none", 0.5)).toBe("translateY(8px)");
    expect(at("none", "blur(8px)", 0.5)).toBe("blur(4px)");
    expect(at("none", "translateY(20px) scale(0.5)", 0.5)).toBe(
      "translateY(10px) scale(0.75)",
    );
  });
});

describe("motion-preview bridge easing", () => {
  it("applies the CSS `ease` curve when a keyframe omits ease", () => {
    const eased = bridge.interpolate(
      [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
      0.5,
    );
    // ease(0.5) ≈ 0.8 — decisively NOT the linear midpoint.
    expect(parseFloat(eased)).toBeGreaterThan(0.7);
    expect(parseFloat(eased)).toBeLessThan(0.9);
  });

  it("evaluates keywords, cubic-bezier, and steps", () => {
    expect(bridge.evalEase("linear", 0.25)).toBeCloseTo(0.25, 6);
    expect(bridge.evalEase("ease-in", 0.25)).toBeLessThan(0.25);
    expect(bridge.evalEase("ease-out", 0.25)).toBeGreaterThan(0.25);
    expect(bridge.evalEase("ease-in-out", 0.5)).toBeCloseTo(0.5, 3);
    expect(bridge.evalEase("step-start", 0.01)).toBe(1);
    expect(bridge.evalEase("step-end", 0.99)).toBe(0);
    expect(bridge.evalEase("steps(4, end)", 0.3)).toBeCloseTo(0.25, 6);
    expect(bridge.evalEase("steps(4, start)", 0.3)).toBeCloseTo(0.5, 6);
    // Endpoints always pin for every supported form.
    for (const ease of [
      "linear",
      "ease",
      "ease-in-out",
      "cubic-bezier(0.4, 0, 0.2, 1)",
      "steps(3, end)",
      "spring",
    ]) {
      expect(bridge.evalEase(ease, 0)).toBe(0);
      expect(bridge.evalEase(ease, 1)).toBe(1);
    }
  });

  it("supports overshoot beziers (Spring preset) past 1", () => {
    const values = [0.5, 0.6, 0.7, 0.8].map((x) =>
      bridge.evalEase("cubic-bezier(0.34,1.56,0.64,1)", x),
    );
    expect(Math.max(...values)).toBeGreaterThan(1);
    // Overshoot flows through numeric interpolation (extrapolates past `to`).
    const mid = bridge.interpolate(
      [
        {
          t: 0,
          value: "translateY(100px)",
          ease: "cubic-bezier(0.34,1.56,0.64,1)",
        },
        { t: 1, value: "translateY(0px)", ease: "linear" },
      ],
      0.7,
    );
    const px = parseFloat(mid.replace("translateY(", ""));
    expect(px).toBeLessThan(0);
  });

  it("holds the from value across the interval for step-end easing", () => {
    const held = bridge.interpolate(
      [
        { t: 0, value: "0", ease: "step-end" },
        { t: 1, value: "1", ease: "linear" },
      ],
      0.9,
    );
    expect(held).toBe("0");
  });

  it("falls back to linear for unknown easing strings", () => {
    expect(bridge.evalEase("totally-unknown", 0.4)).toBeCloseTo(0.4, 6);
  });
});
