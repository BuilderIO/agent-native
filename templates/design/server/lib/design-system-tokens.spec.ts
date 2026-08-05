import { describe, expect, it } from "vitest";

import { assertStorableDesignSystemTokens } from "./design-system-tokens.js";

const token = {
  name: "interactive-01",
  cssVar: "--cds-interactive-01",
  value: "#0F62FE",
  type: "color",
};

describe("assertStorableDesignSystemTokens", () => {
  it("accepts a kit with no tokens key", () => {
    expect(() =>
      assertStorableDesignSystemTokens(JSON.stringify({ colors: {} })),
    ).not.toThrow();
  });

  it("accepts an explicitly empty vocabulary", () => {
    expect(() =>
      assertStorableDesignSystemTokens(JSON.stringify({ tokens: [] })),
    ).not.toThrow();
  });

  it("accepts named tokens", () => {
    expect(() =>
      assertStorableDesignSystemTokens(JSON.stringify({ tokens: [token] })),
    ).not.toThrow();
  });

  it("rejects invalid JSON", () => {
    expect(() => assertStorableDesignSystemTokens("{")).toThrow(
      /valid JSON object string/,
    );
  });

  it("rejects a JSON array", () => {
    expect(() => assertStorableDesignSystemTokens("[]")).toThrow(
      /valid JSON object string/,
    );
  });

  it("rejects a tokens value that is not an array", () => {
    expect(() =>
      assertStorableDesignSystemTokens(
        JSON.stringify({ tokens: { "--a": "#fff" } }),
      ),
    ).toThrow(/cannot be stored/);
  });

  it("fails the write rather than storing the storable subset", () => {
    expect(() =>
      assertStorableDesignSystemTokens(
        JSON.stringify({
          tokens: [token, { name: "bad", cssVar: "nope", value: "#fff" }],
        }),
      ),
    ).toThrow(/nope \(unsafe-css-var\)/);
  });

  it("names a value that would break out of the :root block", () => {
    expect(() =>
      assertStorableDesignSystemTokens(
        JSON.stringify({
          tokens: [{ name: "x", cssVar: "--x", value: "red; color: blue" }],
        }),
      ),
    ).toThrow(/--x \(unsafe-value\)/);
  });

  it("counts a single bad entry in the singular", () => {
    expect(() =>
      assertStorableDesignSystemTokens(
        JSON.stringify({ tokens: [{ cssVar: "nope", value: "#fff" }] }),
      ),
    ).toThrow(/1 entry that cannot be stored/);
  });
});
