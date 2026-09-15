import { describe, expect, it } from "vitest";

import {
  breakpointUpperBoundPx,
  effectiveUtilityAtWidth,
  getMaxWidthPropertyClasses,
  getPropertyClasses,
  looksLikeTailwindUtility,
  maxWidthClassToken,
  maxWidthOverridesForStem,
  parseClassGroups,
  parseMaxWidthClassToken,
  planBreakpointStyleWrite,
  removeMaxWidthPropertyClass,
  removePropertyClass,
  responsiveUtilityMatchesStyleProperty,
  setMaxWidthPropertyClass,
  setPropertyClass,
  utilityStem,
  utilityStemsForCssProperty,
  widthToPrefix,
} from "./responsive-classes";

describe("utilityStem — property-aware keys (no cross-property collisions)", () => {
  it("distinguishes text-* align vs size vs color", () => {
    expect(utilityStem("text-center")).toBe("text-align");
    expect(utilityStem("text-lg")).toBe("font-size");
    expect(utilityStem("text-red-500")).toBe("text-color");
    expect(utilityStem("text-[20px]")).toBe("font-size");
    expect(utilityStem("text-[#abc]")).toBe("text-color");
  });

  it("collapses the single-word display family to one key", () => {
    expect(utilityStem("flex")).toBe("display");
    expect(utilityStem("block")).toBe("display");
    expect(utilityStem("hidden")).toBe("display");
    expect(utilityStem("grid")).toBe("display");
  });

  it("distinguishes bg color vs gradient vs size", () => {
    expect(utilityStem("bg-red-500")).toBe("background-color");
    expect(utilityStem("bg-gradient-to-r")).toBe("background-image");
    expect(utilityStem("bg-cover")).toBe("background-size");
  });

  it("distinguishes font weight vs family and keeps axis families distinct", () => {
    expect(utilityStem("font-bold")).toBe("font-weight");
    expect(utilityStem("font-sans")).toBe("font-family");
    expect(utilityStem("min-w-0")).not.toBe(utilityStem("min-h-0"));
    expect(utilityStem("gap-x-4")).not.toBe(utilityStem("gap-y-4"));
  });

  it("falls back to the leading segment for simple utilities", () => {
    expect(utilityStem("w-full")).toBe("w");
    expect(utilityStem("rounded-lg")).toBe("rounded");
    expect(utilityStem("p-4")).toBe("p");
  });
});

describe("set/remove property class — no unrelated-utility data loss", () => {
  it("setting font-size at md keeps md:text-center and md:font-bold", () => {
    expect(
      setPropertyClass("md:text-center md:font-bold", "md", "text-lg"),
    ).toBe("md:text-center md:font-bold md:text-lg");
  });

  it("removing the text color does not nuke text-center / text-lg", () => {
    expect(
      removePropertyClass(
        "text-red-500 text-center text-lg",
        "base",
        "text-color",
      ),
    ).toBe("text-center text-lg");
  });

  it("switching display block -> flex yields a single display class", () => {
    expect(setPropertyClass("md:block", "md", "flex")).toBe("md:flex");
  });

  it("getPropertyClasses matches by resolved property key", () => {
    expect(
      getPropertyClasses("md:text-center md:text-lg", "md", "font-size"),
    ).toEqual(["md:text-lg"]);
  });
});

describe("max-width scoped class tokens (§6.4 Framer cascade)", () => {
  it("parses arbitrary max-[Npx]: variants", () => {
    expect(parseMaxWidthClassToken("max-[809px]:text-sm")).toEqual({
      raw: "max-[809px]:text-sm",
      boundPx: 809,
      utility: "text-sm",
    });
  });

  it("parses Tailwind core max-* variants to canonical bounds", () => {
    expect(parseMaxWidthClassToken("max-md:hidden")).toEqual({
      raw: "max-md:hidden",
      boundPx: 767,
      utility: "hidden",
    });
  });

  it("does not confuse plain max-w sizing utilities with scoped tokens", () => {
    expect(parseMaxWidthClassToken("max-w-md")).toBeNull();
    expect(parseMaxWidthClassToken("max-w-[300px]")).toBeNull();
    expect(parseMaxWidthClassToken("text-sm")).toBeNull();
  });

  it("builds tokens Tailwind's arbitrary-variant JIT understands", () => {
    expect(maxWidthClassToken(1279, "p-4")).toBe("max-[1279px]:p-4");
  });
});

describe("legacy prefix helpers treat scoped tokens as opaque", () => {
  const className = "text-sm md:text-base max-[809px]:text-lg";

  it("parseClassGroups excludes max-width tokens from the base group", () => {
    const groups = parseClassGroups(className);
    expect(groups.base).toEqual(["text-sm"]);
    expect(groups.md).toEqual(["md:text-base"]);
  });

  it("setPropertyClass never replaces a max-width token", () => {
    expect(setPropertyClass(className, "base", "text-xl")).toBe(
      "text-xl md:text-base max-[809px]:text-lg",
    );
  });

  it("removePropertyClass never strips a max-width token", () => {
    expect(removePropertyClass(className, "base", "font-size")).toBe(
      "md:text-base max-[809px]:text-lg",
    );
  });
});

