import { hasActiveAgentRuns } from "@agent-native/agentkit";
import { IconPlayerStopFilled } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Tooltip } from "../../../design-system/index.js";
import {
  useAgentKitControl,
  useAgentKitSubmissionStarting,
  useAgentThread,
} from "./context.js";

// Once a draft brings Send back beside Stop, Send keeps the primary fill and
// Stop steps down to secondary, so the row never shows two identical
// primaries.
const STOP_BESIDE_SEND =
  "[[data-agent-composer-slot=toolbar]:has([data-agent-composer-slot=send-button])_&]:bg-secondary [[data-agent-composer-slot=toolbar]:has([data-agent-composer-slot=send-button])_&]:text-secondary-foreground";

// Stands in for the run key while a submission has no run id yet, so the
// deferred stop stays busy across the run registering.
const STARTING_RUN_KEY = "\u0000starting";

/**
 * The composer's primary action while a turn is in progress, from the moment
 * its send is accepted. AgentKitComposer falls back to it when the host
 * supplies no stop button of its own.
 */
export function useAgentKitStopButton(options: {
  /** The accessible name and tooltip, already localized by the host. */
  label: string;
  /** Called when stopping a run fails, so the host can tell the user it is still running. */
  onError: (error: Error) => void;
  /** Runs before cancelling; resolving `false` keeps the run going. */
  beforeCancel?: () => boolean | Promise<boolean>;
  /** Defaults to the provider's thread. */
  threadId?: string;
}) {
  const thread = useAgentThread(options.threadId);
  const control = useAgentKitControl(options.threadId);
  const running = hasActiveAgentRuns(thread);
  const starting = useAgentKitSubmissionStarting(options.threadId);
  const activeRunKey = running
    ? thread.activeRunIds.join("\u0000")
    : STARTING_RUN_KEY;
  // Keyed to the runs being stopped, so a run that starts while a cancel is in
  // flight (a queued follow-up) gets an enabled Stop of its own.
  const [stoppingRunKey, setStoppingRunKey] = useState<string | null>(null);
  const stopping =
    stoppingRunKey !== null &&
    (stoppingRunKey === activeRunKey || stoppingRunKey === STARTING_RUN_KEY);
  // A second click lands before React re-renders the disabled button.
  const stoppingRef = useRef<string | null>(null);
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const beforeCancelRef = useRef(options.beforeCancel);
  beforeCancelRef.current = options.beforeCancel;
  if (!running && !starting) return undefined;
  const { label } = options;
  return (
    <Tooltip
      content={label}
      trigger={
        <button
          type="button"
          onClick={() => {
            if (stoppingRef.current === activeRunKey) return;
            const runKey = activeRunKey;
            stoppingRef.current = runKey;
            setStoppingRunKey(runKey);
            const release = () => {
              if (stoppingRef.current !== runKey) return;
              stoppingRef.current = null;
              setStoppingRunKey(null);
            };
            const knownRunIds = running ? thread.activeRunIds : undefined;
            void (async () => {
              const beforeCancel = beforeCancelRef.current;
              if (beforeCancel && (await beforeCancel()) === false) return;
              const runIds = knownRunIds ?? (await control.runIdsOnceStarted());
              await Promise.all(runIds.map((runId) => control.cancel(runId)));
            })()
              .catch((error: unknown) => {
                onErrorRef.current(
                  error instanceof Error ? error : new Error(String(error)),
                );
              })
              .finally(release);
          }}
          aria-label={label}
          aria-busy={stopping || undefined}
          disabled={stopping}
          data-agent-composer-slot="stop-button"
          className={`flex size-[var(--agentkit-composer-primary-control-size,2rem)] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,background-color,color] duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-35 ${STOP_BESIDE_SEND}`}
        >
          <IconPlayerStopFilled aria-hidden="true" className="size-4" />
        </button>
      }
    />
  );
}
