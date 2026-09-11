import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useSemanticNavigationState } from "@agent-native/core/client/navigation";
import { useCallback, useState } from "react";

export interface NavigationState {
  view: string;
  threadId?: string;
  focusedEmailId?: string;
  selectedThreadIds?: string[];
  search?: string;
  label?: string;
  filter?: string;
  activeInboxTab?: string;
  activeAccounts?: string[];
  queuedDraftId?: string;
  queueScope?: string;
  settingsSection?: string;
  composeDraftId?: string;
  _ts?: number;
}

/**
 * Returns `{ sync, command, clearCommand }` — mail manages navigation state
 * imperatively (callers drive what to write) rather than deriving it from the
 * URL, so this hook exposes write + read helpers instead of auto-syncing the
 * route.
 */
export function useNavigationState() {
  const [pendingState, setPendingState] = useState<NavigationState | null>(
    null,
  );

  const { command, clearCommand } = useSemanticNavigationState<NavigationState>(
    {
      state: pendingState,
      browserTabId: getBrowserTabId(),
      requestSource: getBrowserTabId(),
      writeDebounceMs: 500,
      onCommand: () => {
        // Command consumption is handled by callers via the returned
        // `command` and `clearCommand` helpers.
      },
    },
  );

  const sync = useCallback((state: NavigationState) => {
    setPendingState(state);
  }, []);

  return {
    sync,
    command: { data: command?.command ?? null },
    clearCommand,
  };
}
