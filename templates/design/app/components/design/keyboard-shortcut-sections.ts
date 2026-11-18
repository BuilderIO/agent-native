import {
  DESIGN_SHORTCUT_CATEGORIES,
  DESIGN_SHORTCUTS,
  type DesignShortcutCategory,
  formatShortcutKeycaps,
} from "@/components/design/keyboard-shortcuts";

export interface ShortcutRow {
  id: string;
  label: string;
  bindings: readonly string[];
  badge?: "screen";
}

export type ShortcutSectionCategory = DesignShortcutCategory;

export interface ShortcutSection {
  category: ShortcutSectionCategory;
  label: string;
  rows: ShortcutRow[];
}

function normalizeQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

function searchText(
  parts: readonly string[],
  bindings: readonly string[],
  applePlatform: boolean,
) {
  const keycaps = bindings.flatMap((binding) => [
    formatShortcutKeycaps(binding, applePlatform).join(" "),
    binding.split("+").join(" "),
  ]);
  return [...parts, ...keycaps].join(" ").toLocaleLowerCase();
}

/**
 * One section per category, in the catalog order. A category with no rows
 * after filtering is dropped, so the caller never renders an empty heading.
 */
export function buildShortcutSections({
  query,
  applePlatform,
  categoryLabel,
  rowLabel,
}: {
  query: string;
  applePlatform: boolean;
  categoryLabel: (category: ShortcutSectionCategory) => string;
  rowLabel: (labelKey: string) => string;
}): ShortcutSection[] {
  const needle = normalizeQuery(query);
  return DESIGN_SHORTCUT_CATEGORIES.flatMap((category) => {
    const label = categoryLabel(category);
    const rows: ShortcutRow[] = DESIGN_SHORTCUTS.filter(
      (item) =>
        item.category === category && (applePlatform || !item.appleOnly),
    ).map(
      (item): ShortcutRow => ({
        id: item.id,
        label: rowLabel(item.labelKey),
        bindings: item.bindings,
        ...(item.context === "screen" ? { badge: "screen" as const } : {}),
      }),
    );
    const visible = needle
      ? rows.filter((row) =>
          searchText([row.label, label], row.bindings, applePlatform).includes(
            needle,
          ),
        )
      : rows;
    return visible.length ? [{ category, label, rows: visible }] : [];
  });
}
