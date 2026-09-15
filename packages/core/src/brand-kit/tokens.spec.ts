import { describe, expect, it } from "vitest";

import {
  classifyBrandKitToken,
  isSafeCssTokenValue,
  normalizeBrandKitTokens,
  parseBrandKitTokensFromCss,
} from "./tokens.js";

describe("brand-kit token helpers", () => {
  it("classifies dimensions by value before color-like names", () => {
    expect(classifyBrandKitToken("--text-body-size-medium", "1rem")).toBe(
      "typography",
    );
    expect(classifyBrandKitToken("--border-width-thin", "2px")).toBe("other");
    expect(classifyBrandKitToken("--brand-accent", "#0f62fe")).toBe("color");
  });

  it("rejects values that can escape a CSS declaration", () => {
    expect(isSafeCssTokenValue("#0f62fe")).toBe(true);
    expect(isSafeCssTokenValue("red; color: blue")).toBe(false);
    expect(isSafeCssTokenValue("</style><script>")).toBe(false);
  });

  it("normalizes named tokens and reports malformed entries", () => {
    expect(
      normalizeBrandKitTokens([
        { cssVar: "--accent", value: "#0f62fe" },
        { cssVar: "accent", value: "#fff" },
        "invalid",
      ]),
    ).toEqual({
      tokens: [
        {
          name: "Accent",
          cssVar: "--accent",
          value: "#0f62fe",
          type: "color",
        },
      ],
      rejected: [
        { reason: "unsafe-css-var", label: "accent" },
        { reason: "malformed", label: "invalid" },
      ],
    });
  });

  it("preserves source token names when reading custom CSS", () => {
    expect(
      parseBrandKitTokensFromCss(
        ":root { --cds-interactive-01: #0f62fe; --cds-spacing-05: 1rem; }",
        "Carbon",
      ),
    ).toEqual([
      {
        name: "cds-interactive-01",
        cssVar: "--cds-interactive-01",
        value: "#0f62fe",
        type: "color",
        source: "Carbon",
      },
      {
        name: "cds-spacing-05",
        cssVar: "--cds-spacing-05",
        value: "1rem",
        type: "spacing",
        source: "Carbon",
      },
    ]);
  });
});
