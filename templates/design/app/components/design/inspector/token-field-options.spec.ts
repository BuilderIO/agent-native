import { describe, expect, it } from "vitest";

import type { DesignToken } from "../edit-panel/design-color-tokens";
import {
  boundTokenVar,
  buildTokenFieldGroups,
  isNumericDraft,
  resolveTokenValue,
  tokenGroupShowsTier,
  unitlessTokenValue,
} from "./token-field-options";

const TOKENS: DesignToken[] = [
  { cssVar: "--space-1", value: "4px", type: "spacing" },
  { cssVar: "--space-14", value: "56px", type: "spacing" },
  { cssVar: "--space-page", value: "var(--space-14)", type: "spacing" },
  { cssVar: "--container-sm", value: "640px", type: "container" },
  { cssVar: "--font-size-xs", value: "12px", type: "font-size" },
  { cssVar: "--leading-tight", value: "1.2", type: "line-height" },
  { cssVar: "--tracking-tight", value: "-0.02em", type: "letter-spacing" },
  { cssVar: "--brand", value: "#0a6bd6", type: "color" },
];

describe("buildTokenFieldGroups", () => {
  it("lists only the accepted types, in the order given, aliases before scales", () => {
    const groups = buildTokenFieldGroups(TOKENS, ["container", "spacing"]);
    expect(
      groups.map((group) => [
        group.type,
        group.tier,
        group.options.map((o) => o.name),
      ]),
    ).toEqual([
      ["container", "primitive", ["container-sm"]],
      ["spacing", "semantic", ["space-page"]],
      ["spacing", "primitive", ["space-1", "space-14"]],
    ]);
  });

  it("shows exact names and unitless resolved values", () => {
    expect(buildTokenFieldGroups(TOKENS, ["spacing"])[0]).toMatchObject({
      options: [
        {
          cssVar: "--space-page",
          name: "space-page",
          value: "56",
          resolved: "56px",
        },
      ],
    });
    expect(
      buildTokenFieldGroups(TOKENS, ["letter-spacing"], "", "em"),
    ).toMatchObject([{ options: [{ value: "-0.02" }] }]);
    expect(buildTokenFieldGroups(TOKENS, ["letter-spacing"])).toMatchObject([
      { options: [{ value: "-0.02em" }] },
    ]);
  });

  it("filters by name or value", () => {
    const byName = buildTokenFieldGroups(TOKENS, ["spacing"], "page");
    expect(byName.flatMap((g) => g.options.map((o) => o.name))).toEqual([
      "space-page",
    ]);
    const byValue = buildTokenFieldGroups(TOKENS, ["spacing"], "56");
    expect(byValue.flatMap((g) => g.options.map((o) => o.name))).toEqual([
      "space-page",
      "space-14",
    ]);
  });

  it("skips aliases that cannot be resolved", () => {
    const groups = buildTokenFieldGroups(
      [{ cssVar: "--gap", value: "var(--missing)", type: "spacing" }],
      ["spacing"],
    );
    expect(groups).toEqual([]);
  });

  it("says primitives only when the type also has semantic tokens", () => {
    const mixed = buildTokenFieldGroups(TOKENS, ["spacing"]);
    expect(mixed.map((group) => tokenGroupShowsTier(group, mixed))).toEqual([
      false,
      true,
    ]);
    const plain = buildTokenFieldGroups(TOKENS, ["container"]);
    expect(plain.map((group) => tokenGroupShowsTier(group, plain))).toEqual([
      false,
    ]);
  });
});

describe("field helpers", () => {
  it("reads the bound token from an authored var()", () => {
    expect(boundTokenVar("var(--space-page)")).toBe("--space-page");
    expect(boundTokenVar("56px")).toBeNull();
    expect(boundTokenVar(undefined)).toBeNull();
  });

  it("tells numbers and arithmetic from token names", () => {
    expect(isNumericDraft("16")).toBe(true);
    expect(isNumericDraft("-2")).toBe(true);
    expect(isNumericDraft("(8+8)*2")).toBe(true);
    expect(isNumericDraft("")).toBe(true);
    expect(isNumericDraft("space")).toBe(false);
  });

  it("drops only the field's own unit and shows degrees as °", () => {
    expect(unitlessTokenValue("640px")).toBe("640");
    expect(unitlessTokenValue("1rem")).toBe("1rem");
    expect(unitlessTokenValue("1.5em", "em")).toBe("1.5");
    expect(unitlessTokenValue("1.5em")).toBe("1.5em");
    expect(unitlessTokenValue("40%")).toBe("40%");
    expect(unitlessTokenValue("90deg")).toBe("90°");
  });

  it("resolves a missing alias through its fallback, nested or literal", () => {
    const byVar = new Map(
      [{ cssVar: "--space-base", value: "16px", type: "spacing" }].map(
        (token) => [token.cssVar, token],
      ),
    );
    expect(resolveTokenValue("var(--missing, var(--space-base))", byVar)).toBe(
      "16px",
    );
    expect(resolveTokenValue("var(--missing, 8px)", byVar)).toBe("8px");
    expect(resolveTokenValue("var(--missing)", byVar)).toBeNull();
  });
});
