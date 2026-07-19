import { Button } from "@agent-native/toolkit/ui/button";
import { useCallback, useState } from "react";

import { sendToAgentChat } from "./agent-chat.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.js";
import { PromptComposer } from "./composer/index.js";
import { useT } from "./i18n.js";

export interface AgentAskPopoverProps {
  prompt: string;
  title?: string;
  label?: string;
  placeholder?: string;
  context?: string;
  className?: string;
}

/** A low-emphasis entry point for asking the agent without losing the current surface. */
export function AgentAskPopover({
  prompt,
  title,
  label,
  placeholder,
  context,
  className,
}: AgentAskPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
    },
    [context],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className ?? "cursor-pointer"}
        >
          {label ?? t("agentPanel.askAgent", { defaultValue: "Ask the agent" })}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="z-[260] w-[calc(100vw-32px)] max-w-[420px] p-3"
      >
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          {title ??
            t("agentPanel.askAgentTitle", { defaultValue: "Ask the agent" })}
        </p>
        <PromptComposer
          autoFocus
          attachmentsEnabled={false}
          initialText={prompt}
          initialTextKey={prompt}
          layoutVariant="compact"
          placeholder={
            placeholder ??
            t("agentPanel.askAgentPlaceholder", {
              defaultValue: "Tell the agent what you want to do…",
            })
          }
          showModelSelector={false}
          voiceEnabled={false}
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}
