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
export {
  InlineExtensionFrame,
  type InlineExtensionDefinition,
  type InlineExtensionFrameProps,
} from "./InlineExtensionFrame.js";
export { ExtensionSlot, type ExtensionSlotProps } from "./ExtensionSlot.js";
export {
  deleteOrHideExtension,
  hideExtensionForCurrentUser,
  invalidateExtensionRemoval,
  type ExtensionDeleteResult,
  type ExtensionDeleteTarget,
} from "./delete-extension.js";
export {
  EXTENSION_SLUG_MAX_LENGTH,
  extensionIdFromPathname,
  extensionNameToSlug,
  extensionPath,
  isExtensionPathname,
} from "../../extensions/path.js";
export {
  AgentNativeExtensionFrame,
  AgentNativeExtensionSlot,
  type AgentNativeExtensionFrameProps,
  type AgentNativeExtensionPermissionList,
  type AgentNativeExtensionSlotProps,
  type AgentNativeExtensionStorageScopeList,
} from "./AgentNativeExtensionFrame.js";
export {
  AGENT_NATIVE_EXTENSION_MESSAGE_TYPES,
  buildAgentNativeExtensionHtml,
  createHttpAgentNativeExtensionStorage,
  createLocalStorageAgentNativeExtensionStorage,
  getAgentNativeExtensionManifest,
  isAgentNativeExtensionAllowedInSlot,
  normalizeAgentNativeExtensionSandbox,
  type AgentNativeExtensionDefinition,
  type AgentNativeExtensionManifest,
  type AgentNativeExtensionMessageType,
  type AgentNativeExtensionStorage,
  type AgentNativeExtensionStorageContext,
  type AgentNativeExtensionStorageOptions,
  type AgentNativeExtensionStorageRow,
  type AgentNativeExtensionStorageScope,
  type BuildAgentNativeExtensionHtmlOptions,
  type CreateHttpAgentNativeExtensionStorageOptions,
} from "./portable-extension.js";

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
