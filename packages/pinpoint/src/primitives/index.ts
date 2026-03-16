// @agent-native/pinpoint — Primitives API
// MIT License
//
// Standalone exports for agent-initiated element inspection.
// These functions work independently of the UI workflow.

export { buildElementContext as getElementContext } from "../detection/element-info.js";
export { extractElementInfo } from "../detection/element-info.js";
export { buildSelector } from "../detection/selector-builder.js";
export { openFile } from "../utils/open-file.js";
export {
  getComponentInfo,
  getSourceLocation,
  detectFramework,
} from "../frameworks/adapter.js";

// Re-export freeze primitives (lazy — don't patch anything until called)
export { freeze, unfreeze, isFreezeActive } from "../freeze/controller.js";

// Re-export storage for direct pin access
export { FileStore } from "../storage/file-store.js";
export { MemoryStore } from "../storage/memory-store.js";
