/** Unique ID for this browser tab — used to tag API requests so the
 *  poll system can tell the UI to ignore its own writes. */
export const TAB_ID = Math.random().toString(36).slice(2, 10);
