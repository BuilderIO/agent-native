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

export { MemoryStore, RestClient } from "./storage/index.js";
export {
  PinSchema,
  ElementInfoSchema,
  FrameworkInfoSchema,
} from "./storage/schemas.js";

export { ElementPicker } from "./detection/element-picker.js";
export { buildSelector } from "./detection/selector-builder.js";
export {
  extractElementInfo,
  buildElementContext,
} from "./detection/element-info.js";
export { DragSelect } from "./detection/drag-select.js";
export { TextSelect } from "./detection/text-select.js";

export {
  registerAdapter,
  detectFramework,
  getComponentInfo,
  getSourceLocation,
} from "./frameworks/adapter.js";
export { reactAdapter } from "./frameworks/react-adapter.js";
export { vueAdapter } from "./frameworks/vue-adapter.js";
export { genericAdapter } from "./frameworks/generic-adapter.js";

export { formatPins } from "./output/formatter.js";
export {
  formatPinsForAgent,
  formatQueueForAgent,
  formatRichPinContext,
} from "./output/agent-context.js";

export {
  registerPlugin,
  unregisterPlugin,
  getPlugins,
  dispatchHook,
} from "./plugins/registry.js";
export { agentNativePlugin } from "./plugins/agent-native-plugin.js";

export { freeze, unfreeze, isFreezeActive } from "./freeze/controller.js";

export { escapeHtml, sanitizeString } from "./security/input-sanitization.js";
export { isAllowedOrigin } from "./security/origin-validation.js";

export { openFile } from "./utils/open-file.js";
