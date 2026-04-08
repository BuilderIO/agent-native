// Public API for @agent-native/core/collab

// Storage
export {
  loadYDocState,
  saveYDocState,
  hasCollabState,
  deleteCollabState,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "./storage.js";

// YDoc manager
export {
  getDoc,
  applyUpdate,
  applyText,
  getText,
  getState,
  getIncUpdate,
  seedFromText,
  releaseDoc,
  searchAndReplace,
} from "./ydoc-manager.js";

// XmlFragment operations
export { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";

// Text-to-Yjs bridge
export { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";

// Emitter
export {
  getCollabEmitter,
  emitCollabUpdate,
  type CollabEvent,
} from "./emitter.js";

// Route handlers
export {
  getCollabState,
  postCollabUpdate,
  postCollabText,
  postCollabSearchReplace,
} from "./routes.js";
