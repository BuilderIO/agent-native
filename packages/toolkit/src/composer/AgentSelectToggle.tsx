import { IconPointer } from "@tabler/icons-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import {
  subscribeAgentSelectRejections,
  toggleAgentSelectMode,
} from "./agent-select.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import { useAgentSelectMode } from "./use-agent-select.js";

/**
 * The composer's Select toggle. Renders nothing until the host app registers
 * a selectable object with `useAgentSelectable`.
 */
export function AgentSelectToggle() {
  const t = useComposerRuntimeAdapters().translate!;
  const { active, available } = useAgentSelectMode();
  const offered = available > 0;

  useEffect(() => {
    if (!offered) return;
    return subscribeAgentSelectRejections(({ reason }) => {
      toast.error(
        reason === "too-many-items"
          ? t("agentChat.composer.selectContextFull", {
              defaultValue:
                "Context is full. Remove an item before selecting another.",
            })
          : t("agentChat.composer.selectContextTooLarge", {
              defaultValue: "That object is too large to add as context.",
            }),
        { id: "agent-select-rejected" },
      );
    });
  }, [offered, t]);

  if (!offered) return null;
  const label = t("agentChat.composer.select", { defaultValue: "Select" });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-agent-composer-slot="select-button"
          onClick={toggleAgentSelectMode}
          aria-label={label}
          aria-pressed={active}
          className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 ${
            active
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          }`}
        >
          <IconPointer className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
