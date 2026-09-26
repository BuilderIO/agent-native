// MIT License

export { buildElementContext as getElementContext } from "../detection/element-info.js";
export { extractElementInfo } from "../detection/element-info.js";
export { buildSelector } from "../detection/selector-builder.js";
export { openFile } from "../utils/open-file.js";
export {
  getComponentInfo,
  getSourceLocation,
  detectFramework,
} from "../frameworks/adapter.js";

export { freeze, unfreeze, isFreezeActive } from "../freeze/controller.js";

export { MemoryStore } from "../storage/memory-store.js";
