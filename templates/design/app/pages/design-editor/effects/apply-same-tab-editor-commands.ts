import { setClientAppState } from "@agent-native/core/client/hooks";

import {
  DESIGN_EDITOR_COMMAND_EVENT,
  designEditorCommandKeysForTab,
  type DesignEditorCommand,
} from "@/hooks/use-navigation-state";

/**
 * Whether following the command's path keeps this editor mounted. A path to
 * another route (from /visual-edit/<id> to /design/<id>, say) opens a new
 * editor, which needs the stored copy for what the address doesn't carry.
 */
function keepsCurrentEditor(path: string | undefined): boolean {
  if (!path) return true;
  const target = new URL(path, window.location.href);
  return (
    target.origin === window.location.origin &&
    target.pathname === window.location.pathname
  );
}

/**
 * Applies a navigate command issued in this tab to the editor showing its
 * design as soon as it is issued, before the editor writes its own state back
 * over the address the command set, then clears the stored copy the command
 * also left. A command the editor can't apply yet, or one whose path opens
 * another editor, stays stored for that editor to pick up. Returns the
 * unsubscribe.
 */
export function applySameTabEditorCommands(args: {
  designId: string;
  browserTabId?: string;
  apply: (command: DesignEditorCommand) => boolean;
}): () => void {
  const handleCommand = (event: Event) => {
    const command = (event as CustomEvent<DesignEditorCommand | undefined>)
      .detail;
    if (!command || command.designId !== args.designId) return;
    if (!keepsCurrentEditor(command.path)) return;
    if (!args.apply(command)) return;
    for (const key of designEditorCommandKeysForTab(args.browserTabId)) {
      // coercion-ok: command cleanup is best effort after applying it.
      setClientAppState(key, null).catch(() => {});
    }
  };
  window.addEventListener(DESIGN_EDITOR_COMMAND_EVENT, handleCommand);
  return () => {
    window.removeEventListener(DESIGN_EDITOR_COMMAND_EVENT, handleCommand);
  };
}
