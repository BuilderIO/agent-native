// @agent-native/pinpoint — Main entry point (Node/universal)
// MIT License

// Types
export type {
  Pin,
  PinStatus,
  ElementInfo,
  FrameworkInfo,
  ElementContext,
  ComponentInfo,
  SourceLocation,
  Plugin,
  PluginHooks,
  ContextMenuAction,
  PinpointAPI,
  PinpointConfig,
  PinStorage,
  OutputFormat,
  CopyContext,
  FrameworkAdapter,
  PinEvent,
  DrawStroke,
  DrawToolType,
  TextNote,
  QueuedAnnotation,
  ToolbarMode,
  AgentOutput,
} from "./types/index.js";

// Storage (browser-safe only — FileStore is in @agent-native/pinpoint/server)
export { MemoryStore, RestClient } from "./storage/index.js";
export {
  PinSchema,
  ElementInfoSchema,
  FrameworkInfoSchema,
} from "./storage/schemas.js";

// Detection
export { ElementPicker } from "./detection/element-picker.js";
export { buildSelector } from "./detection/selector-builder.js";
export {
  extractElementInfo,
  buildElementContext,
} from "./detection/element-info.js";
export { DragSelect } from "./detection/drag-select.js";
export { TextSelect } from "./detection/text-select.js";

// Frameworks
export {
  registerAdapter,
  detectFramework,
  getComponentInfo,
  getSourceLocation,
} from "./frameworks/adapter.js";
export { reactAdapter } from "./frameworks/react-adapter.js";
export { vueAdapter } from "./frameworks/vue-adapter.js";
export { genericAdapter } from "./frameworks/generic-adapter.js";

// Output
export { formatPins } from "./output/formatter.js";
export {
  formatPinsForAgent,
  formatQueueForAgent,
  formatRichPinContext,
} from "./output/agent-context.js";

// Plugins
export {
  registerPlugin,
  unregisterPlugin,
  getPlugins,
  dispatchHook,
} from "./plugins/registry.js";
export { agentNativePlugin } from "./plugins/agent-native-plugin.js";

// Freeze
export { freeze, unfreeze, isFreezeActive } from "./freeze/controller.js";

// Security (browser-safe — path-validation is server-only)
export { escapeHtml, sanitizeString } from "./security/input-sanitization.js";
export { isAllowedOrigin } from "./security/origin-validation.js";

// Utils
export { openFile } from "./utils/open-file.js";
