import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import type { ParkedCounts } from "@/components/workflow-canvas/parked-counts-context";

import type { ParkedList } from "../../../server/workflow-host/read-models.js";
import { useWorkflowStrings } from "./workflow-strings";

/** The page re-reads a run at this cadence while it is going, and the waiting counts follow it. */
const RUN_WATCH_INTERVAL_MS = 1_500;

/**
 * Items waiting at each Wait in one workflow, keyed by node id, for the canvas
 * badges. The counts are read again while a run is going, and once more when it
 * ends, since a run can move items out of a Wait. Null until a read succeeds.
 */
export function useParkedCounts({
  factoryId,
  workflowId,
  running,
}: {
  factoryId: string;
  workflowId: string;
  running: boolean;
}): ParkedCounts | null {
  const ws = useWorkflowStrings();
  const query = useActionQuery<ParkedList>(
    "list-parked-items",
    { factoryId, workflowId, limit: 1 },
    { refetchInterval: running ? RUN_WATCH_INTERVAL_MS : false },
  );
  const { data, isError, refetch } = query;

  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void refetch();
    wasRunning.current = running;
  }, [running, refetch]);

  // A failed read must not look like a Wait with nothing parked, so the failure is said.
  const failedText = ws.list.countsFailed;
  useEffect(() => {
    if (isError) toast.error(failedText);
  }, [isError, failedText]);

  return useMemo(
    () =>
      data
        ? new Map<string, number>(
            data.byNode.map((row) => [row.nodeId, row.count]),
          )
        : null,
    [data],
  );
}
