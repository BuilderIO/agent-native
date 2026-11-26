import { useT } from "@agent-native/core/client/i18n";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { CommentIconButton } from "./CommentRow";
import { reviewUnits } from "./thread-suggestions";

function pageEditor() {
  return (
    document.querySelector<HTMLElement>(
      "[data-primary-block-field-panel] .content-editor[contenteditable='true']",
    ) ??
    document.querySelector<HTMLElement>(
      ".content-editor[contenteditable='true']",
    )
  );
}

function useFocusAfterDecision(unitSelector: string) {
  const decided = useRef<{ unit: HTMLElement; around: HTMLElement[] } | null>(
    null,
  );
  useEffect(
    () => () => {
      const focus = decided.current;
      const active = document.activeElement;
      if (!focus || (active && active !== document.body)) return;
      const own = !focus.unit.isConnected
        ? null
        : focus.unit.matches("[data-thread-card]")
          ? focus.unit
          : focus.unit.querySelector<HTMLElement>(
              "[data-thread-card], button:not(:disabled)",
            );
      for (const target of [own, ...focus.around]) {
        if (!target?.isConnected) continue;
        target.focus();
        if (document.activeElement === target) return;
      }
      pageEditor()?.focus({ preventScroll: true });
    },
    [],
  );
  return (event: MouseEvent<HTMLElement>) => {
    const unit = event.currentTarget.closest<HTMLElement>(unitSelector);
    if (event.detail !== 0 || !unit) {
      decided.current = null;
      return;
    }
    const cards = [
      ...(unit
        .closest("[data-comments-sidebar]")
        ?.querySelectorAll<HTMLElement>("[data-thread-card]") ?? []),
    ].filter(
      (card) =>
        !unit.contains(card) &&
        !card.contains(unit) &&
        !card.closest("[inert], [hidden]"),
    );
    const follows = (card: HTMLElement) =>
      !!(unit.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
    decided.current = {
      unit,
      around: [
        ...cards.filter(follows),
        ...cards.filter((card) => !follows(card)).reverse(),
      ],
    };
  };
}

/**
 * A suggestion's Accept and Reject as icon buttons. Suggestion cards in the
 * margin and the edits an AI suggests in a comment thread both use them.
 */
export function SuggestionDecisionButtons({
  disabled = false,
  acceptDisabled = false,
  labels = {
    accepted: "editor.acceptSuggestion",
    rejected: "editor.rejectSuggestion",
  },
  onDecide,
}: {
  disabled?: boolean;
  /** Accepting can't succeed, as when the edit's text changed, but rejecting can. */
  acceptDisabled?: boolean;
  labels?: Record<SuggestionDecision, string>;
  onDecide: (decision: SuggestionDecision) => void;
}) {
  const t = useT();
  const rememberFocus = useFocusAfterDecision("[data-suggestion-id]");
  return (
    <>
      {(["accepted", "rejected"] as const).map((decision) => (
        <Tooltip key={decision}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t(labels[decision])}
              disabled={disabled || (decision === "accepted" && acceptDisabled)}
              onClick={(event) => {
                event.stopPropagation();
                rememberFocus(event);
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
          <TooltipContent>{t(labels[decision])}</TooltipContent>
        </Tooltip>
      ))}
    </>
  );
}

export function SuggestionGroupDecision({
  pendingUnitCount,
  undecided,
  canDecide,
  deciding,
  acceptDisabled = false,
  onDecide,
}: {
  pendingUnitCount: number;
  undecided: boolean;
  canDecide: boolean;
  deciding: boolean;
  acceptDisabled?: boolean;
  onDecide: (decision: SuggestionDecision) => void;
}) {
  const t = useT();
  if (!canDecide)
    return (
      <p
        className="flex gap-1.5 text-xs leading-normal text-muted-foreground"
        data-suggestion-group-waiting
      >
        <IconClock size={14} aria-hidden className="mt-0.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground">
            {t("comments.waitingForEditor")}
          </span>{" "}
          {t("comments.suggestionReviewReadOnly")}
        </span>
      </p>
    );
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={deciding}
        onClick={() => onDecide("rejected")}
        data-suggestion-proposal-decision="rejected"
      >
        {t("comments.rejectEdits")}
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={deciding || acceptDisabled}
        onClick={() => onDecide("accepted")}
        data-suggestion-proposal-decision="accepted"
      >
        {t(
          undecided ? "comments.acceptEdits" : "comments.acceptRemainingEdits",
          { count: pendingUnitCount },
        )}
      </Button>
    </div>
  );
}

export function SuggestionStepper({
  index,
  total,
  onStep,
}: {
  index: number;
  total: number;
  onStep: (index: number) => void;
}) {
  const t = useT();
  const steps = [
    {
      direction: "previous",
      label: t("comments.previousEdit"),
      icon: IconChevronLeft,
      to: index - 1,
    },
    {
      direction: "next",
      label: t("comments.nextEdit"),
      icon: IconChevronRight,
      to: index + 1,
    },
  ] as const;
  return (
    <div className="flex items-center gap-0.5" data-suggestion-stepper>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
        {t("comments.editPosition", { index: index + 1, total })}
      </span>
      {steps.map((step) => {
        const atEnd = step.to < 0 || step.to >= total;
        return (
          <Tooltip key={step.direction}>
            <TooltipTrigger asChild>
              <CommentIconButton
                aria-label={step.label}
                aria-disabled={atEnd || undefined}
                className="aria-disabled:pointer-events-none aria-disabled:opacity-40"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!atEnd) onStep(step.to);
                }}
                data-suggestion-step={step.direction}
              >
                <step.icon size={16} />
              </CommentIconButton>
            </TooltipTrigger>
            <TooltipContent>{step.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function ProposalGroup({
  proposalId,
  summary,
  totalCount,
  totalUnits,
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
  /** The whole proposal's units, when `members` may be only some of them. */
  totalUnits: number;
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
  const rememberFocus = useFocusAfterDecision("[data-suggestion-proposal]");
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
  // Pieces reviewed together count once.
  const editCount = reviewUnits(pending).length || totalUnits;
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
            count: editCount,
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
        <div className="flex flex-wrap justify-end gap-1 border-t border-border/60 px-2 py-1.5">
          <button
            type="button"
            disabled={deciding || acceptDisabled}
            onClick={(event) => {
              rememberFocus(event);
              onDecide("accepted");
            }}
            className="rounded-md px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-40"
            data-suggestion-proposal-decision="accepted"
          >
            {t(undecided ? "comments.acceptAll" : "comments.acceptRemaining")}
          </button>
          <button
            type="button"
            disabled={deciding}
            onClick={(event) => {
              rememberFocus(event);
              onDecide("rejected");
            }}
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
