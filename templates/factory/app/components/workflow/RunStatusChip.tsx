import {
  IconCircleCheck,
  IconCircleX,
  IconLoader2,
  IconPlayerPause,
  type Icon,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import type {
  RunStatus,
  RunTriggerKind,
} from "../../../server/workflow/contract.js";
import { useWorkflowStrings } from "./workflow-strings";

const ICONS: Record<RunStatus, Icon> = {
  running: IconLoader2,
  succeeded: IconCircleCheck,
  failed: IconCircleX,
  paused: IconPlayerPause,
};

// Color stays on the states that need a person; a finished run is quiet.
const STYLES: Record<RunStatus, string> = {
  running: "bg-muted text-foreground",
  succeeded: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
  paused: "bg-muted text-foreground",
};

export function RunStatusChip({
  status,
  triggerKind,
  className,
}: {
  status: RunStatus;
  /** Shown before the status for any run the schedule did not start, so a test never reads as the real thing. */
  triggerKind?: RunTriggerKind;
  className?: string;
}) {
  const ws = useWorkflowStrings();

  const StatusIcon = ICONS[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium leading-none",
        STYLES[status],
        className,
      )}
    >
      <StatusIcon
        className={cn(
          "size-3",
          status === "running" && "motion-safe:animate-spin",
        )}
        aria-hidden
      />
      {triggerKind && triggerKind !== "schedule"
        ? `${ws.runKind[triggerKind]} · `
        : null}
      {ws.runStatus[status]}
    </span>
  );
}
