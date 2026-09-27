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

export {
  getAppStateEmitter,
  emitAppStateChange,
  emitAppStateDelete,
  type AppStateEvent,
} from "./emitter.js";

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
