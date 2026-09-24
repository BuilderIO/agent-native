import { describe, expect, it } from "vitest";

import {
  buildThemeContractFromSlide,
  classifyBackgroundMode,
  extractDeckThemeVars,
  isDeckThemeContract,
  isLiteralThemeValue,
  themeContractMismatch,
} from "./deck-theme-contract.js";

const darkSlide = (id: string) =>
  `<div class="fmd-slide" style="--deck-bg: #10261C; --deck-ink: #F2EFE6; --deck-accent: #7FB069;"><h1>${id}</h1></div>`;

const lightSlide = (id: string) =>
  `<div class="fmd-slide" style="--deck-bg: #FFFFFF; --deck-ink: #171717;"><h1>${id}</h1></div>`;

const linkedSlide = (id: string) =>
  `<div class="fmd-slide" style="--deck-bg: var(--ds-bg); --deck-ink: var(--ds-text);"><h1>${id}</h1></div>`;

describe("extractDeckThemeVars", () => {
  it("reads --deck-* custom properties from the outer wrapper", () => {
    expect(extractDeckThemeVars(darkSlide("s1"))).toEqual({
      bg: "#10261C",
      ink: "#F2EFE6",
      accent: "#7FB069",
    });
  });

  it("returns null when there is no fmd-slide wrapper or no style attribute", () => {
    expect(extractDeckThemeVars("<div><h1>No wrapper</h1></div>")).toBeNull();
    expect(extractDeckThemeVars('<div class="fmd-slide"></div>')).toBeNull();
  });
});

describe("isLiteralThemeValue", () => {
  it("treats var() references as inherited, not literal", () => {
    expect(isLiteralThemeValue("var(--ds-bg)")).toBe(false);
    expect(isLiteralThemeValue("#10261C")).toBe(true);
  });
});

describe("classifyBackgroundMode", () => {
  it("classifies hex colors by relative luminance", () => {
    expect(classifyBackgroundMode("#FFFFFF")).toBe("light");
    expect(classifyBackgroundMode("#10261C")).toBe("dark");
    expect(classifyBackgroundMode("rgb(255, 255, 255)")).toBe("light");
  });

  it("returns null for colors it cannot parse", () => {
    expect(classifyBackgroundMode("Canvas")).toBeNull();
    expect(classifyBackgroundMode("oklch(0.5 0.1 200)")).toBeNull();
  });
});

describe("buildThemeContractFromSlide", () => {
  it("builds a contract from a slide with a literal classifiable background", () => {
    const contract = buildThemeContractFromSlide("s1", darkSlide("s1"));
    expect(contract?.mode).toBe("dark");
    expect(contract?.sourceSlideId).toBe("s1");
    expect(contract?.vars.bg).toBe("#10261C");
  });

  it("returns null for a design-system-linked slide (no literal background)", () => {
    expect(buildThemeContractFromSlide("s1", linkedSlide("s1"))).toBeNull();
  });

  it("returns null when the slide has no wrapper contract at all", () => {
    expect(buildThemeContractFromSlide("s1", "<p>plain</p>")).toBeNull();
  });
});

describe("themeContractMismatch", () => {
  it("flags a light slide added to a dark-contract deck", () => {
    const contract = buildThemeContractFromSlide("s1", darkSlide("s1"))!;
    const warning = themeContractMismatch(contract, "s2", lightSlide("s2"));
    expect(warning).toContain("s2");
    expect(warning).toContain("light background");
    expect(warning).toContain("dark");
  });

  it("returns null when the slide matches the contract's mode", () => {
    const contract = buildThemeContractFromSlide("s1", darkSlide("s1"))!;
    expect(
      themeContractMismatch(contract, "s2", darkSlide("s2")),
    ).toBeNull();
  });

  it("returns null for a design-system-linked slide inheriting tokens", () => {
    const contract = buildThemeContractFromSlide("s1", darkSlide("s1"))!;
    expect(
      themeContractMismatch(contract, "s2", linkedSlide("s2")),
    ).toBeNull();
  });

  it("returns null when the new slide has no classifiable background", () => {
    const contract = buildThemeContractFromSlide("s1", darkSlide("s1"))!;
    expect(
      themeContractMismatch(
        contract,
        "s2",
        '<div class="fmd-slide" style="--deck-bg: Canvas;"></div>',
      ),
    ).toBeNull();
  });
});

describe("isDeckThemeContract", () => {
  it("accepts a well-formed contract and rejects malformed values", () => {
    const contract = buildThemeContractFromSlide("s1", darkSlide("s1"));
    expect(isDeckThemeContract(contract)).toBe(true);
    expect(isDeckThemeContract(null)).toBe(false);
    expect(isDeckThemeContract({})).toBe(false);
    expect(isDeckThemeContract({ mode: "dark" })).toBe(false);
  });
});
