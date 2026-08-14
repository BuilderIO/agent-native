import * as PopoverPrimitive from "@radix-ui/react-popover";
import { IconThumbUp, IconThumbDown } from "@tabler/icons-react";
import { useState, useCallback } from "react";

import { agentNativePath } from "../api-path.js";
import { useT } from "../i18n.js";
import { cn } from "../utils.js";

const THUMBS_DOWN_CATEGORIES = [
  { value: "Inaccurate", key: "agentChat.feedback.inaccurate" },
  { value: "Not helpful", key: "agentChat.feedback.notHelpful" },
  { value: "Wrong tool", key: "agentChat.feedback.wrongTool" },
  { value: "Too slow", key: "agentChat.feedback.tooSlow" },
] as const;

type ThumbsDownCategory = (typeof THUMBS_DOWN_CATEGORIES)[number]["value"];

export interface ThumbsFeedbackProps {
  threadId: string;
  runId: string;
  messageSeq: number;
  className?: string;
}

type Selection = "up" | "down" | null;

export function ThumbsFeedback({
  threadId,
  runId,
  messageSeq,
  className,
}: ThumbsFeedbackProps) {
  const t = useT();
  const [selection, setSelection] = useState<Selection>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [submittedCategory, setSubmittedCategory] = useState<string | null>(
    null,
  );

  const sendFeedback = useCallback(
    async (
      feedbackType: "thumbs_up" | "thumbs_down" | "category",
      value?: string,
    ) => {
      try {
        await fetch(agentNativePath("/_agent-native/observability/feedback"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            runId,
            messageSeq,
            feedbackType,
            value: value ?? "",
          }),
        });
      } catch {
        // Fire-and-forget; don't block the UI on feedback submission failures
      }
    },
    [threadId, runId, messageSeq],
  );

  const handleThumbsUp = useCallback(() => {
    if (selection === "up") return;
    setSelection("up");
    setCategoryOpen(false);
    setSubmittedCategory(null);
    sendFeedback("thumbs_up");
  }, [selection, sendFeedback]);

  const handleThumbsDown = useCallback(() => {
    if (selection === "down") {
      setCategoryOpen((prev) => !prev);
      return;
    }
    setSelection("down");
    setCategoryOpen(true);
    sendFeedback("thumbs_down");
  }, [selection, sendFeedback]);

  const handleCategory = useCallback(
    (category: ThumbsDownCategory) => {
      setSubmittedCategory(category);
      setCategoryOpen(false);
      sendFeedback("category", category);
    },
    [sendFeedback],
  );

  return (
    <div className={cn("inline-flex items-center gap-0.5", className)}>
      <button
        type="button"
        aria-label={t("agentChat.feedback.thumbsUp")}
        onClick={handleThumbsUp}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded",
          selection === "up"
            ? "text-foreground"
            : "text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent/50",
        )}
      >
        <IconThumbUp
          size={16}
          stroke={selection === "up" ? 2.5 : 1.5}
          fill={selection === "up" ? "currentColor" : "none"}
        />
      </button>

      <PopoverPrimitive.Root open={categoryOpen} onOpenChange={setCategoryOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={t("agentChat.feedback.thumbsDown")}
            onClick={handleThumbsDown}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded",
              selection === "down"
                ? "text-foreground"
                : "text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent/50",
            )}
          >
            <IconThumbDown
              size={16}
              stroke={selection === "down" ? 2.5 : 1.5}
              fill={selection === "down" ? "currentColor" : "none"}
            />
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-[300] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg outline-none"
          >
            <div className="flex flex-col gap-0.5">
              {THUMBS_DOWN_CATEGORIES.map((category) => (
                <button
                  key={category.value}
                  type="button"
                  onClick={() => handleCategory(category.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-start text-xs",
                    submittedCategory === category.value
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {t(category.key)}
                </button>
              ))}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
