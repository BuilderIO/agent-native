import { icons } from "@tabler/icons-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  loadTablerCatalog,
  loadTablerIcon,
  searchTablerIcons,
  TABLER_ICON_CATEGORIES,
  tablerExportName,
} from "./catalog.js";
import { TABLER_ICON_GROUPS } from "./tabler-groups.js";

describe("Tabler catalog", () => {
  it("includes every canonical outline and filled icon once, with a renderable component", async () => {
    const catalog = await loadTablerCatalog();
    expect(catalog.map((entry) => tablerExportName(entry.name)).sort()).toEqual(
      Object.keys(icons).sort(),
    );
    expect(new Set(catalog.map((entry) => entry.name)).size).toBe(
      catalog.length,
    );
    expect(catalog.length).toBeGreaterThan(6_000);
    const components = await Promise.all(
      catalog.map((entry) => loadTablerIcon(entry.name)),
    );
    expect(components.every((component) => component !== null)).toBe(true);
    expect(new Set(catalog.map((entry) => entry.category))).toEqual(
      new Set(TABLER_ICON_CATEGORIES),
    );
  });

  it("renders every icon exactly as @tabler/icons-react does", async () => {
    const catalog = await loadTablerCatalog();
    const props = { size: 18, stroke: 1.5, className: "x", title: "t" };
    for (const { name } of catalog) {
      const exportName = tablerExportName(name);
      const tabler = icons[exportName as keyof typeof icons];
      const loaded = await loadTablerIcon(name);
      if (!loaded) throw new Error(`${name} did not load`);
      expect(loaded.displayName, name).toBe(tabler.displayName);
      expect(renderToStaticMarkup(createElement(loaded, props)), name).toBe(
        renderToStaticMarkup(createElement(tabler, props)),
      );
      expect(await loadTablerIcon(name)).toBe(loaded);
    }
  });

  it("does not truncate browsing or broad searches, and searches tags", async () => {
    expect(await searchTablerIcons("")).toHaveLength(
      (await loadTablerCatalog()).length,
    );
    expect((await searchTablerIcons("arrow")).length).toBeGreaterThan(120);
    expect(await searchTablerIcons("arrow", 12)).toHaveLength(12);
    expect(await searchTablerIcons("programming")).toContain("a-b");
    expect(await loadTablerIcon("not-a-real-icon")).toBeNull();
  });

  it("places every source category in exactly one reader-facing group", () => {
    const assigned = TABLER_ICON_GROUPS.flatMap((group) => group.categories);
    expect(assigned).toHaveLength(TABLER_ICON_CATEGORIES.length);
    expect(new Set(assigned)).toEqual(new Set(TABLER_ICON_CATEGORIES));
    expect(new Set(TABLER_ICON_GROUPS.map((group) => group.id)).size).toBe(
      TABLER_ICON_GROUPS.length,
    );
  });
});
