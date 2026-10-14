import type {
  SettingsPageDefinition,
  SettingsPageIcon,
  SettingsPageSearchEntry,
} from "./registry.js";

export interface SettingsSearchResult {
  id: string;
  label: string;
  /** "Group › Page", or the group alone for a page result. */
  where: string;
  page: string;
  sub: string | null;
  anchor: string | null;
  icon: SettingsPageIcon;
  haystack: string;
}

export interface SettingsSearchPage {
  page: SettingsPageDefinition;
  label: string;
  groupLabel: string;
  entries: readonly SettingsPageSearchEntry[];
}

/**
 * The index is built from page declarations, never by rendering pages, so a
 * result exists for a page the viewer has not opened yet. Only pass pages the
 * viewer can see.
 */
export function buildSettingsSearchIndex(
  pages: readonly SettingsSearchPage[],
  translate: (key: string) => string,
): SettingsSearchResult[] {
  const results: SettingsSearchResult[] = [];
  const seen = new Set<string>();
  for (const { page, label, groupLabel, entries } of pages) {
    const pageWhere = groupLabel ? `${groupLabel} › ${label}` : label;
    const pageResultId = `page:${page.id}`;
    seen.add(pageResultId);
    results.push({
      id: pageResultId,
      label,
      where: groupLabel || label,
      page: page.id,
      sub: null,
      anchor: null,
      icon: page.icon,
      haystack: `${label} ${groupLabel} ${page.keywords ?? ""}`.toLowerCase(),
    });
    // Today's tabs often repeat their own name, or a row the page declares, as
    // a section entry; the first result with that name on the page covers it.
    const pageLabels = new Set([label.toLowerCase()]);
    for (const entry of entries) {
      const entryLabel = entry.labelKey
        ? translate(entry.labelKey)
        : (entry.label ?? "");
      const id = `${page.id}:${entry.id}`;
      if (
        !entryLabel ||
        seen.has(id) ||
        pageLabels.has(entryLabel.toLowerCase())
      ) {
        continue;
      }
      seen.add(id);
      pageLabels.add(entryLabel.toLowerCase());
      results.push({
        id,
        label: entryLabel,
        where: pageWhere,
        page: page.id,
        sub: entry.sub ?? null,
        anchor: entry.anchor ?? null,
        icon: page.icon,
        haystack:
          `${entryLabel} ${entry.keywords ?? ""} ${pageWhere}`.toLowerCase(),
      });
    }
  }
  return results;
}

export function searchSettings(
  index: readonly SettingsSearchResult[],
  query: string,
): SettingsSearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const terms = trimmed.split(/\s+/).filter(Boolean);
  return index
    .filter((entry) => terms.every((term) => entry.haystack.includes(term)))
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(trimmed) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(trimmed) ? 0 : 1;
      return aStarts - bStarts || a.label.localeCompare(b.label);
    });
}
