import type { ComponentType, SVGProps } from "react";

export type TablerIconComponent = ComponentType<
  Omit<SVGProps<SVGSVGElement>, "stroke"> & {
    size?: number | string;
    stroke?: number;
  }
>;

type TablerModule = Record<string, unknown>;
type ViteImportMeta = ImportMeta & { env: { SSR: boolean; MODE: string } };

export const TABLER_ICON_CATEGORIES = [
  "system",
  "communication",
  "document",
  "media",
  "design",
  "development",
  "devices",
  "computers",
  "database",
  "charts",
  "arrows",
  "shapes",
  "symbols",
  "text",
  "letters",
  "numbers",
  "math",
  "logic",
  "version-control",
  "extensions",
  "e-commerce",
  "currencies",
  "buildings",
  "map",
  "vehicles",
  "nature",
  "animals",
  "weather",
  "food",
  "health",
  "sport",
  "games",
  "photography",
  "mood",
  "gestures",
  "gender",
  "badges",
  "electrical",
  "laundry",
  "zodiac",
  "brand",
] as const;

export type TablerIconCategory = (typeof TABLER_ICON_CATEGORIES)[number];

export interface TablerCatalogEntry {
  name: string;
  category: TablerIconCategory;
  search: string;
}

let metadataPromise: Promise<TablerCatalogEntry[]> | undefined;

export function tablerExportName(name: string): string {
  return `Icon${name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
}

export async function loadTablerIcon(
  name: string,
): Promise<TablerIconComponent | null> {
  if (
    (import.meta as ViteImportMeta).env.SSR &&
    (import.meta as ViteImportMeta).env.MODE !== "test"
  ) {
    throw new Error("Tabler icons are available only in the browser");
  }
  const initial = name.charAt(0).toLowerCase();
  const { default: loaders } = await import("./tabler-chunk-loaders.js");
  const loadChunk = (
    loaders as Record<string, () => Promise<{ default: TablerModule }>>
  )[initial];
  if (!loadChunk) return null;
  const { default: catalog } = await loadChunk();
  const candidate = catalog[tablerExportName(name)];
  return typeof candidate === "object" || typeof candidate === "function"
    ? (candidate as TablerIconComponent)
    : null;
}

export async function searchTablerIcons(
  query: string,
  limit?: number,
): Promise<string[]> {
  const catalog = await loadTablerCatalog();
  const normalized = query.trim().toLowerCase();
  return catalog
    .filter((entry) => entry.search.includes(normalized))
    .map((entry) => entry.name)
    .slice(0, limit);
}

export function loadTablerCatalog(): Promise<TablerCatalogEntry[]> {
  if (
    (import.meta as ViteImportMeta).env.SSR &&
    (import.meta as ViteImportMeta).env.MODE !== "test"
  ) {
    throw new Error("Tabler catalog is available only in the browser");
  }
  metadataPromise ??= import("./tabler-catalog-data.js")
    .then(({ default: metadata }) => {
      return metadata
        .flatMap(([baseName, category, tags, styles]): TablerCatalogEntry[] => {
          if (
            !TABLER_ICON_CATEGORIES.includes(category as TablerIconCategory)
          ) {
            throw new Error(`Unknown Tabler icon category: ${category}`);
          }
          return styles.split(" ").map((style) => {
            const name = `${baseName}${style === "filled" ? "-filled" : ""}`;
            return {
              name,
              category: category as TablerIconCategory,
              search: [
                name,
                name.replaceAll("-", " "),
                category.replaceAll("-", " "),
                tags,
              ]
                .join(" ")
                .toLowerCase(),
            };
          });
        })
        .sort(
          (left, right) =>
            TABLER_ICON_CATEGORIES.indexOf(left.category) -
              TABLER_ICON_CATEGORIES.indexOf(right.category) ||
            left.name.localeCompare(right.name),
        );
    })
    .catch((error) => {
      metadataPromise = undefined;
      throw error;
    });
  return metadataPromise;
}
