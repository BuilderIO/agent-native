import { getBrowserTabId } from "@agent-native/core/client/hooks";

/** Unique ID for this browser tab — used to tag API requests so the
 *  poll system can tell the UI to ignore its own writes. */
export const TAB_ID = getBrowserTabId();
