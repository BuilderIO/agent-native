import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tokensCss } from "../css.js";
import { PARTS } from "./parts.js";
import { propTypesSource } from "./prop-types-source.js";
import {
  colorProp,
  COLORS,
  highContrastProp,
  propAttribute,
  propAttributes,
  RADII,
  CONTROL_SIZES,
  sizeProp,
  TEXT_SIZES,
  VARIANTS,
  variantProp,
} from "./props.js";

const defs = {
  size: sizeProp(["sm", "md"], "md"),
  variant: variantProp(["solid", "soft"], "solid"),
  color: colorProp,
  highContrast: highContrastProp,
};

describe("propAttributes", () => {
  it("writes each prop as its data attribute, defaults filled in", () => {
    expect(propAttributes(defs, {})).toEqual({
      "data-size": "md",
      "data-variant": "solid",
    });
    expect(
      propAttributes(defs, { size: "sm", color: "danger", highContrast: true }),
    ).toEqual({
      "data-size": "sm",
      "data-variant": "solid",
      "data-color": "danger",
      "data-high-contrast": "",
    });
  });

  it("reads only enumerable, own styling props", () => {
    const props = Object.create({ size: "sm" });
    Object.defineProperties(props, {
      highContrast: { value: true },
      children: {
        enumerable: true,
        get() {
          throw new Error("Unrelated prop was read");
        },
      },
    });
    expect(propAttributes(defs, props)).toEqual({
      "data-size": "md",
      "data-variant": "solid",
    });
  });

  it("throws on a value the definition doesn't allow", () => {
    expect(() => propAttributes(defs, { variant: "outline" })).toThrow(
      'variant="outline" is not one of solid, soft',
    );
    expect(() => propAttributes(defs, { size: 3 })).toThrow(TypeError);
  });

  it("names attributes in kebab case", () => {
    expect(propAttribute("highContrast")).toBe("data-high-contrast");
  });
});

describe("the catalog's props", () => {
  const shared: Record<string, readonly string[]> = {
    variant: VARIANTS,
    color: COLORS,
    radius: RADII,
    size: [...TEXT_SIZES, ...CONTROL_SIZES],
  };
  const defsOf = (part: (typeof PARTS)[number]) => [
    ...(part.props ? [["", part.props] as const] : []),
    ...Object.entries(part.subPartProps ?? {}),
  ];

  it.each(PARTS.map((part) => [part.name, part]))(
    "%s takes its variant, color, size and radius from the shared lists",
    (_name, part) => {
      for (const [sub, defs] of defsOf(part)) {
        for (const [prop, values] of Object.entries(shared)) {
          const def = new Map(Object.entries(defs)).get(prop);
          if (def?.type !== "enum") continue;
          for (const value of def.values) {
            expect(values, `${part.name} ${sub} ${prop}="${value}"`).toContain(
              value,
            );
          }
        }
        expect(Object.keys(defs)).not.toContain("intent");
        expect(Object.keys(defs)).not.toContain("emphasis");
      }
    },
  );
});

describe("color scopes", () => {
  const css = tokensCss();

  it.each(COLORS.filter((color) => color !== "accent"))(
    "binds the accent steps to the %s scale",
    (color) => {
      const scale = color === "gray" ? "gray" : color;
      expect(css).toContain(
        `[data-color="${color}"] {\n  --accent-1: var(--${scale}-1);`,
      );
    },
  );

  it("re-binds the accent on every selector that changes the primitives", () => {
    expect(css).toContain(
      ':root,\n.light,\n.dark,\n[data-palette],\n[data-color="accent"] {\n  --accent-1: var(--brand-1);',
    );
  });
});

describe("generated prop types", () => {
  it("are up to date with the catalog", () => {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "prop-types.generated.ts",
    );
    // source-read-ok: the generated file is the subject; this is its drift check
    expect(readFileSync(file, "utf8")).toBe(propTypesSource());
  });
});
