/**
 * run-design-audit.spec.ts
 *
 * Covers the pure, DB-free parts of the audit's checks — primarily the
 * multi-screen token-drift check (extractRootTokens / checkTokenDrift), plus
 * the tap-target heuristic already exercised indirectly by
 * apply-a11y-fix.spec.ts. The DB-backed `run` path (resolving design_files,
 * live collab content) requires a live DB/collab runtime and is not exercised
 * here — the pure checks fully determine what findings it produces.
 */

import { describe, expect, it } from "vitest";

import {
  checkTapTargets,
  checkTokenDrift,
  extractRootTokens,
} from "./run-design-audit.js";

// ---------------------------------------------------------------------------
// extractRootTokens
// ---------------------------------------------------------------------------

describe("extractRootTokens", () => {
  it("parses custom properties from a :root block", () => {
    const html = `<style>:root { --color-accent: #0EA5E9; --radius-md: 0.5rem; }</style>`;
    expect(extractRootTokens(html)).toEqual({
      "--color-accent": "#0EA5E9",
      "--radius-md": "0.5rem",
    });
  });

  it("returns an empty map when there is no :root block", () => {
    expect(extractRootTokens("<style>.foo { color: red; }</style>")).toEqual(
      {},
    );
  });

  it("ignores non-custom-property declarations inside :root", () => {
    const html = `<style>:root { color: red; --brand: blue; }</style>`;
    expect(extractRootTokens(html)).toEqual({ "--brand": "blue" });
  });

  it("only reads the first :root block when multiple are present", () => {
    const html = `<style>:root { --a: 1; }</style><style>:root { --a: 2; --b: 3; }</style>`;
    expect(extractRootTokens(html)).toEqual({ "--a": "1" });
  });
});

// ---------------------------------------------------------------------------
// checkTokenDrift
// ---------------------------------------------------------------------------

const withRoot = (tokens: Record<string, string>) =>
  `<style>:root { ${Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ")} }</style>`;

describe("checkTokenDrift", () => {
  it("returns no findings for a single screen (nothing to compare)", () => {
    const findings = checkTokenDrift([
      { filename: "index.html", html: withRoot({ "--brand": "blue" }) },
    ]);
    expect(findings).toEqual([]);
  });

  it("returns no findings when every screen's tokens match index.html", () => {
    const html = withRoot({ "--brand": "blue", "--radius": "8px" });
    const findings = checkTokenDrift([
      { filename: "index.html", html },
      { filename: "pricing.html", html },
    ]);
    expect(findings).toEqual([]);
  });

  it("flags a screen whose token value diverges from index.html", () => {
    const findings = checkTokenDrift([
      { filename: "index.html", html: withRoot({ "--brand": "blue" }) },
      { filename: "pricing.html", html: withRoot({ "--brand": "green" }) },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "token-drift",
      severity: "warning",
      fixAvailable: false,
      selector: ":root",
    });
    expect(findings[0].message).toContain("--brand");
    expect(findings[0].message).toContain("pricing.html");
    expect(findings[0].detail).toContain("blue");
    expect(findings[0].detail).toContain("green");
  });

  it("flags one finding per diverging property, not per screen", () => {
    const findings = checkTokenDrift([
      {
        filename: "index.html",
        html: withRoot({ "--brand": "blue", "--radius": "8px" }),
      },
      {
        filename: "pricing.html",
        html: withRoot({ "--brand": "green", "--radius": "4px" }),
      },
    ]);
    expect(findings).toHaveLength(2);
  });

  it("does not flag a screen with no :root block at all", () => {
    const findings = checkTokenDrift([
      { filename: "index.html", html: withRoot({ "--brand": "blue" }) },
      { filename: "fragment.html", html: "<div>no tokens here</div>" },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not flag a property the drifting screen never defines", () => {
    const findings = checkTokenDrift([
      {
        filename: "index.html",
        html: withRoot({ "--brand": "blue", "--radius": "8px" }),
      },
      { filename: "pricing.html", html: withRoot({ "--brand": "blue" }) },
    ]);
    expect(findings).toEqual([]);
  });

  it("uses the first screen as the reference when index.html is absent", () => {
    const findings = checkTokenDrift([
      { filename: "home.html", html: withRoot({ "--brand": "blue" }) },
      { filename: "pricing.html", html: withRoot({ "--brand": "green" }) },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("pricing.html");
  });
});

// ---------------------------------------------------------------------------
// checkTapTargets (sanity — exercised more fully via apply-a11y-fix.spec.ts)
// ---------------------------------------------------------------------------

describe("checkTapTargets", () => {
  it("flags a tiny interactive element", () => {
    const findings = checkTapTargets('<button class="h-4 w-4">x</button>');
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("tap-target");
  });

  it("does not flag an element with an adequate min size", () => {
    const findings = checkTapTargets(
      '<button class="h-4 w-4 min-h-[44px] min-w-[44px]">x</button>',
    );
    expect(findings).toEqual([]);
  });
});
