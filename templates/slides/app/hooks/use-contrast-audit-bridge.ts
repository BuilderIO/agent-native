import {
  createAgentNativeBrowserSessionBridge,
  type AgentNativeClientAction,
} from "@agent-native/core/client/host";
import {
  CONTRAST_AUDIT_CLIENT_ACTION,
  CONTRAST_AUDIT_RESOURCE_TYPE,
  type ContrastAuditBrowserResult,
  type ContrastAuditRequest,
} from "@shared/contrast-audit";
import { useEffect, useRef } from "react";

import { runContrastAudit, type AuditableDeck } from "@/lib/contrast-audit";
import { TAB_ID } from "@/lib/tab-id";

export function useContrastAuditBridge(
  deck: AuditableDeck | null | undefined,
  designSystemData?: string | null,
): void {
  // Synced after commit, so the audit reads the version that is on screen.
  const deckRef = useRef<AuditableDeck | null>(null);
  useEffect(() => {
    deckRef.current = deck ? { ...deck, designSystemData } : null;
  }, [deck, designSystemData]);

  const deckId = deck?.id;
  useEffect(() => {
    if (!deckId) return;
    const action: AgentNativeClientAction<
      ContrastAuditRequest,
      ContrastAuditBrowserResult
    > = {
      name: CONTRAST_AUDIT_CLIENT_ACTION,
      description:
        "Run a text color-contrast audit on the deck open in this tab. Called by the audit-contrast action.",
      run: (request) => runContrastAudit(request, () => deckRef.current),
    };
    const bridge = createAgentNativeBrowserSessionBridge({
      session: { id: TAB_ID, label: "Slides editor" },
      label: "Slides editor",
      getContext: () => ({
        url: window.location.href,
        resource: { type: CONTRAST_AUDIT_RESOURCE_TYPE, id: deckId },
      }),
      actions: [action as AgentNativeClientAction],
    }).start();
    return () => bridge.stop();
  }, [deckId]);
}
