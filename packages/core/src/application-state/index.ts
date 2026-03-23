// Store
export {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
} from "./store.js";

// Emitter (for SSE wiring)
export {
  getAppStateEmitter,
  emitAppStateChange,
  emitAppStateDelete,
  type AppStateEvent,
} from "./emitter.js";

// H3 route handlers (for templates)
export {
  getState,
  putState,
  deleteState,
  listComposeDrafts,
  getComposeDraft,
  putComposeDraft,
  deleteComposeDraft,
  deleteAllComposeDrafts,
} from "./handlers.js";

// Script helpers
export {
  readAppState,
  writeAppState,
  deleteAppState,
  listAppState,
  deleteAppStateByPrefix,
} from "./script-helpers.js";
