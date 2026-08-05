import { describe, expect, it } from "vitest";

import {
  groupColorSwatches,
  hiddenColorWrite,
  hiddenTokenReference,
  parseTokenReference,
  resolveTokenNameForColor,
  swatchLabel,
  toDesignSystemColorSwatches,
  tokenReferenceValue,
} from "./design-system-swatches";

const token = (over: Record<string, unknown> = {}) => ({
  name: "link-primary",
  cssVar: "--cds-link-primary",
  value: "#0f62fe",
  type: "color",
  origin: "brand-kit",
  ...over,
});

describe("toDesignSystemColorSwatches", () => {
  it("returns nothing when the design has no tokens", () => {
    expect(toDesignSystemColorSwatches(undefined)).toEqual([]);
    expect(toDesignSystemColorSwatches([])).toEqual([]);
  });

  it("keeps colour tokens with their kit name and metadata", () => {
    expect(
      toDesignSystemColorSwatches([
        token({ group: "Colors/Interactive", source: "Carbon v11" }),
      ]),
    ).toEqual([
      {
        name: "link-primary",
        cssVar: "--cds-link-primary",
        value: "#0f62fe",
        group: "Colors/Interactive",
        source: "Carbon v11",
      },
    ]);
  });

  it("drops the design's own colours, which share the indexed list", () => {
    expect(
      toDesignSystemColorSwatches([
        token(),
        token({
          cssVar: "--hero-bg",
          name: "Hero Bg",
          origin: "design",
          source: "index.html",
        }),
        token({ cssVar: "--untagged", name: "Untagged", origin: undefined }),
      ]).map((s) => s.cssVar),
    ).toEqual(["--cds-link-primary"]);
  });

  it("keeps a kit token the user retuned through tweaks", () => {
    expect(
      toDesignSystemColorSwatches([
        token({ source: "Tweaks", value: "#ff0000" }),
      ]),
    ).toHaveLength(1);
  });

  it("drops non-colour types", () => {
    expect(
      toDesignSystemColorSwatches([
        token(),
        token({ cssVar: "--cds-spacing-05", value: "1rem", type: "spacing" }),
      ]).map((s) => s.cssVar),
    ).toEqual(["--cds-link-primary"]);
  });

  it("drops colour-typed values that resolve to no colour", () => {
    expect(
      toDesignSystemColorSwatches([
        token(),
        token({ cssVar: "--cds-inherit", value: "inherit" }),
        token({ cssVar: "--cds-dangling", value: "var(--not-in-this-kit)" }),
      ]).map((s) => s.cssVar),
    ).toEqual(["--cds-link-primary"]);
  });

  it("keeps a token aliased to another token, resolved for its swatch", () => {
    expect(
      toDesignSystemColorSwatches([
        token(),
        token({ cssVar: "--cds-alias", value: "var(--cds-link-primary)" }),
      ]),
    ).toMatchObject([
      { cssVar: "--cds-link-primary", value: "#0f62fe" },
      { cssVar: "--cds-alias", value: "#0f62fe" },
    ]);
  });

  it("follows an alias through the design's own variables", () => {
    expect(
      toDesignSystemColorSwatches([
        token({ cssVar: "--cds-alias", value: "var(--hero-bg)" }),
        token({ cssVar: "--hero-bg", value: "#24a148", origin: "design" }),
      ]),
    ).toMatchObject([{ cssVar: "--cds-alias", value: "#24a148" }]);
  });

  it("uses the fallback when the alias target is missing", () => {
    expect(
      toDesignSystemColorSwatches([
        token({ cssVar: "--cds-alias", value: "var(--gone, #ff0000)" }),
      ]),
    ).toMatchObject([{ cssVar: "--cds-alias", value: "#ff0000" }]);
  });

  it("survives a cyclic alias chain", () => {
    expect(
      toDesignSystemColorSwatches([
        token({ cssVar: "--a", value: "var(--b)" }),
        token({ cssVar: "--b", value: "var(--a)" }),
      ]),
    ).toEqual([]);
  });

  it("keeps one entry per css var", () => {
    expect(toDesignSystemColorSwatches([token(), token()]).length).toBe(1);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      token({ cssVar: `--c-${i}`, name: `c-${i}` }),
    );
    expect(toDesignSystemColorSwatches(many, 48)).toHaveLength(48);
  });
});

