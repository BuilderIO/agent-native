import { getBrowserTabId } from "@agent-native/core/client/hooks";

/** Stable per-tab identity for request-source and ambient app-state scoping. */
export const TAB_ID = getBrowserTabId();
