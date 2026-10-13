import { describe, expect, it } from "vitest";

import {
  filterTokens,
  findToken,
  parseVarReference,
  resolveVarColor,
  tokenVarCss,
  type DesignColorToken,
  type DesignColorTokens,
} from "./color-picker-tokens";

const tokens = (...list: DesignColorToken[]): DesignColorTokens => ({
  status: "ready",
  tokens: list,
});

const brand = { name: "Brand", cssVar: "--brand", value: "#336699" };
const link = { name: "Link", cssVar: "--link", value: "var(--brand)" };

describe("parseVarReference", () => {
  it("reads var() with and without a fallback", () => {
    expect(parseVarReference("var(--brand)")).toEqual({ name: "--brand" });
    expect(parseVarReference("  var( --brand )  ")).toEqual({
      name: "--brand",
    });
    expect(parseVarReference("var(--brand, #fff)")).toEqual({
      name: "--brand",
      fallback: "#fff",
    });
    expect(parseVarReference("var(--a, rgb(1 2 3 / 50%))")).toEqual({
      name: "--a",
      fallback: "rgb(1 2 3 / 50%)",
    });
  });

  it("returns null for anything that is not one var() reference", () => {
    expect(parseVarReference("#336699")).toBeNull();
    expect(parseVarReference("var(brand)")).toBeNull();
    expect(parseVarReference("var(--a) var(--b)")).toBeNull();
    expect(parseVarReference("rgb(var(--r) 0 0)")).toBeNull();
    expect(parseVarReference("")).toBeNull();
  });

  it("round-trips through tokenVarCss", () => {
    expect(parseVarReference(tokenVarCss("--brand-primary"))?.name).toBe(
      "--brand-primary",
    );
  });
});

describe("resolveVarColor", () => {
  it("is null for a value that is not a var() reference", () => {
    expect(resolveVarColor("#336699", tokens(brand))).toBeNull();
  });

  it("resolves a token to the color it declares", () => {
    expect(resolveVarColor("var(--brand)", tokens(brand))).toEqual({
      kind: "color",
      css: "#336699",
      name: "--brand",
      token: brand,
    });
  });

  it("follows an alias to another token", () => {
    const resolved = resolveVarColor("var(--link)", tokens(link, brand));
    expect(resolved).toMatchObject({ kind: "color", css: "#336699" });
  });

  it("reads wide-gamut token values as written", () => {
    const wide = {
      name: "Wide",
      cssVar: "--wide",
      value: "oklch(0.7 0.3 150)",
    };
    expect(resolveVarColor("var(--wide)", tokens(wide))).toMatchObject({
      kind: "color",
      css: "oklch(0.7 0.3 150)",
    });
  });

  it("is unresolved, never a color, for a token that is not defined", () => {
    expect(resolveVarColor("var(--missing)", tokens(brand))).toEqual({
      kind: "unresolved",
      name: "--missing",
      reason: "missing",
    });
  });

  it("uses the var() fallback only when the token is not defined", () => {
    expect(
      resolveVarColor("var(--missing, #ff0000)", tokens(brand)),
    ).toMatchObject({ kind: "color", css: "#ff0000", token: null });
    expect(
      resolveVarColor("var(--brand, #ff0000)", tokens(brand)),
    ).toMatchObject({ kind: "color", css: "#336699" });
    expect(
      resolveVarColor("var(--missing, nonsense)", tokens(brand)),
    ).toMatchObject({ kind: "unresolved", reason: "missing" });
  });

  it("is unresolved for a token whose value is not a color", () => {
    const size = { name: "Gap", cssVar: "--gap", value: "16px" };
    expect(resolveVarColor("var(--gap)", tokens(size))).toEqual({
      kind: "unresolved",
      name: "--gap",
      reason: "not-a-color",
    });
  });

  it("is unresolved for aliases that loop", () => {
    const a = { name: "A", cssVar: "--a", value: "var(--b)" };
    const b = { name: "B", cssVar: "--b", value: "var(--a)" };
    expect(resolveVarColor("var(--a)", tokens(a, b))).toEqual({
      kind: "unresolved",
      name: "--a",
      reason: "cycle",
    });
  });

  it("does not call a token unresolved while the list is loading or failed", () => {
    expect(resolveVarColor("var(--brand)", { status: "loading" })).toEqual({
      kind: "unresolved",
      name: "--brand",
      reason: "loading",
    });
    expect(resolveVarColor("var(--brand)", undefined)).toMatchObject({
      reason: "loading",
    });
    expect(resolveVarColor("var(--brand)", { status: "error" })).toEqual({
      kind: "unresolved",
      name: "--brand",
      reason: "failed",
    });
  });
});

describe("findToken", () => {
  it("finds a token only in a loaded list", () => {
    expect(findToken(tokens(brand), "--brand")).toBe(brand);
    expect(findToken(tokens(brand), "--other")).toBeNull();
    expect(findToken({ status: "loading" }, "--brand")).toBeNull();
    expect(findToken(undefined, "--brand")).toBeNull();
  });
});

describe("filterTokens", () => {
  const list = [
    brand,
    link,
    { name: "Surface", cssVar: "--bg", value: "#fff" },
  ];

  it("keeps the list when the query is blank", () => {
    expect(filterTokens(list, "  ")).toEqual(list);
  });

  it("matches the name, the custom property and the value, ignoring case", () => {
    expect(filterTokens(list, "BRAND").map((t) => t.cssVar)).toEqual([
      "--brand",
      "--link",
    ]);
    expect(filterTokens(list, "--bg").map((t) => t.name)).toEqual(["Surface"]);
    expect(filterTokens(list, "#336699").map((t) => t.name)).toEqual(["Brand"]);
    expect(filterTokens(list, "zzz")).toEqual([]);
  });
});
