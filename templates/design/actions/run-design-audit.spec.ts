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
  checkDesignSystemAdherence,
  checkRenderBlockingOverlays,
  checkTapTargets,
  checkTokenDrift,
  designSystemExpectation,
  extractRootTokens,
} from "./run-design-audit.js";

// ---------------------------------------------------------------------------
// design-system adherence
// ---------------------------------------------------------------------------

const KIT = JSON.stringify({
  colors: { primary: "#00eaff", background: "#0c0d12" },
  typography: { headingFont: "Space Grotesk", bodyFont: "Inter" },
  tokens: [{ name: "primary", cssVar: "--color-primary", value: "#00eaff" }],
});

describe("designSystemExpectation", () => {
  it("collects fonts, hex colors, and token names from a kit", () => {
    const expectation = designSystemExpectation("Flo", KIT);
    expect(expectation).toMatchObject({
      fonts: ["Space Grotesk", "Inter"],
      colors: ["#00eaff", "#0c0d12"],
      cssVars: ["--color-primary"],
    });
  });

  it("marks unparseable kit data unreadable instead of silently empty", () => {
    expect(designSystemExpectation("Flo", "not json")).toMatchObject({
      unreadable: true,
    });
  });

  it("returns null when the kit parses but carries nothing verifiable", () => {
    expect(designSystemExpectation("Flo", null)).toBeNull();
    expect(
      designSystemExpectation("Flo", JSON.stringify({ notes: "x" })),
    ).toBeNull();
  });

  it("reports unknown adherence rather than a clean pass for a corrupt kit", () => {
    const findings = checkDesignSystemAdherence(
      "<html></html>",
      designSystemExpectation("Flo", "not json"),
      "index.html",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("design-system-drift:index.html:unreadable");
  });
});

describe("checkDesignSystemAdherence", () => {
  const expectation = designSystemExpectation("Flo", KIT);

  it("flags a screen that ignores the linked system entirely", () => {
    const html =
      "<html><style>:root{--brand:#6366f1}body{font-family:Roboto}</style></html>";
    const findings = checkDesignSystemAdherence(
      html,
      expectation,
      "index.html",
    );
    expect(findings.map((f) => f.id)).toEqual([
      "design-system-drift:index.html:fonts",
      "design-system-drift:index.html:colors",
      "design-system-drift:index.html:css-vars",
    ]);
    expect(findings[0].category).toBe("design-system-drift");
  });

  it("stays silent when the screen actually uses the system", () => {
    const html =
      "<html><style>:root{--color-primary:#00EAFF}h1{font-family:'Space Grotesk'}</style></html>";
    expect(checkDesignSystemAdherence(html, expectation, "index.html")).toEqual(
      [],
    );
  });

  it("matches shorthand hex against the kit's six-digit value", () => {
    const shortKit = designSystemExpectation(
      "Flo",
      JSON.stringify({ colors: { primary: "#ffffff" } }),
    );
    const html = "<html><style>:root{--bg:#FFF}</style></html>";
    expect(checkDesignSystemAdherence(html, shortKit, "a.html")).toEqual([]);
  });

  it("reports nothing when there is no linked system to check", () => {
    expect(checkDesignSystemAdherence("<html></html>", null, "a.html")).toEqual(
      [],
    );
  });
});

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
// checkRenderBlockingOverlays
// ---------------------------------------------------------------------------

describe("checkRenderBlockingOverlays", () => {
  const head = `<head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script></head>`;

  it("flags the reported failure: an x-cloak overlay with no hiding rule", () => {
    const findings = checkRenderBlockingOverlays(
      `<!doctype html><html>${head}<body class="p-4"><div x-cloak x-show="alertsOpen" class="fixed inset-0 z-50 bg-white">Alerts</div></body></html>`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("render-blocking-overlay");
    expect(findings[0].detail).toMatch(/x-cloak/);
  });

  it("flags a covering x-show overlay that a screenshot cannot catch", () => {
    const findings = checkRenderBlockingOverlays(
      `<!doctype html><html>${head}<body class="p-4"><div x-show="sidebarOpen" class="fixed inset-0 bg-black/30 z-30">scrim</div></body></html>`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("render-blocking-overlay");
  });

  it("does not flag a screen whose overlay is correctly pre-hidden", () => {
    const findings = checkRenderBlockingOverlays(
      `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script><style>[x-cloak]{display:none!important}</style></head><body class="p-4"><div x-cloak x-show="open" class="fixed inset-0">Alerts</div></body></html>`,
    );
    expect(findings).toEqual([]);
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
