// Contract: the auth marketing panel's base colors are authored for the dark
// #0a0a0a body (.app-name is literally #fff). The light-mode block themed the
// auth card exhaustively but never the marketing panel, so every app that
// renders the text panel instead of a product screenshot showed its name,
// tagline and feature list at 1.09:1-2.35:1 contrast - reported as "content on
// the sign up screen is not readable". These tests fail if a marketing text
// rule gains a hardcoded color without a light-mode counterpart.
import { describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { BUILT_IN_AUTH_MARKETING } from "./auth-marketing.js";
import { getOnboardingHtml } from "./onboarding-html.js";

/** Selectors that carry human-readable copy in the marketing panel. */
const MARKETING_TEXT_SELECTORS = [
  ".app-name",
  ".app-tagline",
  ".app-desc",
  ".feature-list li",
  ".oss-link",
];

/** Apps with no screenshot render `.marketing-content`, so the copy is on the page background. */
const TEXT_PANEL_APPS = Object.entries(BUILT_IN_AUTH_MARKETING).filter(
  ([, config]) => config.screenshotPath === undefined,
);

/** Slice a balanced `{...}` block starting at the first brace after `fromIndex`. */
function balancedBlock(css: string, fromIndex: number): string {
  const open = css.indexOf("{", fromIndex);
  if (open === -1) throw new Error("block has no opening brace");
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced CSS block");
}

function lightSchemeBlock(html: string): string {
  const at = html.indexOf("@media (prefers-color-scheme: light)");
  expect(at, "auth CSS declares a light-scheme block").toBeGreaterThan(-1);
  return balancedBlock(html, at);
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("auth marketing panel readability", () => {
  it("has text-panel apps to cover", () => {
    expect(TEXT_PANEL_APPS.length).toBeGreaterThan(0);
  });

  it.each(TEXT_PANEL_APPS)(
    "renders the text marketing panel for %s",
    (slug) => {
      const html = getOnboardingHtml({
        requestHost: `${slug}.agent-native.com`,
      });
      try {
        expect(html).toContain('class="marketing-content"');
        expect(html).not.toMatch(/<img[^>]*class="auth-marketing-screenshot"/);
      } finally {
        resetAppConfigForTests();
      }
    },
  );

  it.each(TEXT_PANEL_APPS)(
    "gives every marketing text selector a light-scheme color for %s",
    (slug) => {
      const html = getOnboardingHtml({
        requestHost: `${slug}.agent-native.com`,
      });
      try {
        const light = lightSchemeBlock(html);
        for (const selector of MARKETING_TEXT_SELECTORS) {
          const rule = new RegExp(
            `\\.auth-marketing-home[^{}]*\\${selector.replace(/ /g, "\\s+")}[^{}]*\\{[^}]*color:`,
          );
          expect(
            light,
            `${selector} needs a light-scheme color or it inherits the dark-body color`,
          ).toMatch(rule);
        }
      } finally {
        resetAppConfigForTests();
      }
    },
  );

  it("leaves no marketing text color hardcoded for dark only", () => {
    const html = getOnboardingHtml({ requestHost: "factory.agent-native.com" });
    try {
      const light = lightSchemeBlock(html);
      const base = html.slice(
        0,
        html.indexOf("@media (prefers-color-scheme: light)"),
      );

      // Any base rule that paints marketing copy with a literal color must have
      // a light-scheme counterpart, otherwise it renders against the wrong body.
      const rulePattern = /([^{}]+)\{([^}]*)\}/g;
      const unguarded: string[] = [];
      for (const [, rawSelector, body] of base.matchAll(rulePattern)) {
        const selector = rawSelector!.trim();
        if (!/color:\s*(#|rgba?\()/.test(body!)) continue;
        const target = MARKETING_TEXT_SELECTORS.find((candidate) =>
          selector.includes(candidate),
        );
        if (!target) continue;
        if (!light.includes(target)) unguarded.push(selector);
      }

      expect(
        unguarded,
        "these marketing rules hardcode a color with no light-scheme override",
      ).toEqual([]);
    } finally {
      resetAppConfigForTests();
    }
  });

  it("keeps light-scheme marketing copy above the WCAG AA contrast floor", () => {
    // CanvasText/Canvas resolve to black on white in the default light scheme,
    // and body.has-marketing becomes color-mix(CanvasText 4%, Canvas).
    const pageBackground = "#f5f5f5";
    const mixOnWhite = (percent: number) => {
      const channel = Math.round(255 * (1 - percent / 100));
      return `#${channel.toString(16).padStart(2, "0").repeat(3)}`;
    };

    // Mirrors the declared light-scheme values for the marketing copy.
    const declared: Array<[string, string]> = [
      [".app-name", "#000000"],
      [".app-tagline", mixOnWhite(72)],
      [".feature-list li", mixOnWhite(72)],
      [".app-desc", mixOnWhite(62)],
    ];

    for (const [selector, color] of declared) {
      expect(
        contrastRatio(color, pageBackground),
        `${selector} must clear 4.5:1 against the light auth background`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("offers a light-scheme brand mark so the logo is not white on white", () => {
    const html = getOnboardingHtml({ requestHost: "factory.agent-native.com" });
    try {
      expect(html).toContain('media="(prefers-color-scheme: light)"');
      expect(html).toContain("agent-native-icon-light.svg");
    } finally {
      resetAppConfigForTests();
    }
  });
});
