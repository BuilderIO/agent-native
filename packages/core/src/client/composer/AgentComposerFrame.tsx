import { ComposerPrimitive } from "@assistant-ui/react";
import type React from "react";
import { cn } from "../utils.js";

export interface AgentComposerFrameProps {
  children: React.ReactNode;
  className?: string;
  rootClassName?: string;
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
  onClick,
}: AgentComposerFrameProps) {
  return (
    <div
      className={cn("agent-composer-area shrink-0 px-3 py-2", className)}
      onClick={onClick}
    >
      <ComposerPrimitive.Root
        className={cn(
          "agent-composer-root flex flex-col rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring",
          rootClassName,
        )}
      >
        {children}
      </ComposerPrimitive.Root>
    </div>
  );
}
