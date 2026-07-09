import { generateTabId } from "@agent-native/core/client";

/** Stable for the lifetime of this module, including editor component refreshes. */
export const TAB_ID = generateTabId();

/**
 * Persistence revisions live on a DesignEditor component instance. Give that
 * instance its own operation source too: reusing module-stable TAB_ID after an
 * editor remount would pair reset revision counters with the server's old
 * high-watermark and make fresh saves look stale.
 */
export function createEditorSaveOperationSource(
  tabId = TAB_ID,
  editorInstanceId = generateTabId(),
): string {
  return `${tabId}:save:${editorInstanceId}`;
}

/** Yjs origin tracked by the local undo manager. */
export const LOCAL_EDIT_ORIGIN = `${TAB_ID}:local`;
