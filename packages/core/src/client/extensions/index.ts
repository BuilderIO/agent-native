export { ExtensionsSidebarSection } from "./ExtensionsSidebarSection.js";
export {
  ExtensionViewer,
  type ExtensionViewerProps,
} from "./ExtensionViewer.js";
export {
  ExtensionEditor,
  type ExtensionEditorProps,
} from "./ExtensionEditor.js";
export { ExtensionsListPage } from "./ExtensionsListPage.js";
export { ExtensionViewerPage } from "./ExtensionViewerPage.js";
export {
  EmbeddedExtension,
  type EmbeddedExtensionProps,
} from "./EmbeddedExtension.js";
export { ExtensionSlot, type ExtensionSlotProps } from "./ExtensionSlot.js";

// ─────────────────────────────────────────────────────────────────────────────
// Legacy aliases — these names predate the Tools → Extensions rename. Keep
// exporting them so deployed templates that haven't been updated still
// resolve. Use the canonical `Extension*` names in new code.
// ─────────────────────────────────────────────────────────────────────────────

export { ExtensionsSidebarSection as ToolsSidebarSection } from "./ExtensionsSidebarSection.js";
export {
  ExtensionViewer as ToolViewer,
  type ExtensionViewerProps as ToolViewerProps,
} from "./ExtensionViewer.js";
export {
  ExtensionEditor as ToolEditor,
  type ExtensionEditorProps as ToolEditorProps,
} from "./ExtensionEditor.js";
export { ExtensionsListPage as ToolsListPage } from "./ExtensionsListPage.js";
export { ExtensionViewerPage as ToolViewerPage } from "./ExtensionViewerPage.js";
export {
  EmbeddedExtension as EmbeddedTool,
  type EmbeddedExtensionProps as EmbeddedToolProps,
} from "./EmbeddedExtension.js";
