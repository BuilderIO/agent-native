import {
  DESIGN_SHORTCUT_CATEGORIES,
  DESIGN_SHORTCUTS,
  type DesignShortcutCategory,
  formatShortcutKeycaps,
} from "@/components/design/keyboard-shortcuts";

export interface CodeShortcutCommand {
  id: string;
  title: string;
  keybindings?: readonly string[];
}

export interface ShortcutRow {
  id: string;
  source: "design" | "code";
  label: string;
  bindings: readonly string[];
  badge?: "screen" | "code";
}

export interface ShortcutSection {
  category: DesignShortcutCategory;
  label: string;
  rows: ShortcutRow[];
}

export const CODE_CATEGORY_BY_COMMAND: Record<string, DesignShortcutCategory> =
  {
    "workbench.save": "edit",
    "workbench.saveAll": "edit",
    "workbench.quickOpen": "edit",
    "workbench.commandPalette": "edit",
    "workbench.search": "edit",
    "workbench.explorer": "view",
    "workbench.toggleSidebar": "view",
    "workbench.nextTab": "selection",
    "workbench.previousTab": "selection",
    "editor.gotoSymbol": "selection",
    "editor.gotoLine": "selection",
  };

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
  codeCommands,
  unavailableIds = [],
}: {
  query: string;
  applePlatform: boolean;
  categoryLabel: (category: DesignShortcutCategory) => string;
  rowLabel: (labelKey: string) => string;
  codeCommands: readonly CodeShortcutCommand[];
  /** Design shortcut ids whose tool is not available right now (a lab that is off). */
  unavailableIds?: readonly string[];
}): ShortcutSection[] {
  const needle = normalizeQuery(query);
  return DESIGN_SHORTCUT_CATEGORIES.flatMap((category) => {
    const label = categoryLabel(category);
    const rows: ShortcutRow[] = [
      ...DESIGN_SHORTCUTS.filter(
        (item) =>
          item.category === category && !unavailableIds.includes(item.id),
      ).map(
        (item): ShortcutRow => ({
          id: item.id,
          source: "design",
          label: rowLabel(item.labelKey),
          bindings: item.bindings,
          badge: item.context === "screen" ? "screen" : undefined,
        }),
      ),
      ...codeCommands
        .filter(
          (command) =>
            CODE_CATEGORY_BY_COMMAND[command.id] === category &&
            command.keybindings?.length,
        )
        .map(
          (command): ShortcutRow => ({
            id: command.id,
            source: "code",
            label: command.title,
            bindings: command.keybindings ?? [],
            badge: "code",
          }),
        ),
    ];
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
