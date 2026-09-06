import { ComposerPrimitive } from "@assistant-ui/react";
import type React from "react";

import { cn } from "../utils.js";
import type { AgentComposerLayoutVariant } from "./types.js";

export interface AgentComposerFrameProps {
  children: React.ReactNode;
  /** Content that grows from behind the composer as part of the prompt workflow. */
  attachedAccessory?: React.ReactNode;
  className?: string;
  workflowClassName?: string;
  rootClassName?: string;
  style?: React.CSSProperties;
  rootStyle?: React.CSSProperties;
  layoutVariant?: AgentComposerLayoutVariant;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

/**
 * The single visual shell for agent chat composition.
 *
 * AssistantChat, PromptComposer, and host surfaces such as Agent-Native Code
 * all render this same frame so the composer does not drift across products.
 */
export function AgentComposerFrame({
  children,
  attachedAccessory,
  className,
  workflowClassName,
  rootClassName,
  style,
  rootStyle,
  layoutVariant = "default",
  onClick,
}: AgentComposerFrameProps) {
  const frame = (
    <div
      data-agent-composer-variant={layoutVariant}
      data-agent-composer-slot="area"
      className={cn(
        "agent-composer-area shrink-0 py-2",
        attachedAccessory != null && "relative z-10",
        // Compact composers are nested in padded popovers; the default sidebar
        // frame is the only layout that needs its own horizontal inset.
        layoutVariant === "compact" ? "px-0" : "px-3",
        layoutVariant !== "default" && `agent-composer-area--${layoutVariant}`,
        className,
      )}
      style={style}
      onClick={onClick}
    >
      <ComposerPrimitive.Root
        data-agent-composer-variant={layoutVariant}
        data-agent-composer-slot="root"
        className={cn(
          "agent-composer-root flex flex-col rounded-lg border border-input bg-muted/45 transition-colors",
          layoutVariant !== "default" &&
            `agent-composer-root--${layoutVariant}`,
          rootClassName,
        )}
        style={rootStyle}
      >
        {children}
      </ComposerPrimitive.Root>
    </div>
  );

  if (attachedAccessory == null) return frame;

  return (
    <div
      data-agent-composer-slot="workflow"
      data-agent-composer-attached="true"
      className={cn(
        "agent-composer-workflow relative flex w-full flex-col",
        workflowClassName,
      )}
    >
      {attachedAccessory}
      {frame}
    </div>
  );
}
