import {
  SIDEBAR_STATE_CHANGE_EVENT,
  type AgentSidebarStateChangeDetail,
} from "@agent-native/core/client/agent-chat";
import { IconMessageCircle, IconPlus, type Icon } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useWorkflowCanvasStrings } from "./strings";

/**
 * Whether the agent sidebar is open. The sidebar announces each change but not
 * its state on mount, so a sidebar already open when this mounts reads as closed
 * until it changes.
 */
function useAgentPanelOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (
        event as CustomEvent<AgentSidebarStateChangeDetail | undefined>
      ).detail;
      if (detail && typeof detail.open === "boolean") setOpen(detail.open);
    };
    window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, onChange);
  }, []);
  return open;
}

/** One dashed tile with its label under it. The whole column is the button. */
function EmptyChoice({
  icon: ChoiceIcon,
  label,
  active,
  onClick,
}: {
  icon: Icon;
  label: string;
  /** Its panel is open, so the tile keeps a halo. */
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="group h-auto w-[100px] flex-col gap-2 p-0 font-normal whitespace-normal hover:bg-transparent"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[100px] items-center justify-center rounded-lg border-2 border-dashed border-border bg-card text-muted-foreground transition-colors group-hover:bg-muted motion-reduce:transition-none",
          active && "ring-[7px] ring-foreground/10",
        )}
      >
        <ChoiceIcon className="size-10" />
      </span>
      <span className="-mx-2 w-[116px] text-center text-base leading-6 text-foreground">
        {label}
      </span>
    </Button>
  );
}

/**
 * What an empty canvas offers: a tile that adds the first step and, when the
 * agent is available, a tile that hands a description to it, with "or" between.
 */
export function EmptyCanvasTile({
  onAddFirstStep,
  onDescribe,
  addActive = false,
}: {
  onAddFirstStep: () => void;
  onDescribe?: () => void;
  /** The step panel is open, so the first tile keeps its halo. */
  addActive?: boolean;
}) {
  const s = useWorkflowCanvasStrings();
  const agentOpen = useAgentPanelOpen();

  return (
    <div className="flex items-start">
      <EmptyChoice
        icon={IconPlus}
        label={s.canvasActions.addFirstStep}
        active={addActive}
        onClick={onAddFirstStep}
      />
      {onDescribe && (
        <>
          <span className="flex h-[100px] w-6 items-center justify-center text-base text-muted-foreground">
            {s.canvasActions.or}
          </span>
          <EmptyChoice
            icon={IconMessageCircle}
            label={s.canvasActions.describeTile}
            active={agentOpen}
            onClick={onDescribe}
          />
        </>
      )}
    </div>
  );
}
