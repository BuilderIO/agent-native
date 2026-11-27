import type { ShellModel } from "../app-shell/contracts.js";

export interface HouseShellChoice {
  id: string;
  entityKey?: string | undefined;
  choice:
    | "native-choice"
    | "keyboard-resize"
    | "keyboard-reorder"
    | "compact-navigation"
    | "mobile-drawer";
  reason: string;
}
/** Register these with app comparison evidence; accessibility differences stay explicit. */
export function houseShellChoices(model: ShellModel): HouseShellChoice[] {
  const choices: HouseShellChoice[] = [];
  const visit = (entries: typeof model.navigation.entries) => {
    for (const entry of entries) {
      if (entry.choices)
        choices.push({
          id: entry.id,
          entityKey: entry.entityKey,
          choice: "native-choice",
          reason: "Ordered choices use a native select.",
        });
      if (
        entry.subPart === "sidebar.resize-handle" &&
        model.navigation.resize?.policy.keyboard === false
      )
        choices.push({
          id: entry.id,
          entityKey: entry.entityKey,
          choice: "keyboard-resize",
          reason:
            "The house separator adds arrow, Shift, Home and End access to the same resize intents and range.",
        });
      visit(entry.children ?? []);
      visit(entry.trailingActions ?? []);
    }
  };
  visit(model.navigation.entries);
  for (const section of model.navigation.sections) {
    visit(section.entries);
    if (section.reorder?.policy.keyboard === false)
      choices.push({
        id: section.id,
        entityKey: section.entityKey,
        choice: "keyboard-reorder",
        reason:
          "House reorder handles add Space, arrows and Escape access to the same preview and commit intents.",
      });
  }
  for (const region of model.regions) {
    if (region.subPart === "app-shell.nav") {
      choices.push({
        id: region.id,
        entityKey: region.entityKey,
        choice: "compact-navigation",
        reason:
          "Collapsed navigation uses a 56px house rail and the controlled peek state expands it.",
      });
      choices.push({
        id: region.id,
        entityKey: region.entityKey,
        choice: "mobile-drawer",
        reason:
          "Below 768px the controlled mobile opener presents navigation in a focus-trapped sheet.",
      });
    }
    visit(region.actions ?? []);
  }
  return choices;
}
