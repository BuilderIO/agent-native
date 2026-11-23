import { sampleDatasetPage } from "./sample-catalog.js";

const SAMPLE_PAGE_SIZE = 1000;

export function filterCatalogResources<
  Resource extends { id: string; name: string },
>(resources: Resource[], search: string, builtin: boolean): Resource[] {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return resources;
  if (builtin) {
    const ids = new Set(
      sampleDatasetPage({
        first: SAMPLE_PAGE_SIZE,
        search: normalized,
      }).items.map((item) => item.id),
    );
    return resources.filter((resource) => ids.has(resource.id));
  }
  return resources.filter((resource) =>
    resource.name.toLowerCase().includes(normalized),
  );
}
