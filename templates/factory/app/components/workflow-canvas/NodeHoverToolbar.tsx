import { IconCopy, IconFlask, IconTrash, type Icon } from "@tabler/icons-react";
import { NodeToolbar, Position } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkflowStrings } from "@/components/workflow/workflow-strings";

import { useWorkflowCanvasStrings } from "./strings";

/**
 * Step actions that float above the selected step. Duplicate and delete are
 * the canvas's own commands, passed in, so this does what the bottom toolbar does.
 */
export function NodeHoverToolbar({
  nodeId,
  onTestStep,
  onDuplicate,
  onDelete,
}: {
  nodeId: string;
  onTestStep?: (nodeId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const s = useWorkflowCanvasStrings();
  const ws = useWorkflowStrings();

  return (
    <NodeToolbar
      nodeId={nodeId}
      position={Position.Top}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm"
    >
      {onTestStep && (
        <ToolbarIcon
          icon={IconFlask}
          label={ws.nodePanel.testStep}
          onClick={() => onTestStep(nodeId)}
        />
      )}
      <ToolbarIcon
        icon={IconCopy}
        label={s.nodeActions.duplicate}
        onClick={onDuplicate}
      />
      <ToolbarIcon
        icon={IconTrash}
        label={s.nodeActions.remove}
        onClick={onDelete}
      />
    </NodeToolbar>
  );
}

function ToolbarIcon({
  icon: ButtonIcon,
  label,
  onClick,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
        >
          <ButtonIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
