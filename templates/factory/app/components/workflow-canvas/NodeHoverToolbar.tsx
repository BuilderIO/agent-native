import {
  IconCopy,
  IconDots,
  IconFlask,
  IconTrash,
  type Icon,
} from "@tabler/icons-react";
import { NodeToolbar, Position } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkflowStrings } from "@/components/workflow/workflow-strings";

import { DropdownMenuEntries, type MenuEntry } from "./NodeContextMenu";
import { useWorkflowCanvasStrings } from "./strings";

/**
 * Step actions that float above a step while it is hovered, focused or
 * selected. The padding under the bar is part of its hover area, so the pointer
 * can travel up to the bar without losing it.
 */
export function NodeHoverToolbar({
  nodeId,
  menu,
  menuOpen,
  onMenuOpenChange,
  onTestStep,
  onDuplicate,
  onDelete,
  onHoverChange,
}: {
  nodeId: string;
  /** The same rows as the step's right-click menu. */
  menu: readonly MenuEntry[];
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onTestStep?: (nodeId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onHoverChange: (over: boolean) => void;
}) {
  const s = useWorkflowCanvasStrings();
  const ws = useWorkflowStrings();

  return (
    <NodeToolbar nodeId={nodeId} isVisible position={Position.Top} offset={0}>
      <div
        className="workflow-step-toolbar flex flex-col items-center pb-3"
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-100">
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
          {/* Not modal: a modal menu inside the canvas can leave the page without pointer events. */}
          <DropdownMenu
            modal={false}
            open={menuOpen}
            onOpenChange={onMenuOpenChange}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={ws.toolbar.moreActions}
                  >
                    <IconDots />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{ws.toolbar.moreActions}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuEntries entries={menu} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
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
