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
export function useAgentKitStopButton(options: {
  /** Called when stopping a run fails, so the host can tell the user it is still running. */
  onError: (error: Error) => void;
}) {
  const t = useT();
  const thread = useAgentThread();
  const control = useAgentKitControl();
  if (thread.activeRunIds.length === 0) return undefined;
  const label = t("agentChat.composer.stopResponse");
  return (
    <button
      type="button"
      onClick={() => {
        void Promise.all(
          thread.activeRunIds.map((runId) => control.cancel(runId)),
        ).catch((error: unknown) => {
          options.onError(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      }}
      aria-label={label}
      title={label}
      data-agent-composer-slot="stop-button"
      className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
    >
      <IconPlayerStopFilled className="h-3 w-3" />
    </button>
  );
}
