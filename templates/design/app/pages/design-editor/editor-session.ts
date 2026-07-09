import { generateTabId } from "@agent-native/core/client";

/** Stable for the lifetime of this module, including editor component refreshes. */
export const TAB_ID = generateTabId();

/** Yjs origin tracked by the local undo manager. */
export const LOCAL_EDIT_ORIGIN = `${TAB_ID}:local`;