describe("resolveTokenNameForColor", () => {
  const swatches = [
    { name: "link-primary", cssVar: "--a", value: "#0f62fe" },
    { name: "text-primary", cssVar: "--b", value: "#161616" },
  ];

  it("names an unambiguous match by css variable, regardless of input format", () => {
    expect(resolveTokenNameForColor("#0F62FE", swatches)).toBe("a");
    expect(resolveTokenNameForColor("rgb(15, 98, 254)", swatches)).toBe("a");
  });

  it("returns null when nothing matches", () => {
    expect(resolveTokenNameForColor("#ffffff", swatches)).toBeNull();
  });

  it("refuses to guess when two tokens share the value", () => {
    expect(
      resolveTokenNameForColor("#0f62fe", [
        ...swatches,
        { name: "focus", cssVar: "--c", value: "#0f62fe" },
      ]),
    ).toBeNull();
  });

  it("returns null for an unparseable colour", () => {
    expect(resolveTokenNameForColor("not-a-color", swatches)).toBeNull();
  });
});

describe("groupColorSwatches", () => {
  it("keeps kit collection paths and token order", () => {
    const groups = groupColorSwatches([
      { name: "a", cssVar: "--a", value: "#111111", group: "Colors/Text" },
      { name: "b", cssVar: "--b", value: "#222222", group: "Colors/UI" },
      { name: "c", cssVar: "--c", value: "#333333", group: "Colors/Text" },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Colors/Text", "Colors/UI"]);
    expect(groups[0].swatches.map((s) => s.name)).toEqual(["a", "c"]);
  });

  it("puts ungrouped tokens in a single unlabelled group", () => {
    const groups = groupColorSwatches([
      { name: "a", cssVar: "--a", value: "#111111" },
      { name: "b", cssVar: "--b", value: "#222222" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
  });
});

describe("parseTokenReference", () => {
  it("reads the var name and its fallback", () => {
    expect(parseTokenReference("var(--cds-link-primary, #0f62fe)")).toEqual({
      cssVar: "--cds-link-primary",
      fallback: "#0f62fe",
    });
  });

  it("handles a bare reference", () => {
    expect(parseTokenReference("var(--cds-focus)")).toEqual({
      cssVar: "--cds-focus",
      fallback: null,
    });
  });

  it("ignores plain colours", () => {
    expect(parseTokenReference("#0f62fe")).toBeNull();
    expect(parseTokenReference("rgb(15, 98, 254)")).toBeNull();
  });

  it("reads a fallback that is itself a colour function", () => {
    expect(parseTokenReference("var(--brand, rgb(1, 2, 3))")).toEqual({
      cssVar: "--brand",
      fallback: "rgb(1, 2, 3)",
    });
    expect(parseTokenReference("var(--brand, oklch(0.7 0.1 250))")).toEqual({
      cssVar: "--brand",
      fallback: "oklch(0.7 0.1 250)",
    });
    expect(
      parseTokenReference("var(--brand, color(display-p3 1 0 0))"),
    ).toEqual({
      cssVar: "--brand",
      fallback: "color(display-p3 1 0 0)",
    });
  });

  it("reads a nested var() fallback", () => {
    expect(parseTokenReference("var(--a, var(--b))")).toEqual({
      cssVar: "--a",
      fallback: "var(--b)",
    });
  });

  it("rejects anything trailing the reference", () => {
    // A layered value is not a lone token reference, and treating it as one
    // would persist only the first layer.
    expect(parseTokenReference("var(--a) var(--b)")).toBeNull();
    expect(parseTokenReference("var(--a, #fff) 0 0")).toBeNull();
    expect(parseTokenReference("var(--a")).toBeNull();
  });
});

describe("tokenReferenceValue", () => {
  it("always carries a literal fallback", () => {
    expect(
      tokenReferenceValue({
        name: "link-primary",
        cssVar: "--cds-link-primary",
        value: "#0f62fe",
      }),
    ).toBe("var(--cds-link-primary, #0f62fe)");
  });
});

describe("resolveTokenNameForColor with references", () => {
  const swatches = [
    {
      name: "background-brand",
      cssVar: "--cds-background-brand",
      value: "#0f62fe",
    },
    { name: "link-primary", cssVar: "--cds-link-primary", value: "#0f62fe" },
  ];

  it("names an ambiguous colour exactly when it is a reference", () => {
    // The same blue by value is a tie; the reference resolves it.
    expect(resolveTokenNameForColor("#0f62fe", swatches)).toBeNull();
    expect(
      resolveTokenNameForColor("var(--cds-link-primary, #0f62fe)", swatches),
    ).toBe("cds-link-primary");
  });

  it("falls back to the bare var name when the kit no longer has it", () => {
    expect(resolveTokenNameForColor("var(--cds-gone, #000)", swatches)).toBe(
      "cds-gone",
    );
  });
});

describe("swatchLabel", () => {
  it("shows the css variable so every row reads as one vocabulary", () => {
    // The indexed name for an unnamed role is title-cased ("Color Primary"),
    // which would sit oddly beside the kit's own cds-* tokens.
    expect(
      swatchLabel({
        name: "Color Primary",
        cssVar: "--color-primary",
        value: "#0f62fe",
      }),
    ).toBe("color-primary");
    expect(
      swatchLabel({
        name: "background-brand",
        cssVar: "--cds-background-brand",
        value: "#0f62fe",
      }),
    ).toBe("cds-background-brand");
  });
});

describe("hiddenColorWrite", () => {
  const zero = (literal: string) =>
    literal.startsWith("#") || literal.startsWith("rgb")
      ? "rgba(0, 0, 0, 0)"
      : null;

  it("keeps a token reference inside the persisted value", () => {
    // Not React state: the inspector unmounts on deselect, and the hide has to
    // outlive that or Show restores a bare hex.
    expect(hiddenColorWrite("var(--cds-link-primary, #0f62fe)", zero)).toBe(
      "color-mix(in srgb, var(--cds-link-primary, #0f62fe) 0%, transparent)",
    );
  });

  it("zeroes the channels of a plain colour", () => {
    expect(hiddenColorWrite("#0f62fe", zero)).toBe("rgba(0, 0, 0, 0)");
  });

  it("falls back to transparent when nothing parses", () => {
    expect(hiddenColorWrite("not-a-colour", zero)).toBe("transparent");
  });
});

describe("hiddenTokenReference", () => {
  it("recovers the reference a hidden token carries", () => {
    expect(
      hiddenTokenReference(
        "color-mix(in srgb, var(--cds-link-primary, #0f62fe) 0%, transparent)",
      ),
    ).toBe("var(--cds-link-primary, #0f62fe)");
  });

  it("round-trips whatever hiddenColorWrite produced", () => {
    const reference = "var(--brand, rgb(1, 2, 3))";
    expect(hiddenTokenReference(hiddenColorWrite(reference, () => null))).toBe(
      reference,
    );
  });

  it("is null for values that are not a hidden token", () => {
    expect(hiddenTokenReference("rgba(0, 0, 0, 0)")).toBeNull();
    expect(hiddenTokenReference("var(--a, #fff)")).toBeNull();
    // A visible mix is not a hide marker.
    expect(
      hiddenTokenReference("color-mix(in srgb, var(--a) 50%, transparent)"),
    ).toBeNull();
  });
});
