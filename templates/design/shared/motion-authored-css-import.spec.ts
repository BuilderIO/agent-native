import { describe, expect, it } from "vitest";

import {
  importAuthoredCssAnimations,
  removeAuthoredCssSourceRanges,
  type MotionAuthoredCssTargetResolver,
} from "./motion-authored-css-import";

const resolveHero: MotionAuthoredCssTargetResolver = (selector) =>
  selector === ".hero"
    ? { status: "resolved", targetNodeId: "node-hero" }
    : { status: "unresolved" };

describe("importAuthoredCssAnimations", () => {
  it("reports absent when the source has no animation declarations", () => {
    expect(
      importAuthoredCssAnimations(
        ".hero { color: red; }\n@keyframes unused { from { opacity: 0; } }",
        resolveHero,
      ),
    ).toEqual({
      status: "absent",
      definedKeyframeNames: ["unused"],
    });
  });

  it("does not treat a transition without an authored animation as Motion", () => {
    expect(
      importAuthoredCssAnimations(
        ".hero:hover { transition: opacity 2s ease; }",
        resolveHero,
      ),
    ).toEqual({ status: "absent", definedKeyframeNames: [] });
  });

  it("allows unrelated selector transitions beside an imported animation", () => {
    const css = `.button:hover { transition: all 1s; }
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "valid",
      tracks: [{ targetNodeId: "node-hero", property: "opacity" }],
    });
  });

  it.each([
    ["transition shorthand", ".hero:hover { transition: all 1s; }"],
    [
      "transition-property longhand",
      ".hero:hover { transition-property: all; transition-duration: 1s; }",
    ],
  ])("treats all as overlapping every Motion track in %s", (_label, rule) => {
    const css = `${rule}
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it.each(["ambiguous", "unsupported", "throws"] as const)(
    "fails closed when a transition selector resolution is %s",
    (failure) => {
      const css = `#hero:hover { transition: opacity 1s; }
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;
      const resolveTarget: MotionAuthoredCssTargetResolver = (selector) => {
        if (selector === ".hero") {
          return { status: "resolved", targetNodeId: "node-hero" };
        }
        if (failure === "throws") throw new Error("selector lookup failed");
        return failure === "ambiguous"
          ? { status: "ambiguous" }
          : { status: "unsupported", reason: "selector is not supported" };
      };

      expect(importAuthoredCssAnimations(css, resolveTarget)).toMatchObject({
        status: "unsupported",
        reason: expect.stringContaining("overlap a Motion target property"),
      });
    },
  );

  it("fails closed when a transition selector has no statically resolvable atoms", () => {
    const css = `:is(.hero, #hero):hover { transition: opacity 1s; }
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it("rejects a transition on the Motion target when it overlaps an imported track", () => {
    const css = `.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
.hero:hover { transition: opacity 1s ease; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it("allows a target transition when it does not overlap the imported track", () => {
    const css = `.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
.hero:hover { transition-property: color; transition-duration: 1s; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "valid",
      tracks: [{ targetNodeId: "node-hero", property: "opacity" }],
    });
  });

  it("respects a later transition-property override", () => {
    const css = `.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
.hero:hover { transition: opacity 1s; transition-property: none; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "valid",
      tracks: [{ targetNodeId: "node-hero", property: "opacity" }],
    });
  });

  it("allows a non-overlapping shorthand transition on the imported target", () => {
    const css = `.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
.hero:hover { transition: color 1s ease-in-out; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "valid",
      tracks: [{ targetNodeId: "node-hero", property: "opacity" }],
    });
  });

  it("does not confuse a longer selector name with the imported target", () => {
    const css = `.heroine:hover { transition: all 1s; }
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "valid",
      tracks: [{ targetNodeId: "node-hero", property: "opacity" }],
    });
  });

  it("matches the Motion target at the end of a compound selector", () => {
    const css = `button.hero:hover { transition: opacity 1s; }
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it("matches the Motion target at the end of a descendant selector", () => {
    const css = `.page .hero:hover { transition: opacity 1s; }
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it("normalizes vendor-prefixed transition property values", () => {
    const css = `.hero { animation-name: move; animation-duration: 1s; animation-fill-mode: both; }
.hero:hover { transition-property: -webkit-transform; transition-duration: 1s; }
@keyframes move { from { transform: translateX(0); } to { transform: translateX(10px); } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it("checks each selector in a transition selector list", () => {
    const css = `.button:hover, .hero:hover { transition: opacity 1s; }
.hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;

    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it("reports nested keyframe definitions when there are no animation declarations", () => {
    expect(
      importAuthoredCssAnimations(
        "@media (min-width: 1px) { @keyframes pulse { to { opacity: 1; } } }",
        resolveHero,
      ),
    ).toEqual({ status: "absent", definedKeyframeNames: ["pulse"] });
  });

  it("does not treat per-stop timing functions as authored animations", () => {
    expect(
      importAuthoredCssAnimations(
        "@keyframes pulse { from { opacity: 0; animation-timing-function: ease-out; } to { opacity: 1; } }",
        resolveHero,
      ),
    ).toEqual({ status: "absent", definedKeyframeNames: ["pulse"] });
  });

  it("decodes escaped animation property names before importing and removing them", () => {
    const css =
      ".hero { anim\\61 tion-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }";
    const result = importAuthoredCssAnimations(css, resolveHero);

    expect(result).toMatchObject({
      status: "valid",
      tracks: [{ targetNodeId: "node-hero", property: "opacity" }],
    });
    if (result.status !== "valid") return;

    const remainder = removeAuthoredCssSourceRanges(css, result.rangesToRemove);
    expect(remainder).not.toContain("anim\\61 tion-name");
    expect(remainder).toContain("@keyframes pulse");
  });

  it("rejects an escaped CSS transition property that overlaps the target track", () => {
    const css =
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; transitio\\6e: opacity 1s; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }";
    expect(importAuthoredCssAnimations(css, resolveHero)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("overlap a Motion target property"),
    });
  });

  it("preserves global keyframes and removes only adopted animation declarations", () => {
    const css = `/* before */
.hero {
  color: red;
  /* keep this comment */
  animation-name: pulse;
  animation-duration: 1s;
  animation-delay: 0.25s;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
  animation-fill-mode: both;
  animation-iteration-count: 1;
  animation-direction: normal;
  animation-play-state: running;
  /* keep this comment too */
}
/* between */
@keyframes pulse {
  from { opacity: 0; }
  50% { opacity: 0.5; }
  to { opacity: 1; }
}
/* after */`;
    const result = importAuthoredCssAnimations(css, resolveHero);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;

    expect(result).toMatchObject({
      durationMs: 1250,
      defaultEase: "ease",
      keyframeNames: ["pulse"],
      definedKeyframeNames: ["pulse"],
      tracks: [
        {
          targetNodeId: "node-hero",
          property: "opacity",
          durationMs: 1000,
          delayMs: 250,
          keyframes: [
            { t: 0, value: "0", ease: "cubic-bezier(0.2, 0, 0, 1)" },
            { t: 0.5, value: "0.5", ease: "cubic-bezier(0.2, 0, 0, 1)" },
            { t: 1, value: "1" },
          ],
        },
      ],
    });

    const animationRanges = result.rangesToRemove.filter(
      (range) => range.kind === "animation-declaration",
    );
    expect(
      animationRanges.map((range) => css.slice(range.start, range.end)),
    ).toEqual([
      "animation-name: pulse;",
      "animation-duration: 1s;",
      "animation-delay: 0.25s;",
      "animation-timing-function: cubic-bezier(0.2, 0, 0, 1);",
      "animation-fill-mode: both;",
      "animation-iteration-count: 1;",
      "animation-direction: normal;",
      "animation-play-state: running;",
    ]);
    expect(result.rangesToRemove.map((range) => range.kind)).toEqual(
      Array(8).fill("animation-declaration"),
    );

    const remainder = removeAuthoredCssSourceRanges(css, result.rangesToRemove);
    expect(remainder).toBe(`/* before */
.hero {
  color: red;
  /* keep this comment */
  /* keep this comment too */
}
/* between */
@keyframes pulse {
  from { opacity: 0; }
  50% { opacity: 0.5; }
  to { opacity: 1; }
}
/* after */`);
  });

  it("removes an adopted selector rule but keeps its global keyframes", () => {
    const css = `.hero {
  animation-name: pulse;
  animation-duration: 1s;
  animation-fill-mode: both;
}
@keyframes pulse {
  from { opacity: 0; }
  to { opacity: 1; }
}`;
    const result = importAuthoredCssAnimations(css, resolveHero);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(removeAuthoredCssSourceRanges(css, result.rangesToRemove)).toBe(
      `@keyframes pulse {
  from { opacity: 0; }
  to { opacity: 1; }
}`,
    );
  });

  it("imports multiple supported properties as parallel timeline tracks", () => {
    const css = `.hero {
  animation-name: hero-enter;
  animation-duration: 900ms;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}
@keyframes hero-enter {
  from { opacity: 0; transform: translateY(12px); }
  50% { opacity: 0.5; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0px); }
}`;
    const result = importAuthoredCssAnimations(css, resolveHero);

    expect(result).toMatchObject({
      status: "valid",
      durationMs: 900,
      tracks: [
        {
          targetNodeId: "node-hero",
          property: "opacity",
          durationMs: 900,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 0.5, value: "0.5", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
        {
          targetNodeId: "node-hero",
          property: "transform",
          durationMs: 900,
          keyframes: [
            { t: 0, value: "translateY(12px)", ease: "ease-out" },
            { t: 0.5, value: "translateY(6px)", ease: "ease-out" },
            { t: 1, value: "translateY(0px)" },
          ],
        },
      ],
    });
    if (result.status !== "valid") return;

    const remainder = removeAuthoredCssSourceRanges(css, result.rangesToRemove);
    expect(remainder).not.toContain("animation-name: hero-enter;");
    expect(remainder).toContain("@keyframes hero-enter");
  });

  it("removes compact animation declarations without deleting unrelated declarations", () => {
    const css =
      ".hero { color: red; animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; }\n@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }";
    const result = importAuthoredCssAnimations(css, resolveHero);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;

    const remainder = removeAuthoredCssSourceRanges(css, result.rangesToRemove);
    expect(remainder).toContain(".hero { color: red;");
    expect(remainder).not.toMatch(/animation-(?:name|duration|fill-mode):/);
    expect(remainder).toContain("@keyframes pulse");
  });

  it("preserves the global reduced-motion overrides without importing them", () => {
    const css = `@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
.hero {
  animation-name: pulse;
  animation-duration: 1s;
  animation-fill-mode: both;
}
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;
    const result = importAuthoredCssAnimations(css, resolveHero);

    expect(result).toMatchObject({
      status: "valid",
      tracks: [{ targetNodeId: "node-hero", property: "opacity" }],
    });
    if (result.status !== "valid") return;

    const reducedMotionDeclarations = [
      "animation-duration: 0.01ms !important;",
      "animation-iteration-count: 1 !important;",
    ];
    expect(
      result.rangesToRemove.some((range) =>
        reducedMotionDeclarations.some((declaration) =>
          css.slice(range.start, range.end).includes(declaration),
        ),
      ),
    ).toBe(false);
    const remainder = removeAuthoredCssSourceRanges(css, result.rangesToRemove);
    expect(remainder).toContain("@media (prefers-reduced-motion: reduce)");
    for (const declaration of reducedMotionDeclarations) {
      expect(remainder).toContain(declaration);
    }
  });

  it.each([
    ["transition shorthand", ".hero { transition: opacity 2s ease; }"],
    [
      "transition longhands",
      ".hero:hover { transition-property: opacity; transition-duration: 1s; }",
    ],
    ["vendor-prefixed transition", ".hero { -webkit-transition: opacity 1s; }"],
    ["escaped transition property", ".hero { \\74 ransition: opacity 1s; }"],
  ])("fails closed on %s", (_label, css) => {
    const result = importAuthoredCssAnimations(
      `${css} .hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`,
      resolveHero,
    );

    expect(result).toMatchObject({ status: "unsupported" });
    expect(result).not.toHaveProperty("rangesToRemove");
  });

  it.each([
    ["animation shorthand", ".hero { animation: pulse 1s both; }"],
    [
      "multiple names",
      ".hero { animation-name: pulse, other; animation-duration: 1s; animation-fill-mode: both; }",
    ],
    [
      "partial endpoints",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { to { opacity: 1; } }",
    ],
    [
      "unsupported property beside a supported property",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; filter: blur(0); } to { opacity: 1; filter: blur(2px); } }",
    ],
    [
      "duplicate property declarations at one stop",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; opacity: 0.2; } to { opacity: 1; } }",
    ],
    [
      "a property missing a static endpoint",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; } }",
    ],
    [
      "duplicate animation declarations",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-duration: 2s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }",
    ],
    [
      "runtime values",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: var(--start); } to { opacity: 1; } }",
    ],
    [
      "unresolved imported stylesheets",
      '@import url("./theme.css"); .hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }',
    ],
    [
      "unsupported property",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { filter: blur(0); } to { filter: blur(2px); } }",
    ],
    [
      "duplicate keyframe names",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } } @keyframes pulse { from { opacity: 1; } to { opacity: 0; } }",
    ],
    [
      "conditional animation rules",
      "@media (min-width: 1px) { .hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }",
    ],
    [
      "animation definitions inside the reduced-motion query",
      "@media (prefers-reduced-motion: reduce) { .hero { animation-name: pulse; animation-duration: 1ms !important; animation-fill-mode: both; } } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }",
    ],
    [
      "target-specific reduced-motion overrides",
      "@media (prefers-reduced-motion: reduce) { .hero { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; } }",
    ],
    [
      "non-reducing global reduced-motion overrides",
      "@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 2s !important; animation-iteration-count: 1 !important; } }",
    ],
  ])("returns unsupported for %s", (_label, css) => {
    const result = importAuthoredCssAnimations(css, resolveHero);
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason.length).toBeGreaterThan(0);
    }
    expect(result).not.toHaveProperty("rangesToRemove");
  });

  it.each([
    [{ status: "unresolved" } as const, "no static target"],
    [{ status: "ambiguous" } as const, "multiple static targets"],
  ])("fails closed when selector resolution is %s", (resolution, _label) => {
    const css =
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }";
    const result = importAuthoredCssAnimations(css, () => resolution);
    expect(result.status).toBe("unsupported");
    expect(result).not.toHaveProperty("rangesToRemove");
  });

  it("keeps the 64-track import limit when one animation creates parallel tracks", () => {
    const animationRules = Array.from({ length: 33 }, (_, index) => {
      const selector = `.hero-${index}`;
      return `${selector} { animation-name: hero-enter; animation-duration: 1s; animation-fill-mode: both; }`;
    });
    const css = `${animationRules.join("\n")}
@keyframes hero-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0px); } }`;
    const result = importAuthoredCssAnimations(css, (selector) => ({
      status: "resolved",
      targetNodeId: selector.slice(1),
    }));

    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toMatch(/64 tracks/);
    }
    expect(result).not.toHaveProperty("rangesToRemove");
  });
});
