import { hasActiveAgentRuns } from "@agent-native/agentkit";
import { IconPlayerStopFilled } from "@tabler/icons-react";

import { useAgentKitControl, useAgentThread } from "./context.js";

/**
 * The composer's primary action while a run is active. A host that renders
 * AgentKitChat directly has no way to stop a run without it: the composer only
 * shows what the host supplies.
 */
export function useAgentKitStopButton(options: {
  /** The accessible name and tooltip, already localized by the host. */
  label: string;
  /** Called when stopping a run fails, so the host can tell the user it is still running. */
  onError: (error: Error) => void;
}) {
  const thread = useAgentThread();
  const control = useAgentKitControl();
  if (!hasActiveAgentRuns(thread)) return undefined;
  const { label } = options;
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
