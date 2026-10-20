import { IconAlertTriangle, IconPlugConnectedX } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorkflowIssue } from "@/lib/workflow-editor";

import { providerName } from "./node-kinds";
import { useWorkflowCanvasStrings } from "./strings";

/** A problem marker: the sentences live in the tooltip, so the graph stays uncluttered. */
export function IssueMark({
  issues,
  portLabel,
  className,
}: {
  issues: WorkflowIssue[];
  portLabel?: (issue: WorkflowIssue) => string | undefined;
  className?: string;
}) {
  const s = useWorkflowCanvasStrings();

  if (issues.length === 0) return null;
  const sentences = issues.map((issue) =>
    s.issue.sentence(issue, portLabel?.(issue)),
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={sentences.join(" ")}
          className={cn(
            "nodrag flex size-5 shrink-0 items-center justify-center rounded-full text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <IconAlertTriangle className="size-4" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <ul className="flex flex-col gap-1">
          {sentences.map((sentence, index) => (
            <li key={`${index}:${sentence}`}>{sentence}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** A provider this step needs that is not connected. Connected steps carry no mark. */
export function ConnectionMark({
  providers,
  className,
}: {
  providers: readonly string[];
  className?: string;
}) {
  const s = useWorkflowCanvasStrings();

  if (providers.length === 0) return null;
  const sentences = providers.map((provider) =>
    s.notConnected(providerName(provider)),
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={sentences.join(" ")}
          className={cn(
            "nodrag flex size-5 shrink-0 items-center justify-center rounded-full text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <IconPlugConnectedX className="size-4" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <ul className="flex flex-col gap-1">
          {sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
