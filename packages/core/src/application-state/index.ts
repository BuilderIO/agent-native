export {
  appStateGet,
  appStateGetMany,
  appStateGetManyEntries,
  appStatePut,
  appStateDelete,
  appStateCompareAndSet,
  appStateCompareAndSetMany,
  appStateList,
  appStateListUpdatedAt,
  appStateDeleteByPrefix,
  type AppStateCompareAndSetOperation,
} from "./store.js";

export {
  browserTabUsedKey,
  findLastUsedBrowserTab,
  LAST_USED_BROWSER_TAB_MAX_AGE_MS,
} from "./last-used-tab.js";

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
  MAX_APP_STATE_BATCH_WRITES,
  putState,
  putStateMany,
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
  resolveCurrentRequestStateTab,
} from "./script-helpers.js";
