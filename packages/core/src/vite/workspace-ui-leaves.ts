/**
 * Presentational leaves with no Toolkit provider, application, or feature dependency.
 * Keep coupled wrappers on the automatic route-aware chunker: combining them
 * can make optional feature code an initial dependency through chunk cycles.
 */
export const WORKSPACE_UI_LEAVES = [
  "accordion",
  "alert",
  "aspect-ratio",
  "avatar",
  "badge",
  "breadcrumb",
  "button-group",
  "card",
  "checkbox",
  "collapsible",
  "command",
  "context-menu",
  "cube-loader",
  "dialog",
  "drawer",
  "dropdown-menu",
  "empty",
  "filter-trigger",
  "form",
  "hover-card",
  "input",
  "input-otp",
  "item",
  "kbd",
  "label",
  "logo",
  "menubar",
  "modal-layer",
  "navigation-menu",
  "popover",
  "progress",
  "radio-group",
  "resizable",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "skeleton",
  "slider",
  "spinner",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toast",
  "toggle",
  "toggle-group",
  "tooltip",
] as const;

const leaves = new Set<string>(WORKSPACE_UI_LEAVES);

export function isWorkspaceUiLeaf(id: string): boolean {
  const match =
    /(?:^|[\\/])packages[\\/]toolkit[\\/](?:src|dist)[\\/]ui[\\/]([^\\/]+)\.(?:[cm]?[jt]sx?)$/.exec(
      id,
    );
  const leaf = match?.[1];
  return leaf !== undefined && leaves.has(leaf);
}
