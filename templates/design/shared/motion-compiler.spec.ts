/**
 * motion-compiler.spec.ts
 *
 * Regression tests for the motion compiler and its CSS validation guards.
 *
 * Issue 1 regression: track.property was not validated, allowing CSS injection.
 * The assertSafeMotionCssProperty helper must reject any property string that
 * could break out of a CSS declaration or <style> block context.
 */

import { describe, expect, it } from "vitest";

import {
  assertSafeMotionCssProperty,
  assertSafeMotionCssToken,
  compile,
  extractManagedMotionCss,
  injectManagedMotionCss,
  parse,
  parseFirstAnimationDurationMs,
} from "./motion-compiler";
import type { MotionTimeline } from "./motion-timeline";

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeTimeline(property: string): MotionTimeline {
  return {
    id: "t1",
    designId: "d1",
    sourceRef: null,
    filePath: null,
    tracks: [
      {
        targetNodeId: "node1",
        property,
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ],
    durationMs: 300,
    defaultEase: "ease",
    compiledHash: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

// ─── Property validation (Issue 1 regression) ────────────────────────────────

describe("assertSafeCssProperty — allowlist validation", () => {
  it("accepts standard animatable CSS properties", () => {
    const valid = [
      "opacity",
      "transform",
      "color",
      "background-color",
      "font-size",
      "width",
      "height",
      "top",
      "left",
      "margin-top",
      "border-radius",
      "letter-spacing",
      "line-height",
    ];
    for (const prop of valid) {
      expect(() =>
        assertSafeMotionCssProperty(prop, "track.property"),
      ).not.toThrow();
    }
  });

  it("accepts vendor-prefixed properties (leading hyphen)", () => {
    expect(() =>
      assertSafeMotionCssProperty("-webkit-transform", "track.property"),
    ).not.toThrow();
    expect(() =>
      assertSafeMotionCssProperty("-moz-transform", "track.property"),
    ).not.toThrow();
  });

  it("REJECTS injection payload containing colon (CSS declaration breakout)", () => {
    // Before the fix, this would compile as:
    //   color:red} body{display:none: <value>;
    // breaking out of the @keyframes block.
    expect(() =>
      assertSafeMotionCssProperty(
        "color:red} body{display:none",
        "track.property",
      ),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing semicolon", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity;color", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing opening brace", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity{color:red}", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing closing brace", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity}body{color:red", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing whitespace", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity color", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing angle bracket (style-tag breakout)", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity</style><script>", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing slash", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity/color", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS empty string", () => {
    expect(() => assertSafeMotionCssProperty("", "track.property")).toThrow(
      /not a valid CSS property identifier/,
    );
  });

  it("REJECTS property starting with digit", () => {
    expect(() =>
      assertSafeMotionCssProperty("1opacity", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });
});

// ─── Value/easing validation ─────────────────────────────────────────────────

describe("assertSafeMotionCssToken — CSS injection validation", () => {
  it("accepts common motion values and easing functions", () => {
    for (const value of [
      "0",
      "1",
      "translateY(8px)",
      "scale(1.05)",
      "calc(100% - 8px)",
      "var(--motion-distance)",
      "cubic-bezier(0.4, 0, 0.2, 1)",
      "steps(4, end)",
    ]) {
      expect(() =>
        assertSafeMotionCssToken(value, "motion value"),
      ).not.toThrow();
    }
  });

  it("rejects declaration, rule, comment, URL, and style breakouts", () => {
    for (const value of [
      "0; body { display: none }",
      "0 } body { display: none",
      "/* hidden */ 0",
      "0 */ body { display: none",
      "url(javascript:alert(1))",
      "url (https://example.test/a.png)",
      "</style><script>alert(1)</script>",
    ]) {
      expect(() => assertSafeMotionCssToken(value, "motion value")).toThrow(
        /not allowed in motion CSS values/,
      );
    }
  });
});

// ─── Compiler output does not contain injected payload ───────────────────────

describe("compile — property is emitted safely", () => {
  it("emits the property name verbatim for valid identifiers", () => {
    const { css } = compile(makeTimeline("opacity"));
    expect(css).toContain("opacity:");
  });

  it("emits exactly one @keyframes block for a single-track timeline", () => {
    const { css } = compile(makeTimeline("transform"));
    // Valid CSS: exactly one @keyframes block and one element rule block.
    const kfMatches = css.match(/@keyframes/g);
    expect(kfMatches).toHaveLength(1);
  });

  it("compile is deterministic — same input produces identical hash", () => {
    const timeline = makeTimeline("opacity");
    const r1 = compile(timeline);
    const r2 = compile(timeline);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.css).toBe(r2.css);
  });

  it("compile includes reduced-motion block", () => {
    const { css } = compile(makeTimeline("opacity"));
    expect(css).toContain("prefers-reduced-motion");
  });

  it("coalesces same-target tracks into one comma-separated animation rule", () => {
    const timeline = makeTimeline("opacity");
    timeline.durationMs = 1000;
    timeline.tracks = [
      {
        targetNodeId: "node1",
        property: "transform",
        keyframes: [
          { t: 0, value: "translateY(8px)", ease: "ease-out" },
          { t: 1, value: "translateY(0)" },
        ],
      },
      {
        targetNodeId: "node1",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ];

    const { css } = compile(timeline);
    // Count element rules outside the reduced-motion media query (which now
    // also selects animated nodes by id).
    const beforeMedia = css.slice(0, css.indexOf("@media"));
    const ruleMatches = beforeMedia.match(
      /\[data-agent-native-node-id="node1"\]\s*\{/g,
    );

    expect(ruleMatches).toHaveLength(1);
    expect(css).toContain(
      "animation-name: an-motion-node1--opacity, an-motion-node1--transform;",
    );
    expect(css).toContain("animation-duration: 1s, 1s;");
    expect(css).toContain("animation-timing-function: ease, ease-out;");
    expect(css).toContain("animation-fill-mode: both, both;");
  });

  it("rejects unsafe keyframe values and easing while compiling", () => {
    const unsafeValue = makeTimeline("opacity");
    unsafeValue.tracks[0].keyframes[0].value = "0; body { display: none }";

    expect(() => compile(unsafeValue)).toThrow(/Invalid keyframe value/);

    const unsafeEase = makeTimeline("opacity");
    unsafeEase.tracks[0].keyframes[0].ease = "ease /* inject */";

    expect(() => compile(unsafeEase)).toThrow(/Invalid keyframe ease/);

    const unsafeDefaultEase = makeTimeline("opacity");
    unsafeDefaultEase.defaultEase = "url(javascript:alert(1))";

    expect(() => compile(unsafeDefaultEase)).toThrow(/Invalid defaultEase/);
  });
});

describe("parse — managed style fallback", () => {
  it("injects and replaces the managed style block with tolerant close tags", () => {
    const first = injectManagedMotionCss(
      "<html><head></head><body><button>Hi</button></body></html>",
      ".one { opacity: 1; }",
    );

    expect(first).toContain(
      "<style data-agent-native-motion>\n.one { opacity: 1; }\n</style>",
    );
    expect(first.indexOf("<style data-agent-native-motion>")).toBeLessThan(
      first.indexOf("</head>"),
    );

    const replaced = injectManagedMotionCss(
      first.replace("</style>", "</STYLE >"),
      ".two { opacity: 0; }",
    );

    expect(replaced).toContain(".two { opacity: 0; }");
    expect(replaced).not.toContain(".one { opacity: 1; }");
    expect(
      replaced.match(/<style data-agent-native-motion>/g) ?? [],
    ).toHaveLength(1);
  });

  it("recovers editable tracks from a managed motion style block", () => {
    const timeline = makeTimeline("opacity");
    timeline.tracks[0].targetNodeId = "alpha-button";
    timeline.tracks[0].keyframes = [
      { t: 0, value: "0", ease: "ease-out" },
      { t: 1, value: "1" },
    ];

    const { css } = compile(timeline);
    const managedCss = extractManagedMotionCss(
      `<html><head><style data-agent-native-motion>\n${css}\n</style></head></html>`,
    );

    expect(managedCss).toBe(css);
    expect(parse(managedCss ?? "")).toEqual([
      {
        targetNodeId: "alpha-button",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0", ease: "ease-out" },
          { t: 1, value: "1", ease: "ease" },
        ],
      },
    ]);
  });

  it("uses the exact selector node id when animation names are sanitized", () => {
    const timeline = makeTimeline("transform");
    timeline.tracks[0].targetNodeId = "hero:button";
    timeline.tracks[0].keyframes = [
      { t: 0, value: "translateY(16px)" },
      { t: 1, value: "translateY(0px)" },
    ];

    const { css } = compile(timeline);

    // Sanitised names carry a short hash of the raw id to avoid collisions.
    expect(css).toMatch(
      /@keyframes an-motion-hero_button_[a-z0-9]+--transform/,
    );
    expect(parse(css)[0]).toMatchObject({
      targetNodeId: "hero:button",
      property: "transform",
    });
  });

  it("sanitised node ids that collide after cleanup get distinct animation names", () => {
    const timeline = makeTimeline("opacity");
    timeline.tracks = [
      {
        targetNodeId: "a:b",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
      {
        targetNodeId: "a_b",
        property: "opacity",
        keyframes: [
          { t: 0, value: "1" },
          { t: 1, value: "0" },
        ],
      },
    ];

    const { css } = compile(timeline);
    const names = [...css.matchAll(/@keyframes\s+(\S+)/g)].map((m) => m[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);

    // Both tracks recover with their exact raw node ids.
    const recovered = parse(css);
    expect(recovered.map((track) => track.targetNodeId).sort()).toEqual([
      "a:b",
      "a_b",
    ]);
  });
});

// ─── Keyframe stop formatting + ordering ─────────────────────────────────────

describe("compile — keyframe stop edge cases", () => {
  it("keeps a near-100% stop distinct from a real 100% stop", () => {
    const timeline = makeTimeline("opacity");
    timeline.tracks[0].keyframes = [
      { t: 0, value: "0" },
      { t: 0.99997, value: "0.5" },
      { t: 1, value: "1" },
    ];

    const { css } = compile(timeline);
    // The interior stop must not round onto the 100% selector (duplicate
    // selectors silently drop one of the two values).
    expect(css).toContain("99.99% {");
    expect(css.match(/100% \{/g)).toHaveLength(1);
  });

  it("keeps a near-0% stop distinct from a real 0% stop", () => {
    const timeline = makeTimeline("opacity");
    timeline.tracks[0].keyframes = [
      { t: 0, value: "0" },
      { t: 0.00003, value: "0.5" },
      { t: 1, value: "1" },
    ];

    const { css } = compile(timeline);
    expect(css).toContain("0.01% {");
    expect(css.match(/(^|\s)0% \{/g)).toHaveLength(1);
  });

  it("sorts unsorted keyframes and reads the element-rule ease from the first sorted stop", () => {
    const timeline = makeTimeline("opacity");
    // Deliberately out of order: the t=0 stop (ease-out) is listed last.
    timeline.tracks[0].keyframes = [
      { t: 1, value: "1", ease: "linear" },
      { t: 0.5, value: "0.5", ease: "ease-in" },
      { t: 0, value: "0", ease: "ease-out" },
    ];

    const { css } = compile(timeline);
    // Stops emitted in time order.
    const stopOrder = [...css.matchAll(/(\d+(?:\.\d+)?)% \{/g)].map((m) =>
      parseFloat(m[1]),
    );
    expect(stopOrder).toEqual([0, 50, 100]);
    // Element rule ease comes from the SORTED first keyframe (t=0 → ease-out),
    // not from whatever happened to be first in array order.
    expect(css).toContain("animation-timing-function: ease-out;");
  });
});

// ─── Reduced motion scoping ──────────────────────────────────────────────────

describe("compile — reduced-motion block scoping", () => {
  it("targets only the animated node ids, not every stamped node", () => {
    const { css } = compile(makeTimeline("opacity"));
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"));
    expect(reduced).toContain('[data-agent-native-node-id="node1"]');
    // No blanket selector that would disable animations on unrelated nodes,
    // and no dead [style*=…] selectors.
    expect(reduced).not.toMatch(/\[data-agent-native-node-id\]/);
    expect(reduced).not.toContain('[style*="');
  });
});

// ─── Duration recovery ───────────────────────────────────────────────────────

describe("parseFirstAnimationDurationMs", () => {
  it("recovers the compiled duration from managed CSS", () => {
    const timeline = makeTimeline("opacity");
    timeline.durationMs = 750;
    const { css } = compile(timeline);
    expect(parseFirstAnimationDurationMs(css)).toBe(750);
  });

  it("parses seconds and milliseconds units", () => {
    expect(
      parseFirstAnimationDurationMs("a { animation-duration: 1.5s; }"),
    ).toBe(1500);
    expect(
      parseFirstAnimationDurationMs("a { animation-duration: 300ms; }"),
    ).toBe(300);
    expect(
      parseFirstAnimationDurationMs("a { animation-duration: 2s, 1s; }"),
    ).toBe(2000);
  });

  it("returns null when absent or unparsable", () => {
    expect(parseFirstAnimationDurationMs("a { opacity: 1; }")).toBeNull();
    expect(
      parseFirstAnimationDurationMs("a { animation-duration: fast; }"),
    ).toBeNull();
    expect(
      parseFirstAnimationDurationMs("a { animation-duration: 0s; }"),
    ).toBeNull();
  });
});
