import { Button } from "@agent-native/toolkit/ui/button";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { IconThumbUp, IconThumbDown } from "@tabler/icons-react";
import { useState, useCallback, useId, useRef } from "react";

import { agentNativePath } from "../api-path.js";
import { submitFeedbackForm } from "../FeedbackButton.js";
import { useT } from "../i18n.js";
import { useSession } from "../use-session.js";
import { cn } from "../utils.js";

export interface ThumbsFeedbackProps {
  threadId: string;
  runId: string;
  messageSeq: number;
  className?: string;
}

type Selection = "up" | "down" | null;

type TextFeedbackDelivery = {
  value: string;
  observabilityDelivered: boolean;
  sharedFormDelivered: boolean;
  idempotencyKey: string;
};

function createFeedbackIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ThumbsFeedback({
  threadId,
  runId,
  messageSeq,
  className,
}: ThumbsFeedbackProps) {
  const t = useT();
  const { session } = useSession();
  const [selection, setSelection] = useState<Selection>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [textFeedback, setTextFeedback] = useState("");
  const [textSubmitting, setTextSubmitting] = useState(false);
  const feedbackInputId = useId();
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null);
  const feedbackOpenedAtRef = useRef(0);
  const textSubmissionInFlightRef = useRef(false);
  const textFeedbackDeliveryRef = useRef<TextFeedbackDelivery | null>(null);

  const sendFeedback = useCallback(
    async (
      feedbackType: "thumbs_up" | "thumbs_down" | "text",
      value?: string,
    ): Promise<boolean> => {
      try {
        const response = await fetch(
          agentNativePath("/_agent-native/observability/feedback"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId,
              runId,
              messageSeq,
              feedbackType,
              value: value ?? "",
            }),
          },
        );
        if (!response.ok) {
          throw new Error(`Feedback submission failed (${response.status})`);
        }
        return true;
      } catch {
        // coercion-ok: callers receive false and restore the retryable UI state.
        return false;
      }
    },
    [threadId, runId, messageSeq],
  );

  const handleThumbsUp = useCallback(() => {
    if (selection === "up") return;
    setSelection("up");
    setPopoverOpen(false);
    void sendFeedback("thumbs_up").then((submitted) => {
      if (!submitted) setSelection(null);
    });
  }, [selection, sendFeedback]);

  const handleThumbsDown = useCallback(() => {
    if (selection === "down") {
      const nextOpen = !popoverOpen;
      if (nextOpen) feedbackOpenedAtRef.current = Date.now();
      setPopoverOpen(nextOpen);
      return;
    }
    feedbackOpenedAtRef.current = Date.now();
    setSelection("down");
    setPopoverOpen(true);
    void sendFeedback("thumbs_down").then((submitted) => {
      if (!submitted) setSelection(null);
    });
  }, [popoverOpen, selection, sendFeedback]);

  const handleTextFeedback = useCallback(() => {
    const value = textFeedback.trim();
    if (!value || textSubmissionInFlightRef.current) return;
    const delivery =
      textFeedbackDeliveryRef.current?.value === value
        ? textFeedbackDeliveryRef.current
        : {
            value,
            observabilityDelivered: false,
            sharedFormDelivered: false,
            idempotencyKey: createFeedbackIdempotencyKey(),
          };
    textFeedbackDeliveryRef.current = delivery;
    textSubmissionInFlightRef.current = true;
    setTextSubmitting(true);

    const deliveries: Promise<void>[] = [];
    if (!delivery.observabilityDelivered) {
      deliveries.push(
        sendFeedback("text", value).then((submitted) => {
          delivery.observabilityDelivered = submitted;
        }),
      );
    }
    if (!delivery.sharedFormDelivered) {
      deliveries.push(
        submitFeedbackForm({
          value,
          openedAt: feedbackOpenedAtRef.current,
          idempotencyKey: delivery.idempotencyKey,
          chatSessionId: threadId,
          activeRunId: runId,
          submitterEmail: session?.email,
        })
          .then(() => {
            delivery.sharedFormDelivered = true;
          })
          .catch((reason) => {
            console.error(
              "[ThumbsFeedback] shared feedback form submission failed",
              reason,
            );
          }),
      );
    }

    void Promise.all(deliveries)
      .then(() => {
        if (!delivery.observabilityDelivered || !delivery.sharedFormDelivered) {
          return;
        }
        textFeedbackDeliveryRef.current = null;
        setTextFeedback("");
        setPopoverOpen(false);
      })
      .finally(() => {
        textSubmissionInFlightRef.current = false;
        setTextSubmitting(false);
      });
  }, [runId, sendFeedback, session?.email, textFeedback, threadId]);

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

      <PopoverPrimitive.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
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
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              feedbackInputRef.current?.focus();
            }}
            className="z-[300] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none origin-[var(--radix-popover-content-transform-origin)]"
          >
            <form
              className="flex flex-col gap-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                handleTextFeedback();
              }}
            >
              <label
                htmlFor={feedbackInputId}
                className="text-xs font-medium text-foreground"
              >
                {t("agentChat.feedback.whatWentWrong")}
              </label>
              <Textarea
                id={feedbackInputId}
                ref={feedbackInputRef}
                autoFocus
                value={textFeedback}
                onChange={(event) => setTextFeedback(event.target.value)}
                disabled={textSubmitting}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    handleTextFeedback();
                  }
                }}
                placeholder={t("agentChat.feedback.placeholder")}
                rows={3}
                maxLength={2000}
                className="min-h-20 resize-none px-2.5 py-2 text-xs"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground/75">
                  {t("agentChat.feedback.keyboardHint").replace(
                    "{{shortcut}}",
                    typeof navigator !== "undefined" &&
                      /Mac|iPhone|iPad/.test(navigator.userAgent)
                      ? "⌘"
                      : "Ctrl",
                  )}
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={textSubmitting || !textFeedback.trim()}
                  className="h-7 px-2.5 text-xs"
                >
                  {t("agentChat.feedback.submit")}
                </Button>
              </div>
            </form>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
