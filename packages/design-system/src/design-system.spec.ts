import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Color from "colorjs.io";
import { describe, expect, it } from "vitest";

import { PARTS, reservedClassNames } from "./catalog/parts.js";
import { appearancesCss, paletteCss, themeCss } from "./css.js";
import { generatedStylesheets } from "./generated-css.js";
import {
  agentNativeTheme,
  APP_THEMES,
  SHADCN_SLOTS,
  shadcnTheme,
  THEMES,
} from "./themes/index.js";
import { createPalette, STATUS_ROLES, toHslTriplet } from "./tokens/palette.js";
import {
  DENSITIES,
  densityTokens,
  ROLE_GROUPS,
  SHAPE_TOKEN_NAMES,
} from "./tokens/roles.js";

const cssDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../css",
);

describe("createPalette", () => {
  const theme = createPalette({ brand: "#5b5bd6" });

  it.each(["light", "dark"] as const)(
    "writes every scale step in %s, in sRGB and P3",
    (appearance) => {
      const { srgb, p3 } = theme[appearance];
      for (const scale of ["gray", "brand", ...STATUS_ROLES]) {
        for (let step = 1; step <= 12; step++) {
          expect(srgb[`--${scale}-${step}`], `${scale}-${step}`).toMatch(
            /^#[0-9a-f]{6}$/,
          );
          expect(srgb[`--${scale}-a${step}`], `${scale}-a${step}`).toMatch(
            /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/,
          );
          expect(p3[`--${scale}-${step}`], `${scale}-${step} p3`).toMatch(
            /^oklch\(/,
          );
          expect(p3[`--${scale}-a${step}`], `${scale}-a${step} p3`).toMatch(
            /^color\(display-p3 /,
          );
        }
        expect(srgb[`--${scale}-contrast`]).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(
        ["background", "panel", "field", "overlay"].filter(
          (base) => !srgb[`--base-${base}`],
        ),
      ).toEqual([]);
    },
  );

  it("keeps the brand color itself as step 9", () => {
    expect(theme.light.srgb["--brand-9"]).toBe("#5b5bd6");
  });

  it("writes shadcn triplets in the H S% L% form templates consume", () => {
    for (const value of Object.values(theme.light.legacy)) {
      expect(value).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/);
    }
    expect(theme.light.legacy["--primary"]).toBe(toHslTriplet("#5b5bd6"));
  });

  it("throws on an unparseable color instead of falling back", () => {
    expect(() => createPalette({ brand: "not-a-color" })).toThrow(
      /Unsupported accent color/,
    );
    expect(() => createPalette({ brand: "#5b5bd6", gray: "nope" })).toThrow(
      /Unsupported gray color/,
    );
  });

  it("accepts a Radix scale name or any color for each status", () => {
    const named = createPalette({
      brand: "#000",
      status: { danger: "tomato" },
    });
    const custom = createPalette({
      brand: "#000",
      status: { danger: "#d6409f" },
    });
    expect(named.light.srgb["--danger-9"]).not.toBe(
      custom.light.srgb["--danger-9"],
    );
    expect(custom.light.srgb["--danger-9"]).toBe("#d6409f");
  });
});

describe("density", () => {
  const px = (value: string | undefined) => Number(value?.replace(/px$/, ""));

  it.each(DENSITIES)("%s keeps every length on the 4px grid", (density) => {
    for (const [name, value] of Object.entries(densityTokens(density))) {
      if (!value.endsWith("px")) continue;
      expect(px(value) % 4, `${name}: ${value}`).toBe(0);
    }
  });

  it.each(DENSITIES)(
    "%s keeps every size and spacing step distinct",
    (density) => {
      const tokens = densityTokens(density);
      const heights = ["1", "2", "3", "4"].map((size) =>
        px(tokens[`--control-height-${size}`]),
      );
      const space = Array.from({ length: 9 }, (_, index) =>
        px(tokens[`--space-${index + 1}`]),
      );
      expect(new Set(heights).size).toBe(heights.length);
      expect(new Set(space).size).toBe(space.length);
      expect([...space].sort((a, b) => a - b)).toEqual(space);
    },
  );

  it("changes spacing, never control heights", () => {
    const heights = (density: (typeof DENSITIES)[number]) =>
      ["1", "2", "3", "4"].map(
        (size) => densityTokens(density)[`--control-height-${size}`],
      );
    expect(heights("compact")).toEqual(heights("default"));
    expect(heights("comfortable")).toEqual(heights("default"));
    expect(heights("default")).toEqual(["16px", "20px", "24px", "32px"]);
  });
});

describe("themes", () => {
  const roleNames = Object.values(ROLE_GROUPS).flat();
  const slotRead = new RegExp(`var\\(--(?:${SHADCN_SLOTS.join("|")})[,)]`);

  it("has exactly one default theme", () => {
    expect(THEMES.filter((theme) => theme.isDefault)).toHaveLength(1);
  });

  it.each(THEMES.map((theme) => [theme.name, theme]))(
    "%s defines every role in every appearance, and every shape",
    (_name, theme) => {
      for (const appearance of [theme.base, theme.dark, theme.light]) {
        expect(roleNames.filter((role) => !appearance[role])).toEqual([]);
      }
      expect(SHAPE_TOKEN_NAMES.filter((shape) => !theme.tokens[shape])).toEqual(
        [],
      );
    },
  );

  it.each(THEMES.map((theme) => [theme.name, theme]))(
    "%s reads no shadcn variable: it owns its values",
    (_name, theme) => {
      expect(themeCss(theme)).not.toMatch(slotRead);
    },
  );

  it.each(
    THEMES.filter((theme) => !theme.readsScales).map((theme) => [
      theme.name,
      theme,
    ]),
  )(
    "%s draws its parts from scales made of its own primary",
    (_name, theme) => {
      for (const appearance of ["light", "dark"] as const) {
        const primary = theme[appearance]["--theme-primary"];
        if (!primary) throw new Error(`expected a ${appearance} primary`);
        const step9 = theme.palette[appearance].srgb["--brand-9"];
        if (!step9) throw new Error(`expected a ${appearance} brand step 9`);
        expect(
          new Color(`hsl(${primary})`).deltaE(step9, "2000"),
          `${appearance} step 9 ${step9} vs primary ${primary}`,
        ).toBeLessThan(2);
      }
      const scoped = themeCss(theme).slice(themeCss(theme).indexOf("@scope"));
      expect(scoped).toContain("--accent-1: var(--brand-1);");
      expect(scoped).toMatch(/--brand-9: #[0-9a-f]{6};/);
    },
  );

  it("leaves a data-palette element and its contents on the palette's scales", () => {
    const design = APP_THEMES.find((theme) => theme.name === "design");
    if (!design) throw new Error("expected the design theme");
    const css = themeCss(design, [agentNativeTheme, design]);
    const scaleRules = css
      .split("}")
      .filter((rule) => rule.includes("--brand-9:"));
    expect(scaleRules.length).toBeGreaterThan(0);
    for (const rule of scaleRules) {
      const selectors = (rule.split("{").at(-2) ?? "").trim();
      for (const selector of selectors
        .split(",\n")
        .map((part) => part.trim())) {
        expect(selector).toMatch(
          /:not\(\[data-palette\], \[data-palette\] \*\)$/,
        );
      }
    }
  });

  it("resolves a slot fallback and refuses a slot the theme lacks", () => {
    const base = { background: "0 0% 100%", foreground: "0 0% 10%" };
    expect(() =>
      shadcnTheme({ name: "partial", label: "Partial", values: { base } }),
    ).toThrow(/Theme partial has no "\w[\w-]*"/);
  });

  it("resets the default theme's tokens so a nested theme starts clean", () => {
    const defaultTheme = THEMES.find((theme) => theme.isDefault);
    const baseline = THEMES.find((theme) => theme.name === "baseline");
    if (!defaultTheme || !baseline) {
      throw new Error("expected the default and baseline themes");
    }
    const withExtra = {
      ...defaultTheme,
      tokens: { ...defaultTheme.tokens, "--shape-extra": "3px" },
    };
    expect(themeCss(baseline, [withExtra, baseline])).toContain(
      "--shape-extra: initial;",
    );
  });
});

// oracle-change(packages/toolkit/src/app/styles/theme-families.spec.ts): the Agent-Native palette and its precedence over appearance tints moved from theme-families.css into the agent-native theme and appearancesCss, checked here
describe("agent-native theme and appearance tints", () => {
  it("carries the shared Agent-Native palette in light and dark", () => {
    expect(agentNativeTheme.base["--theme-background"]).toBe("0 0% 100%");
    expect(agentNativeTheme.dark["--theme-background"]).toBe("0 0% 13%");
    expect(agentNativeTheme.scopedOnly?.base["--font-sans"]).toBe(
      "var(--font-family-sans)",
    );
  });

  it("writes the Agent-Native extras only in its scope, so app themes keep toolkit's defaults", () => {
    const design = APP_THEMES.find((theme) => theme.name === "design");
    if (!design) throw new Error("expected the design theme");
    const own = themeCss(agentNativeTheme);
    const unscoped = own.slice(0, own.indexOf("@scope"));
    const app = themeCss(design, [agentNativeTheme, design]);
    for (const key of [
      "--font-sans",
      "--radius-xl",
      "--shadow-composer",
      "--agent-kit-composer-radius",
      "--agent-kit-composer-elevation",
    ]) {
      expect({ key, unscoped: unscoped.includes(`${key}:`) }).toEqual({
        key,
        unscoped: false,
      });
      expect({
        key,
        scoped: own.slice(own.indexOf("@scope")).includes(`${key}:`),
      }).toEqual({ key, scoped: true });
      expect({ key, inApp: app.includes(`${key}:`) }).toEqual({
        key,
        inApp: false,
      });
    }
  });

  it("tints the active theme's own values in both appearances", () => {
    const css = appearancesCss();
    expect(css).toContain(
      ':root[data-appearance="warm"]:not([data-app-theme="agent-native"])',
    );
    expect(css).toContain(
      ':root.dark[data-appearance="warm"]:not([data-app-theme="agent-native"])',
    );
    expect(css).toContain("--theme-primary: 25 65% 45%;");
    expect(css).not.toMatch(/^\s+--primary:/m);
  });

  it("leaves the Agent-Native theme untinted", () => {
    for (const rule of appearancesCss().match(/^:root[^{]*\{/gm) ?? []) {
      expect(rule).toContain(':not([data-app-theme="agent-native"])');
    }
  });
});

describe("paletteCss", () => {
  const palette = createPalette({ brand: "#e5484d" });

  it("scopes to the palette id and covers both appearances and P3", () => {
    const css = paletteCss(palette, { id: "acme" });
    expect(css).toContain(
      ':scope:where(:root:not(.dark), .light)[data-palette="acme"]',
    );
    expect(css).toContain(':scope:where(.dark)[data-palette="acme"]');
    expect(css).toContain("@media (color-gamut: p3)");
  });

  it("writes no shadcn values: only themes write those", () => {
    expect(paletteCss(palette, { id: "acme" })).not.toContain("--primary:");
  });

  it("rejects an id that could break out of the selector", () => {
    expect(() =>
      paletteCss(palette, { id: 'x"] * { color: red } [x="' }),
    ).toThrow(TypeError);
  });
});

describe("generated stylesheets", () => {
  it.each(Object.entries(generatedStylesheets()))(
    "css/%s is up to date",
    (file, contents) => {
      expect(readFileSync(path.join(cssDir, file), "utf8")).toBe(contents);
    },
  );
});

describe("part catalog", () => {
  const STYLED = PARTS.filter(
    (entry) => entry.status !== "planned" && entry.stylesheet !== false,
  );

  it("reserves each class name once", () => {
    const names = reservedClassNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("reserves every class a part's CSS defines", () => {
    const reserved = new Set(reservedClassNames());
    for (const part of STYLED) {
      const css = readFileSync(
        path.join(cssDir, "parts", `${part.name}.css`),
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, "");
      const pattern = new RegExp(
        `\\.(${part.name}(?:-[a-z]+)*)(?![\\w-])`,
        "g",
      );
      for (const [, className] of css.matchAll(pattern)) {
        expect({ className, reserved: reserved.has(className) }).toEqual({
          className,
          reserved: true,
        });
      }
    }
  });

  const runtimeReads: Readonly<Record<string, readonly string[]>> = {
    accordion: ["--accordion-panel-height"],
    collapsible: ["--collapsible-panel-height"],
    drawer: [
      "--drawer-swipe-movement-x",
      "--drawer-swipe-movement-y",
      "--drawer-swipe-progress",
      "--drawer-swipe-strength",
    ],
    "split-pane": ["--split-pane-preview", "--split-pane-size"],
    toast: [
      "--toast-height",
      "--toast-index",
      "--toast-frontmost-height",
      "--toast-offset-y",
      "--toast-swipe-movement-x",
      "--toast-swipe-movement-y",
      "--toast-clamped-height",
      "--toast-expanded-y",
      "--toast-gap",
      "--toast-line-inset",
      "--toast-peek",
      "--toast-scale",
      "--toast-shrink",
    ],
  };

  const prefixes = PARTS.map((owner) => "--" + owner.name + "-");
  const normalizeCss = (css: string) =>
    css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\( | \)/g, (delimiter) => delimiter.trim())
      .replace(/\s*,\s*/g, ",");

  it.each(STYLED.map((part) => [part.name, part] as const))(
    "%s documents its part-prefixed CSS reads and defaults",
    (name, part) => {
      const css = normalizeCss(
        readFileSync(path.join(cssDir, "parts", name + ".css"), "utf8"),
      );
      const reads = new Set(
        [...css.matchAll(/var\((--[\w-]+)/g)]
          .map((match) => match[1])
          .filter(
            (property) =>
              property &&
              prefixes.some((prefix) => property.startsWith(prefix)),
          ),
      );
      const runtime = runtimeReads[name] ?? [];
      const inputs = Object.entries(part.cssInputs ?? {});
      expect([...reads].sort()).toEqual(
        [...inputs.map(([key]) => key), ...runtime].sort(),
      );
      for (const [property, input] of inputs) {
        expect(input.description.trim()).not.toBe("");
        expect(css).toContain(
          normalizeCss(`var(${property}, ${input.fallback})`),
        );
      }
    },
  );

  it("sets text color from a text role, never a gray step", () => {
    const steps = STYLED.flatMap((part) => {
      const css = readFileSync(
        path.join(cssDir, "parts", `${part.name}.css`),
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, "");
      return [...css.matchAll(/(?<![\w-])color:\s*var\(--gray-a?\d+\)/g)].map(
        ([declaration]) => `${part.name}: ${declaration}`,
      );
    });
    expect(steps).toEqual([]);
  });

  it("ships CSS for every part it marks available", () => {
    for (const part of STYLED) {
      const css = readFileSync(
        path.join(cssDir, "parts", `${part.name}.css`),
        "utf8",
      );
      expect({
        part: part.name,
        styled: css.includes(`.${part.name}`),
      }).toEqual({ part: part.name, styled: true });
    }
  });
});
