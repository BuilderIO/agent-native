import { ComposerPrimitive } from "@assistant-ui/react";
import type React from "react";

import { cn } from "../utils.js";
import type { AgentComposerLayoutVariant } from "./types.js";

export interface AgentComposerFrameProps {
  children: React.ReactNode;
  className?: string;
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
  className,
  rootClassName,
  style,
  rootStyle,
  layoutVariant = "default",
  onClick,
}: AgentComposerFrameProps) {
  return (
    <div
      data-agent-composer-variant={layoutVariant}
      data-agent-composer-slot="area"
      className={cn(
        "agent-composer-area shrink-0 px-3 py-2",
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
          "agent-composer-root flex flex-col rounded-lg border border-input bg-muted/45 transition-colors focus-within:border-ring",
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
}
