export type ModelPartGroup =
  | "shell"
  | "overlay"
  | "content"
  | "agent"
  | "primitive";

/**
 * A part a model row can name. Sub-parts are rows nested in the part
 * (`sidebar.item`); a part set gives each its own markup.
 */
export interface ModelPart {
  name: string;
  group: ModelPartGroup;
  subParts: readonly string[];
}

const part = (
  group: ModelPartGroup,
  name: string,
  subParts: readonly string[] = [],
): ModelPart => ({ name, group, subParts });

/**
 * Version 1 of the model vocabulary, shared by every app and part set. It is
 * frozen: a new part or sub-part changes the snapshot in `parts.spec.ts`.
 */
export const MODEL_PARTS: readonly ModelPart[] = [
  part("shell", "app-shell", [
    "nav",
    "topbar",
    "main",
    "aside",
    "banner",
    "overlays",
    "skeleton",
    "split",
  ]),
  part("shell", "sidebar", [
    "header",
    "item",
    "section",
    "tree",
    "rail",
    "footer",
    "resize-handle",
    "slot",
  ]),
  part("shell", "page-header"),
  part("shell", "toolbar"),
  part("shell", "filter-bar"),
  part("shell", "tabs"),
  part("shell", "search"),
  part("shell", "command-palette"),
  part("shell", "shortcuts-panel"),
  part("shell", "settings", [
    "nav",
    "nav-group",
    "nav-item",
    "group",
    "row",
    "content",
    "section",
    "notice",
    "report",
  ]),
  part("overlay", "menu"),
  part("overlay", "popover"),
  part("overlay", "picker"),
  part("overlay", "select"),
  part("overlay", "date-picker"),
  part("overlay", "dialog"),
  part("overlay", "toast"),
  part("overlay", "tooltip"),
  part("overlay", "banner"),
  part("overlay", "form"),
  part("overlay", "file-upload"),
  part("overlay", "empty-state"),
  part("overlay", "skeleton"),
  part("content", "list", ["section", "row"]),
  part("content", "card"),
  part("content", "table"),
  part("content", "data-grid"),
  part("content", "board"),
  part("content", "timeline"),
  part("content", "calendar-view"),
  part("content", "chart"),
  part("content", "inspector"),
  part("content", "property-list"),
  part("content", "activity-feed"),
  part("content", "rich-text-editor"),
  part("agent", "chat-thread"),
  part("agent", "composer"),
  part("agent", "agent-panel"),
  part("primitive", "button"),
  part("primitive", "input"),
  part("primitive", "checkbox"),
  part("primitive", "switch"),
  part("primitive", "badge"),
  part("primitive", "avatar"),
  part("primitive", "kbd"),
];

/** Every reference a row can name: `sidebar`, `sidebar.item`, ... */
export function modelPartRefs(
  parts: readonly ModelPart[] = MODEL_PARTS,
): Set<string> {
  const refs = new Set<string>();
  for (const { name, subParts } of parts) {
    refs.add(name);
    for (const sub of subParts) refs.add(`${name}.${sub}`);
  }
  return refs;
}
