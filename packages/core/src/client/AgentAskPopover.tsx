import { PromptBar } from "@agent-native/toolkit/composer";
import { Button } from "@agent-native/toolkit/ui/button";
import { type ReactNode, useCallback } from "react";

import { sendToAgentChat } from "./agent-chat.js";
import { useT } from "./i18n.js";

export interface AgentAskPopoverProps {
  prompt: string;
  title?: string;
  label?: string;
  placeholder?: string;
  context?: string;
  className?: string;
  icon?: ReactNode;
  draftScope?: string;
}

/** A low-emphasis entry point for asking the agent without losing the current surface. */
export function AgentAskPopover({
  prompt,
  title,
  label,
  placeholder,
  context,
  className,
  icon,
  draftScope,
}: AgentAskPopoverProps) {
  const t = useT();
  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendToAgentChat({
        message: trimmed,
        context,
        submit: true,
        newTab: true,
      });
    },
    [context],
  );

  return (
    <PromptBar
      autoFocus
      attachmentsEnabled={false}
      draftScope={draftScope}
      initialText={prompt}
      initialTextKey={prompt}
      placeholder={
        placeholder ??
        t("agentPanel.askAgentPlaceholder", {
          defaultValue: "Tell the agent what you want to do…",
        })
      }
      showModelSelector={false}
      voiceEnabled={false}
      onSubmit={handleSubmit}
      className={className ?? "cursor-pointer"}
      trigger={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className ?? "cursor-pointer"}
        >
          {icon}
          {label ?? t("agentPanel.askAgent", { defaultValue: "Ask the agent" })}
        </Button>
      }
    >
      {title ? (
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      ) : null}
    </PromptBar>
  );
}
