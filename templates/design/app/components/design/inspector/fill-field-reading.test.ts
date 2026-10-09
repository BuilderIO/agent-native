import { describe, expect, it } from "vitest";

import {
  fillFieldEditText,
  parseFillFieldDraft,
  readFillField,
  showsOpacity,
} from "./fill-field-reading";

const solid = (value: string, extra: { authored?: string } = {}) =>
  readFillField({ paint: "solid", value, ...extra });

describe("readFillField", () => {
  it("reads hex in capitals, without the #", () => {
    expect(solid("#171717")).toEqual({ kind: "hex", text: "171717" });
    expect(solid("rgb(10, 107, 214)")).toEqual({ kind: "hex", text: "0A6BD6" });
    expect(solid("rgba(10, 107, 214, 0.5)")).toEqual({
      kind: "hex",
      text: "0A6BD6",
    });
  });

  it("reads Display P3 as its numbers, in the notation it was written in", () => {
    expect(solid("color(display-p3 0.09 0.09 0.09)")).toEqual({
      kind: "wide",
      prefix: "P3",
      text: "0.09 0.09 0.09",
    });
    expect(solid("color(display-p3 0 1 0.3 / 0.5)")).toEqual({
      kind: "wide",
      prefix: "P3",
      text: "0 1 0.3",
    });
  });

  it("reads OKLCH with lightness as a percent number, whichever way it was written", () => {
    const expected = {
      kind: "wide",
      prefix: "OKLCH",
      text: "72.4 0.181 153",
    };
    expect(solid("oklch(72.4% 0.181 153)")).toEqual(expected);
    expect(solid("oklch(0.724 0.181 153)")).toEqual(expected);
  });

  it("reads CSS colors the editor does not write as written, keeping their case", () => {
    expect(solid("rgb(102, 51, 153)", { authored: "rebeccapurple" })).toEqual({
      kind: "css",
      text: "rebeccapurple",
    });
    expect(solid("rgb(23, 23, 23)", { authored: "hsl(0, 0%, 9%)" })).toEqual({
      kind: "css",
      text: "hsl(0, 0%, 9%)",
    });
    expect(solid("rgb(23, 23, 23)", { authored: "HSL(0, 0%, 9%)" })).toEqual({
      kind: "css",
      text: "HSL(0, 0%, 9%)",
    });
  });

  it("reads hex, rgb and rgba as hex however they were authored", () => {
    for (const authored of [
      "#171717",
      "rgb(23, 23, 23)",
      "rgba(23, 23, 23, 0.5)",
    ]) {
      expect(solid("rgb(23, 23, 23)", { authored })).toEqual({
        kind: "hex",
        text: "171717",
      });
    }
  });

  it("names the token, not its color, and says when it cannot be resolved", () => {
    expect(
      readFillField({
        paint: "solid",
        value: "#0a6bd6",
        token: { name: "Link", unresolved: false },
      }),
    ).toEqual({ kind: "token", name: "Link", unresolved: false });
    expect(
      readFillField({
        paint: "solid",
        value: "var(--missing)",
        token: { name: "--missing", unresolved: true },
      }),
    ).toEqual({ kind: "token", name: "--missing", unresolved: true });
  });

  it("names a paint that is not a color by itself", () => {
    expect(
      readFillField({ paint: "gradient", value: "", paintName: "Linear" }),
    ).toEqual({ kind: "paint", text: "Linear" });
    expect(
      readFillField({ paint: "image", value: "", paintName: "Image" }),
    ).toEqual({ kind: "paint", text: "Image" });
    expect(
      readFillField({ paint: "shader", value: "", paintName: "Mesh Gradient" }),
    ).toEqual({ kind: "paint", text: "Mesh Gradient" });
  });

  it("reads mixed selections as mixed", () => {
    expect(readFillField({ paint: "solid", value: "", mixed: true })).toEqual({
      kind: "mixed",
    });
  });

  it("keeps a wide color it cannot edit as written rather than as a stand-in", () => {
    expect(solid("color(srgb 0.1 0.2 0.3)")).toEqual({
      kind: "css",
      text: "color(srgb 0.1 0.2 0.3)",
    });
  });
});

