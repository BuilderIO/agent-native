// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Row 487/489 (legibility, 11-09): `context-studio.css` painted the studio rail
 * with `var(--ws-sidebar-bg, #fafafa)` and the selected row with
 * `var(--ws-active, #e8e8e8)`. Neither name is defined anywhere in the app's
 * stylesheets, so both fell back to their light literals: in the dark theme the
 * rail stayed #fafafa while the text tokens flipped to their dark values, and
 * the studio rail measured 1.2:1 and 1.94:1. `--ws-active`'s fallback was also
 * the rose the reviewer saw, because `settings.css` carried a rose literal.
 *
 * A custom property that nothing defines is invisible until a theme flips under
 * it, so this check reads the stylesheets the way the browser does: every
 * `--ws-*` a rule consumes must be declared, in both theme blocks.
 */
const APP = new URL(".", import.meta.url); // the app/ directory
const THEME_FILE = join(APP.pathname, "global.css");

// Runtime-injected names: a component sets these on an element's style prop, so
// they have no theme declaration by design.
const RUNTIME_SET: Record<string, string> = {
  "--ws-home-progress":
    "app/components/home/context-banner.tsx sets it inline from the setup progress percent",
};

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (entry.endsWith(".css")) out.push(path);
  }
  return out;
}

function consumedNames(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/var\(\s*(--ws-[a-z0-9-]+)/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined),
  );
}

/** Every `--ws-*` name some rule in this stylesheet declares. */
function declaredNames(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/(--ws-[a-z0-9-]+)\s*:/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined),
  );
}

/** The declarations inside one `:root` block, keyed by selector. */
function themeBlocks(css: string): Map<string, Set<string>> {
  const blocks = new Map<string, Set<string>>();
  for (const match of css.matchAll(/(:root[^{]*)\{([\s\S]*?)\n\}/g)) {
    const selector = match[1];
    const body = match[2];
    if (selector === undefined || body === undefined) continue;
    blocks.set(selector.trim(), declaredNames(body));
  }
  return blocks;
}

describe("workspace token coverage (row 487)", () => {
  const themeCss = readFileSync(THEME_FILE, "utf8");
  const blocks = themeBlocks(themeCss);
  const light =
    blocks.get(":root,\n:root.light") ?? blocks.get(":root, :root.light");
  const dark = blocks.get(":root.dark");

  it("declares the light and dark token blocks", () => {
    expect(light, "light :root block").toBeDefined();
    expect(dark, "dark :root block").toBeDefined();
  });

  it("declares every --ws-* name an app stylesheet consumes", () => {
    const files = cssFiles(APP.pathname);
    const declared = new Set<string>();
    for (const file of files) {
      for (const name of declaredNames(readFileSync(file, "utf8"))) {
        declared.add(name);
      }
    }
    const consumed = new Set<string>();
    for (const file of files) {
      for (const name of consumedNames(readFileSync(file, "utf8"))) {
        if (name in RUNTIME_SET) continue;
        consumed.add(name);
      }
    }
    const missing = [...consumed].filter((name) => !declared.has(name));
    expect(
      missing.sort(),
      "these --ws-* names fall back to a literal because no stylesheet declares them",
    ).toEqual([]);
  });

  it("keeps the light and dark token sets identical", () => {
    const onlyLight = [...(light ?? [])].filter((name) => !dark?.has(name));
    const onlyDark = [...(dark ?? [])].filter((name) => !light?.has(name));
    expect({ onlyLight: onlyLight.sort(), onlyDark: onlyDark.sort() }).toEqual({
      onlyLight: [],
      onlyDark: [],
    });
  });
});