describe("max-width get/set/remove", () => {
  it("appends a new scoped token", () => {
    expect(setMaxWidthPropertyClass("text-sm", 809, "text-lg")).toBe(
      "text-sm max-[809px]:text-lg",
    );
  });

  it("replaces the same stem at the same bound only", () => {
    const className = "text-sm max-[809px]:text-lg max-[389px]:text-xs";
    expect(setMaxWidthPropertyClass(className, 809, "text-2xl")).toBe(
      "text-sm max-[809px]:text-2xl max-[389px]:text-xs",
    );
  });

  it("leaves different stems at the same bound untouched", () => {
    const className = "max-[809px]:p-2 max-[809px]:text-lg";
    expect(setMaxWidthPropertyClass(className, 809, "p-4")).toBe(
      "max-[809px]:p-4 max-[809px]:text-lg",
    );
  });

  it("removes only the matching bound + stem", () => {
    const className = "text-sm max-[809px]:text-lg max-[389px]:text-xs";
    expect(removeMaxWidthPropertyClass(className, 809, "font-size")).toBe(
      "text-sm max-[389px]:text-xs",
    );
  });

  it("lists scoped tokens for a bound + stem", () => {
    expect(
      getMaxWidthPropertyClasses("a max-[809px]:text-lg b", 809, "font-size"),
    ).toEqual(["max-[809px]:text-lg"]);
  });

  it("collects overrides for a stem sorted widest first", () => {
    expect(
      maxWidthOverridesForStem(
        "max-[389px]:text-xs text-sm max-[1199px]:text-lg",
        "font-size",
      ),
    ).toEqual([
      { boundPx: 1199, utility: "text-lg", token: "max-[1199px]:text-lg" },
      { boundPx: 389, utility: "text-xs", token: "max-[389px]:text-xs" },
    ]);
  });
});

describe("breakpointUpperBoundPx (Framer cascade bounds)", () => {
  it("bounds each breakpoint just below the next-wider frame", () => {
    // Framer defaults: primary 1280, breakpoints 390 / 810.
    expect(breakpointUpperBoundPx([390, 810], 810, 1280)).toBe(1279);
    expect(breakpointUpperBoundPx([390, 810], 390, 1280)).toBe(809);
  });

  it("returns null when the active frame is the widest context", () => {
    expect(breakpointUpperBoundPx([390, 810], 1280, 1280)).toBeNull();
    expect(breakpointUpperBoundPx([390, 810, 1280], 1280, null)).toBeNull();
  });

  it("uses only wider breakpoints when the base width is unknown", () => {
    expect(breakpointUpperBoundPx([390, 810, 1280], 810, null)).toBe(1279);
  });
});

describe("planBreakpointStyleWrite (single class-vs-media decision)", () => {
  it("returns base when there is no scope bound", () => {
    expect(
      planBreakpointStyleWrite({
        property: "color",
        value: "red",
        upperBoundPx: null,
      }),
    ).toEqual({ mode: "base" });
  });

  it("routes Tailwind utilities to scoped classes", () => {
    expect(
      planBreakpointStyleWrite({
        property: "fontSize",
        value: "text-lg",
        upperBoundPx: 809,
      }),
    ).toEqual({
      mode: "class",
      boundPx: 809,
      utility: "text-lg",
      token: "max-[809px]:text-lg",
    });
  });

  it("routes raw CSS values to the managed media block", () => {
    expect(
      planBreakpointStyleWrite({
        property: "left",
        value: "137px",
        upperBoundPx: 809,
      }),
    ).toEqual({
      mode: "media",
      maxWidthPx: 809,
      property: "left",
      value: "137px",
    });
    expect(
      planBreakpointStyleWrite({
        property: "backgroundColor",
        value: "rgb(255, 0, 0)",
        upperBoundPx: 1279,
      }),
    ).toEqual({
      mode: "media",
      maxWidthPx: 1279,
      property: "background-color",
      value: "rgb(255, 0, 0)",
    });
  });

  it("shares the utility-vs-raw heuristics with the inspector", () => {
    expect(looksLikeTailwindUtility("text-lg")).toBe(true);
    expect(looksLikeTailwindUtility("rgb(0,0,0)")).toBe(false);
    expect(responsiveUtilityMatchesStyleProperty("fontSize", "text-lg")).toBe(
      true,
    );
    expect(responsiveUtilityMatchesStyleProperty("fontSize", "18px")).toBe(
      false,
    );
    expect(utilityStemsForCssProperty("backgroundColor")).toEqual([
      "background-color",
    ]);
  });
});

describe("effectiveUtilityAtWidth (cascade resolution)", () => {
  const className =
    "text-sm md:text-base max-[1199px]:text-lg max-[809px]:text-xs";

  it("narrowest applicable max-width scope wins", () => {
    expect(effectiveUtilityAtWidth(className, "font-size", 500)).toEqual({
      utility: "text-xs",
      source: "max-width",
      boundPx: 809,
    });
    expect(effectiveUtilityAtWidth(className, "font-size", 900)).toEqual({
      utility: "text-lg",
      source: "max-width",
      boundPx: 1199,
    });
  });

  it("falls back to the largest satisfied min-width prefix", () => {
    expect(effectiveUtilityAtWidth(className, "font-size", 1400)).toEqual({
      utility: "text-base",
      source: "prefix",
      prefix: "md",
    });
  });

  it("falls back to base when nothing else applies", () => {
    expect(
      effectiveUtilityAtWidth("text-sm max-[500px]:text-xs", "font-size", 700),
    ).toEqual({ utility: "text-sm", source: "base" });
  });

  it("returns null when the stem has no tokens", () => {
    expect(effectiveUtilityAtWidth("p-4", "font-size", 700)).toBeNull();
  });
});

describe("widthToPrefix (legacy min-width mapping still intact)", () => {
  it("maps canonical widths", () => {
    expect(widthToPrefix(390)).toBe("base");
    expect(widthToPrefix(768)).toBe("md");
    expect(widthToPrefix(1280)).toBe("xl");
  });
});
