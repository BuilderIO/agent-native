// Store
export {
  appStateGet,
  appStateGetMany,
  appStateGetManyEntries,
  appStatePut,
  appStateDelete,
  appStateCompareAndSet,
  appStateCompareAndSetMany,
  appStateList,
  appStateDeleteByPrefix,
  type AppStateCompareAndSetOperation,
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
  getStateMany,
  MAX_APP_STATE_BATCH_KEYS,
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
  compareAndSetAppState,
  compareAndSetManyAppState,
  listAppState,
  deleteAppStateByPrefix,
  readAppStateForCurrentTab,
  writeAppStateForCurrentTab,
  appStateKeyForBrowserTab,
  getCurrentRequestBrowserTabId,
} from "./script-helpers.js";
