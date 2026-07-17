import { Button } from "@agent-native/toolkit/ui/button";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import { IconFocus2, IconMessageCircle, IconSend } from "@tabler/icons-react";
import type { ReactNode } from "react";

import type { ReviewResolutionTarget } from "../../review/types.js";
import { cn } from "../utils.js";

export interface ReviewCommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (resolutionTarget: ReviewResolutionTarget) => void;
  submittingTarget?: ReviewResolutionTarget | null;
  disabled?: boolean;
  showAgentAction?: boolean;
  agentAction?: ReactNode;
  placeholder?: string;
  commentLabel?: string;
  agentLabel?: string;
  contextLabel?: string;
  autoFocus?: boolean;
  submitOnEnter?: boolean;
  enterSubmitTarget?: ReviewResolutionTarget;
  onEscape?: () => void;
  className?: string;
}

export function ReviewCommentComposer({
  value,
  onChange,
  onSubmit,
  submittingTarget = null,
  disabled = false,
  showAgentAction = false,
  agentAction,
  placeholder = "Add a comment...",
  commentLabel = "Comment",
  agentLabel = "Send to agent",
  contextLabel,
  autoFocus = false,
  submitOnEnter = false,
  enterSubmitTarget = "human",
  onEscape,
  className,
}: ReviewCommentComposerProps) {
  const canSubmit = Boolean(value.trim()) && !disabled;
  const submit = (resolutionTarget: ReviewResolutionTarget) => {
    if (!canSubmit) return;
    onSubmit(resolutionTarget);
  };

  return (
    <form
      className={cn("@container/review", className)}
      onSubmit={(event) => {
        event.preventDefault();
        submit("human");
      }}
    >
      {contextLabel ? (
        <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <IconFocus2 className="size-3.5 shrink-0" />
          <span className="truncate">{contextLabel}</span>
        </div>
      ) : null}
      <Textarea
        autoFocus={autoFocus}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        className="min-h-16 resize-none text-sm"
        onKeyDown={(event) => {
          if (event.key === "Escape" && onEscape) {
            event.stopPropagation();
            event.preventDefault();
            onEscape();
            return;
          }
          if (submitOnEnter && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit(enterSubmitTarget);
          }
        }}
      />
      <div className="mt-2 flex flex-col items-stretch justify-end gap-2 @2xs/review:flex-row @2xs/review:items-center">
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          className="h-8 w-full gap-1.5 @2xs/review:w-auto @2xs/review:min-w-28 @2xs/review:shrink-0"
        >
          {submittingTarget === "human" ? (
            <Spinner className="size-3.5" />
          ) : (
            <IconMessageCircle className="size-3.5" />
          )}
          <span className="truncate">{commentLabel}</span>
        </Button>
        {showAgentAction && agentAction ? (
          agentAction
        ) : showAgentAction ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canSubmit}
            className="h-8 w-full min-w-0 gap-1.5 @2xs/review:w-auto"
            onClick={() => submit("agent")}
          >
            {submittingTarget === "agent" ? (
              <Spinner className="size-3.5" />
            ) : (
              <IconSend className="size-3.5" />
            )}
            <span className="truncate">{agentLabel}</span>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
