import { useT } from "@agent-native/core/client/i18n";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A suggestion's Accept and Reject as icon buttons. Suggestion cards in the
 * margin and the edits an AI suggests in a comment thread both use them.
 */
export function SuggestionDecisionButtons({
  disabled = false,
  acceptDisabled = false,
  onDecide,
}: {
  disabled?: boolean;
  /** Accepting can't succeed, as when the edit's text changed, but rejecting can. */
  acceptDisabled?: boolean;
  onDecide: (decision: SuggestionDecision) => void;
}) {
  const t = useT();
  return (
    <>
      {(["accepted", "rejected"] as const).map((decision) => (
        <Tooltip key={decision}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t(
                decision === "accepted"
                  ? "editor.acceptSuggestion"
                  : "editor.rejectSuggestion",
              )}
              disabled={disabled || (decision === "accepted" && acceptDisabled)}
              onClick={(event) => {
                event.stopPropagation();
                onDecide(decision);
              }}
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              data-suggestion-decision={decision}
            >
              {decision === "accepted" ? (
                <IconCheck size={18} />
              ) : (
                <IconX size={18} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t(
              decision === "accepted"
                ? "editor.acceptSuggestion"
                : "editor.rejectSuggestion",
            )}
          </TooltipContent>
        </Tooltip>
      ))}
    </>
  );
}

/**
 * The edits of one proposal under its summary, collapsible, with Accept all
 * and Reject all under them. The margin and comment threads both group a
 * proposal's edits in it.
 */
export function ProposalGroup({
  proposalId,
  summary,
  totalCount,
  members,
  active,
  expanded,
  onExpandedChange,
  deciding,
  acceptDisabled = false,
  canDecide,
  onDecide,
  onHeightChange,
  children,
}: {
  proposalId: string;
  summary: string;
  totalCount: number;
  members: ResourceSuggestion[];
  active: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  deciding: boolean;
  /** An edit can't be placed, so accepting them all would fail. */
  acceptDisabled?: boolean;
  canDecide: boolean;
  onDecide: (decision: SuggestionDecision) => void;
  onHeightChange?: (height: number) => void;
  children: ReactNode;
}) {
  const t = useT();
  const groupRef = useRef<HTMLDivElement>(null);
  const detailsId = useId();
  useLayoutEffect(() => {
    if (active) onExpandedChange(true);
  }, [active]);
  useLayoutEffect(() => {
    const element = groupRef.current;
    if (!element || !onHeightChange) return;
    const measure = () =>
      onHeightChange(element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange]);
  const pending = members.filter((member) => member.status === "pending");
  const undecided = pending.length === totalCount;
  return (
    <div
      ref={groupRef}
      data-suggestion-proposal={proposalId}
      className="overflow-hidden rounded-lg bg-popover shadow-sm ring-1 ring-border/50"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => onExpandedChange(!expanded)}
        className="flex w-full min-w-0 items-start gap-2 px-3 py-2 text-start text-xs hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <IconChevronDown
          size={14}
          className={cn(
            "mt-px shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-collapse)]",
            !expanded && "-rotate-90",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 break-words font-medium",
            !expanded && "line-clamp-2",
          )}
        >
          {summary}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {t("comments.proposalEditCount", {
            count: pending.length || totalCount,
          })}
        </span>
      </button>
      {expanded ? (
        <div
          id={detailsId}
          className="grid gap-2 border-t border-border/60 p-2"
        >
          {children}
        </div>
      ) : null}
      {canDecide && pending.length > 0 ? (
        <div className="flex justify-end gap-1 border-t border-border/60 px-2 py-1.5">
          <button
            type="button"
            disabled={deciding || acceptDisabled}
            onClick={() => onDecide("accepted")}
            className="rounded-md px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-40"
            data-suggestion-proposal-decision="accepted"
          >
            {t(undecided ? "comments.acceptAll" : "comments.acceptRemaining")}
          </button>
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide("rejected")}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            data-suggestion-proposal-decision="rejected"
          >
            {t(undecided ? "comments.rejectAll" : "comments.rejectRemaining")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
