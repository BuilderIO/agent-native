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
  badge?: "screen";
}

/** Code editor commands get their own section after the canvas categories. */
export type ShortcutSectionCategory = DesignShortcutCategory | "code";

export interface ShortcutSection {
  category: ShortcutSectionCategory;
  label: string;
  rows: ShortcutRow[];
}

export const CODE_SHORTCUT_COMMAND_IDS: readonly string[] = [
  "workbench.save",
  "workbench.saveAll",
  "workbench.quickOpen",
  "workbench.commandPalette",
  "workbench.search",
  "workbench.explorer",
  "workbench.toggleSidebar",
  "workbench.nextTab",
  "workbench.previousTab",
  "editor.gotoSymbol",
  "editor.gotoLine",
];

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
  categoryLabel: (category: ShortcutSectionCategory) => string;
  rowLabel: (labelKey: string) => string;
  codeCommands: readonly CodeShortcutCommand[];
  /** Design shortcut ids whose tool is not available right now (a lab that is off). */
  unavailableIds?: readonly string[];
}): ShortcutSection[] {
  const needle = normalizeQuery(query);
  const codeRows = codeCommands
    .filter(
      (command) =>
        CODE_SHORTCUT_COMMAND_IDS.includes(command.id) &&
        command.keybindings?.length,
    )
    .map(
      (command): ShortcutRow => ({
        id: command.id,
        source: "code",
        label: command.title,
        bindings: command.keybindings ?? [],
      }),
    );
  const categories: ShortcutSectionCategory[] = [
    ...DESIGN_SHORTCUT_CATEGORIES,
    "code",
  ];
  return categories.flatMap((category) => {
    const label = categoryLabel(category);
    const rows: ShortcutRow[] =
      category === "code"
        ? codeRows
        : DESIGN_SHORTCUTS.filter(
            (item) =>
              item.category === category &&
              !unavailableIds.includes(item.id) &&
              (applePlatform || !item.appleOnly),
          ).map(
            (item): ShortcutRow => ({
              id: item.id,
              source: "design",
              label: rowLabel(item.labelKey),
              bindings: item.bindings,
              badge: item.context === "screen" ? "screen" : undefined,
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