describe("showsOpacity", () => {
  it("gives Display P3 and OKLCH the percent's room at 100%", () => {
    const p3 = solid("color(display-p3 0.09 0.09 0.09)");
    expect(showsOpacity(p3, 100)).toBe(false);
    expect(showsOpacity(p3, 40)).toBe(true);
    expect(showsOpacity(solid("oklch(72.4% 0.181 153)"), 100)).toBe(false);
  });

  it("always spells it out for everything else", () => {
    expect(showsOpacity(solid("#171717"), 100)).toBe(true);
    expect(showsOpacity({ kind: "paint", text: "Linear" }, 100)).toBe(true);
    expect(
      showsOpacity({ kind: "token", name: "Link", unresolved: false }, 100),
    ).toBe(true);
    expect(showsOpacity({ kind: "mixed" }, 100)).toBe(false);
  });
});

describe("fillFieldEditText and parseFillFieldDraft round trip", () => {
  const cases: Array<[string, string]> = [
    ["hex", "#171717"],
    ["P3", "color(display-p3 0.09 0.09 0.09)"],
    ["OKLCH", "oklch(72.4% 0.181 153)"],
    ["hsl", "hsl(210, 50%, 40%)"],
    ["name", "rebeccapurple"],
  ];

  it.each(cases)(
    "%s: what the field shows is what it writes back",
    (_name, css) => {
      const reading = solid(css, { authored: css });
      const text = fillFieldEditText(reading)!;
      expect(text).not.toBeNull();
      const written = parseFillFieldDraft(text, 1)!;
      expect(written).not.toBeNull();
      expect(solid(written, { authored: written })).toEqual(reading);
    },
  );

  it("has nothing to type into for a paint, a token or a mixed selection", () => {
    expect(fillFieldEditText({ kind: "paint", text: "Image" })).toBeNull();
    expect(
      fillFieldEditText({ kind: "token", name: "Link", unresolved: false }),
    ).toBeNull();
    expect(fillFieldEditText({ kind: "mixed" })).toBeNull();
  });
});

describe("parseFillFieldDraft", () => {
  it("reads the field's own shorthand as the notation it names, at the fill's opacity", () => {
    expect(parseFillFieldDraft("P3 0.09 0.09 0.09", 1)).toBe(
      "color(display-p3 0.09 0.09 0.09)",
    );
    expect(parseFillFieldDraft("p3 0 1 0.3", 0.5)).toBe(
      "color(display-p3 0 1 0.3 / 0.5)",
    );
    expect(parseFillFieldDraft("OKLCH 72.4 0.181 153", 1)).toBe(
      "oklch(72.4% 0.181 153)",
    );
    expect(parseFillFieldDraft("oklch 50% 0.1 20", 0.25)).toBe(
      "oklch(50% 0.1 20 / 25%)",
    );
  });

  it("rejects shorthand that is not a color of that notation", () => {
    for (const draft of [
      "P3 0.1 0.2",
      "P3 0.1 0.2 1.5",
      "P3 -0.1 0.2 0.3",
      "P3 a b c",
      "OKLCH 120 0.1 20",
      "OKLCH 50 -0.1 20",
      "OKLCH 50 0.1",
    ]) {
      expect(parseFillFieldDraft(draft, 1), draft).toBeNull();
    }
  });

  it("reads hex with or without #, expanding shorthand, and keeps the opacity unless the hex carries its own", () => {
    expect(parseFillFieldDraft("0a6bd6", 1)).toBe("#0a6bd6");
    expect(parseFillFieldDraft("#0A6BD6", 0.5)).toBe("rgba(10, 107, 214, 0.5)");
    expect(parseFillFieldDraft("abc", 1)).toBe("#aabbcc");
    expect(parseFillFieldDraft("0a6bd680", 1)).toBe(
      "rgba(10, 107, 214, 0.502)",
    );
  });

  it("writes any other color the editor can read as typed, and drops what it cannot", () => {
    expect(parseFillFieldDraft("hsl(210, 50%, 40%)", 1)).toBe(
      "hsl(210, 50%, 40%)",
    );
    expect(parseFillFieldDraft("rebeccapurple", 1)).toBe("rebeccapurple");
    expect(parseFillFieldDraft("color(display-p3 0 1 0.3)", 1)).toBe(
      "color(display-p3 0 1 0.3)",
    );
    for (const draft of [
      "",
      "  ",
      "nope",
      "var(--x)",
      "linear-gradient(red, blue)",
    ]) {
      expect(parseFillFieldDraft(draft, 1), draft).toBeNull();
    }
  });
});
