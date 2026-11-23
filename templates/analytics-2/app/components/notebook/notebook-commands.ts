import {
  IconBrandPython,
  IconChartBar,
  IconHash,
  IconMarkdown,
  IconSql,
  IconTable,
  IconTableOptions,
  IconTypography,
} from "@tabler/icons-react";

import type { CellKind } from "@/lib/model/cell-types";

export const insertCommands = [
  { kind: "sql", key: "Q", labelKey: "notebookInsert.query", icon: IconSql },
  {
    kind: "code",
    key: "W",
    labelKey: "notebookInsert.python",
    icon: IconBrandPython,
  },
  {
    kind: "text",
    key: "E",
    labelKey: "notebookInsert.text",
    icon: IconTypography,
  },
  {
    kind: "markdown",
    key: "N",
    labelKey: "notebookInsert.markdown",
    icon: IconMarkdown,
  },
  {
    kind: "chart",
    key: "R",
    labelKey: "notebookInsert.chart",
    icon: IconChartBar,
  },
  {
    kind: "pivot",
    key: "V",
    labelKey: "notebookInsert.pivot",
    icon: IconTableOptions,
  },
  {
    kind: "metric",
    key: "U",
    labelKey: "notebookInsert.singleValue",
    icon: IconHash,
  },
  {
    kind: "display-table",
    key: "T",
    labelKey: "notebookInsert.table",
    icon: IconTable,
  },
] as const satisfies readonly {
  kind: CellKind;
  key: string;
  labelKey: string;
  icon: typeof IconSql;
}[];

export const notebookCommands = {
  insert: { key: "⌥A", labelKey: "notebookInsert.addCell" },
  commandMode: { key: "Esc", labelKey: "keyboardShortcuts.commandMode" },
  editMode: { key: "Enter", labelKey: "keyboardShortcuts.editMode" },
  addAbove: { key: "A", labelKey: "keyboardShortcuts.addAbove" },
  addBelow: { key: "B", labelKey: "keyboardShortcuts.addBelow" },
  deleteCell: { key: "DD", labelKey: "keyboardShortcuts.deleteCell" },
  fullScreen: { key: "FF", labelKey: "keyboardShortcuts.fullScreen" },
  formatSql: { key: "FS", labelKey: "keyboardShortcuts.formatSql" },
} as const;

export function notebookLetter(event: { code: string; key: string }): string {
  if (/^[A-Za-z]$/.test(event.key)) return event.key.toUpperCase();
  return /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : event.key.toUpperCase();
}
