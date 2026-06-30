import { describe, expect, it } from "vitest";

import {
  getPropertyClasses,
  removePropertyClass,
  setPropertyClass,
  utilityStem,
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
