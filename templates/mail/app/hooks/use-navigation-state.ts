import { useSemanticNavigationState } from "@agent-native/core/client";
import { useCallback, useState } from "react";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  threadId?: string;
  focusedEmailId?: string;
  selectedThreadIds?: string[];
  search?: string;
  label?: string;
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
      requestSource: TAB_ID,
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
