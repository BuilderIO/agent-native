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
      "multiple keyframe properties",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; color: red; } to { opacity: 1; } }",
    ],
    [
      "runtime values",
      ".hero { animation-name: pulse; animation-duration: 1s; animation-fill-mode: both; } @keyframes pulse { from { opacity: var(--start); } to { opacity: 1; } }",
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
});
