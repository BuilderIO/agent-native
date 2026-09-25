import { icons } from "@tabler/icons-react";
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
