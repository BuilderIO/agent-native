import { setClientAppState } from "@agent-native/core/client/hooks";

import {
  DESIGN_EDITOR_COMMAND_EVENT,
  designEditorCommandKeysForTab,
  type DesignEditorCommand,
} from "@/hooks/use-navigation-state";

/**
 * Applies a navigate command issued in this tab to the editor showing its
 * design as soon as it is issued, before the editor writes its own state back
 * over the address the command set, then clears the stored copy the command
 * also left. A command the editor can't apply yet stays stored for the editor
 * to pick up later. Returns the unsubscribe.
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
