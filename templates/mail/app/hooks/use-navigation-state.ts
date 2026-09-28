import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useSemanticNavigationState } from "@agent-native/core/client/navigation";
import type { MailSortMode } from "@shared/ai-priority";
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
  tab?: string;
  activeAccounts?: string[];
  sort?: MailSortMode;
  queuedDraftId?: string;
  queueScope?: string;
  settingsSection?: string;
  composeDraftId?: string;
  _ts?: number;
}

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
