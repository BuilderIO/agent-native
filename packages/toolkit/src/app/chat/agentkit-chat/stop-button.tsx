import { useT } from "@agent-native/core/client/i18n";
import { IconPlayerStopFilled } from "@tabler/icons-react";

import {
  useAgentKitControl,
  useAgentThread,
} from "../../agentkit/react/context.js";

/**
 * The composer's primary action while a run is active. A host that renders
 * AgentKitChat directly has no way to stop a run without it: the composer only
 * shows what the host supplies.
 */
export function useAgentKitStopButton() {
  const t = useT();
  const thread = useAgentThread();
  const control = useAgentKitControl();
  if (thread.activeRunIds.length === 0) return undefined;
  const label = t("agentChat.composer.stopResponse");
  return (
    <button
      type="button"
      onClick={() =>
        void Promise.all(
          thread.activeRunIds.map((runId) => control.cancel(runId)),
        )
      }
      aria-label={label}
      title={label}
      data-agent-composer-slot="stop-button"
      className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
    >
      <IconPlayerStopFilled className="h-3 w-3" />
    </button>
  );
}
