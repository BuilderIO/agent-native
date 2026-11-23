import type { SidebarPartProps } from "@agent-native/toolkit/app-shell/sidebar-shell";

import { group, MenuRow } from "./entry";

export function ThemeMenuEntries({ model, effects }: SidebarPartProps) {
  return group(model.entries, "theme-choices").map((entry) =>
    entry.kind === "heading" ? (
      <div key={entry.id} className="ws-menu-heading">
        {entry.label}
      </div>
    ) : (
      <MenuRow key={entry.id} entry={entry} effects={effects} />
    ),
  );
}
