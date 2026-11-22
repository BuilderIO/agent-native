import { useT } from "@agent-native/core/client/i18n";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import {
  IconArrowBackUp,
  IconCircleCheck,
  IconCircleX,
} from "@tabler/icons-react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { AgentAvatar, modelDisplayName } from "./agent-identity";
import { trimDiffContext, wordDiff } from "./comment-ai-diff";
import { CommentRow } from "./CommentRow";
import {
  SuggestionDecisionButtons,
  SuggestionGroupDecision,
  SuggestionStepper,
} from "./SuggestionControls";
import {
  piecesOfStaleUnits,
  reviewUnitOperations,
  reviewUnits,
  suggestionLineExcerpt,
} from "./thread-suggestions";

type ThreadSuggestionProps = {
  /** One suggestion, or every edit of the proposal it belongs to, in Page order. */
  suggestions: ResourceSuggestion[];
  canDecide: boolean;
  /** A decision, or an AI revision in this thread, is still in flight. */
  busy: (suggestion: ResourceSuggestion) => boolean;
  conflict: (suggestion: ResourceSuggestion) => boolean;
  /** Accepting it needs more access than this person has; rejecting doesn't. */
  acceptBlocked?: (suggestion: ResourceSuggestion) => boolean;
  onDecide: (
    suggestion: ResourceSuggestion,
    decision: SuggestionDecision,
  ) => void;
  /** Decides pieces reviewed together, in one save. */
  onDecideUnit: (
    members: ResourceSuggestion[],
    decision: SuggestionDecision,
  ) => void;
  /** Decides every edit of the proposal still pending. */
  onDecideRemaining?: (decision: SuggestionDecision) => void;
  onResolve?: () => void;
  onStep?: (suggestion: ResourceSuggestion) => void;
  listsEveryEdit?: boolean;
  stickyDecision?: boolean;
};

const LISTED_EDITS_MAX = 3;

function useStatusLabel() {
  const t = useT();
  return (status: ResourceSuggestion["status"]) =>
    status === "accepted"
      ? { icon: IconCircleCheck, label: t("comments.accepted") }
      : status === "rejected"
        ? { icon: IconCircleX, label: t("comments.rejected") }
        : status === "superseded"
          ? { icon: IconArrowBackUp, label: t("comments.suggestionReplaced") }
          : status === "withdrawn"
            ? {
                icon: IconArrowBackUp,
                label: t("comments.suggestionWithdrawn"),
              }
            : null;
}

function SuggestionStatus({
  status,
}: {
  status: ReturnType<ReturnType<typeof useStatusLabel>>;
}) {
  if (!status) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      <status.icon size={14} aria-hidden />
      {status.label}
    </span>
  );
}

/**
 * One edit's word diff with the same Accept and Reject icons as a suggestion
 * card, or how it ended. The icons sit at the top end and the diff wraps
 * around them, so a narrow thread card keeps the diff's width.
 */
function ThreadSuggestionEdit({
  suggestion,
  operations,
  canDecide,
  busy,
  conflict,
  acceptBlocked,
  onDecide,
  showStatus,
}: {
  suggestion: ResourceSuggestion;
  /** What the edit changes: usually one, or each piece that can't read as one. */
  operations: ResourceSuggestion["operations"];
  canDecide: boolean;
  busy: boolean;
  conflict: boolean;
  acceptBlocked: boolean;
  onDecide: (decision: SuggestionDecision) => void;
  showStatus: boolean;
}) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const diffs = useMemo(
    () =>
      operations
        .map((operation) => {
          const excerpt = suggestionLineExcerpt([operation]);
          return excerpt
            ? trimDiffContext(wordDiff(excerpt.before, excerpt.after))
            : [];
        })
        .filter((segments) => segments.length > 0),
    [operations],
  );
  const pending = suggestion.status === "pending";
  const decidable = pending && canDecide;
  const conflicted = conflict || suggestion.status === "stale";
  if (
    !diffs.length &&
    !conflicted &&
    !decidable &&
    !(showStatus && statusLabel(suggestion.status))
  )
    return null;
  return (
    <div
      className="flow-root border-t border-border/60 px-1 pt-2 first:border-t-0 first:pt-0"
      data-thread-suggestion={suggestion.id}
      data-thread-suggestion-status={suggestion.status}
    >
      {decidable ? (
        <div className="float-end -me-1 -mt-0.5 ms-1 flex">
          <SuggestionDecisionButtons
            disabled={busy}
            acceptDisabled={conflict || acceptBlocked}
            labels={{
              accepted: "comments.acceptEdit",
              rejected: "comments.rejectEdit",
            }}
            onDecide={onDecide}
          />
        </div>
      ) : null}
      {diffs.map((segments, diffIndex) => (
        <p
          key={diffIndex}
          aria-label={t("comments.suggestedChange")}
          className={cn(
            "whitespace-pre-wrap break-words leading-6",
            !pending && suggestion.status !== "accepted" && "opacity-70",
          )}
          data-thread-suggestion-diff
        >
          {segments.map((segment, index) =>
            segment.kind === "removed" ? (
              <del
                key={index}
                className="text-muted-foreground decoration-muted-foreground/70"
              >
                {segment.text}
              </del>
            ) : segment.kind === "added" ? (
              <ins
                key={index}
                className="text-[hsl(var(--suggestion))] no-underline"
              >
                {segment.text}
              </ins>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      ))}
      {conflicted ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t("editor.toolbar.conflict")}
        </p>
      ) : null}
      {!decidable && showStatus ? (
        <div className="mt-1">
          <SuggestionStatus status={statusLabel(suggestion.status)} />
        </div>
      ) : null}
    </div>
  );
}

export function ThreadSuggestionBody({
  suggestions,
  canDecide,
  busy,
  conflict,
  acceptBlocked = () => false,
  onDecide,
  onDecideUnit,
  onDecideRemaining,
  onResolve,
  onStep,
  listsEveryEdit = false,
  stickyDecision = false,
}: ThreadSuggestionProps) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const units = reviewUnits(suggestions);
  const [step, setStep] = useState(() =>
    Math.max(
      0,
      units.findIndex(({ leader }) => leader.status === "pending"),
    ),
  );
  const [shown, setShown] = useState(false);
  const detailsId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const settledRef = useRef<HTMLDivElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const decidedHere = useRef(new Set<string>());
  const lastPending = useRef<string[]>([]);
  const pendingIds = suggestions
    .filter(({ status }) => status === "pending")
    .map(({ id }) => id);
  const pendingUnits = units.filter(
    ({ leader }) => leader.status === "pending",
  );
  const acceptedUnits = units.filter(
    ({ leader }) => leader.status === "accepted",
  ).length;
  const rejectedUnits = units.filter(
    ({ leader }) => leader.status === "rejected",
  ).length;
  const decided = !pendingUnits.length && acceptedUnits + rejectedUnits > 0;
  const stepped = !listsEveryEdit && units.length > LISTED_EDITS_MAX;
  const index = Math.min(step, units.length - 1);
  const steppedEditId = stepped
    ? units.find((_, unitIndex) => unitIndex === index)?.leader.id
    : undefined;
  const followsDecision = useRef(false);
  const keepsFocus = () => {
    const focused = document.activeElement;
    return (
      !focused ||
      focused === document.body ||
      !!groupRef.current?.contains(focused)
    );
  };
  useLayoutEffect(() => {
    if (!followsDecision.current) return;
    followsDecision.current = false;
    if (!keepsFocus()) return;
    const group = groupRef.current;
    (
      group?.querySelector<HTMLElement>(
        "[data-thread-suggestion] [data-suggestion-decision]:not(:disabled)",
      ) ?? group?.querySelector<HTMLElement>("[data-suggestion-step]")
    )?.focus({ preventScroll: true });
  }, [steppedEditId]);
  useLayoutEffect(() => {
    if (!decided) return;
    const settledHere =
      lastPending.current.length > 0 &&
      lastPending.current.every((id) => decidedHere.current.has(id));
    decidedHere.current.clear();
    if (!settledHere) return;
    const focusHere = keepsFocus();
    const frame = requestAnimationFrame(() => {
      settledRef.current?.scrollIntoView({ block: "nearest" });
      if (focusHere) showRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [decided]);
  const deciding = suggestions.some(busy);
  useLayoutEffect(() => {
    if (deciding) return;
    for (const id of pendingIds) decidedHere.current.delete(id);
  }, [deciding]);
  useLayoutEffect(() => {
    if (pendingIds.length) lastPending.current = pendingIds;
  });
  useLayoutEffect(() => {
    if (!shown) return;
    const frame = requestAnimationFrame(() =>
      settledRef.current?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [shown]);
  const [first] = suggestions;
  if (!first) return null;
  const summary = first.proposalSummary || first.summary;
  const pending = suggestions.filter(
    (suggestion) => suggestion.status === "pending",
  );
  // Edits that all ended the same way say so once, under the group.
  const sharedStatus =
    !decided &&
    suggestions.length > 1 &&
    suggestions.every((suggestion) => suggestion.status === first.status)
      ? first.status
      : null;
  const staleUnitPieces = piecesOfStaleUnits(suggestions);
  const cantAccept = (suggestion: ResourceSuggestion) =>
    conflict(suggestion) || staleUnitPieces.has(suggestion.id);
  const showUnit = (unit: (typeof units)[number]) => {
    setStep(units.indexOf(unit));
    onStep?.(unit.leader);
  };
  const showNextPendingAfter = (unitIndex: number) => {
    const nextPending = [
      ...units.slice(unitIndex + 1),
      ...units.slice(0, unitIndex),
    ].find(({ leader }) => leader.status === "pending");
    if (!nextPending) return;
    followsDecision.current = true;
    showUnit(nextPending);
  };
  const decideUnit = (
    unit: (typeof units)[number],
    decision: SuggestionDecision,
  ) => {
    for (const { id } of unit.members) decidedHere.current.add(id);
    if (unit.members.length > 1)
      onDecideUnit(
        unit.members.filter(({ status }) => status === "pending"),
        decision,
      );
    else onDecide(unit.leader, decision);
  };
  const decideRemaining = (decision: SuggestionDecision) => {
    for (const id of pendingIds) decidedHere.current.add(id);
    if (onDecideRemaining) onDecideRemaining(decision);
    else for (const unit of pendingUnits) decideUnit(unit, decision);
  };
  const edit = (unit: (typeof units)[number], unitIndex: number) => (
    <ThreadSuggestionEdit
      key={unit.leader.id}
      suggestion={unit.leader}
      operations={reviewUnitOperations(unit)}
      canDecide={canDecide && units.length > 1}
      busy={unit.members.some(busy)}
      conflict={unit.members.some(cantAccept)}
      acceptBlocked={unit.members.some(acceptBlocked)}
      onDecide={(decision) => {
        decideUnit(unit, decision);
        if (stepped) showNextPendingAfter(unitIndex);
      }}
      showStatus={!sharedStatus}
    />
  );
  const shownUnits = stepped ? units.slice(index, index + 1) : units;
  const edits = shownUnits.map((unit) => edit(unit, units.indexOf(unit)));
  const stepper = stepped ? (
    <div className="border-b border-border/60 py-1 pe-1 ps-3">
      <SuggestionStepper
        index={index}
        total={units.length}
        onStep={(to) => {
          const unit = units.find((_, unitIndex) => unitIndex === to);
          if (unit) showUnit(unit);
        }}
      />
    </div>
  ) : null;
  return (
    <div
      ref={groupRef}
      className="mt-0.5 grid grid-cols-1 gap-2"
      data-thread-suggestion-group={first.proposalId ?? first.id}
    >
      <p
        className={cn(
          "whitespace-pre-wrap break-words",
          !pending.length && "text-muted-foreground",
        )}
        data-thread-suggestion-note
      >
        {summary}
      </p>
      {decided ? (
        <div ref={settledRef} className="grid grid-cols-1 gap-2">
          <div
            className="overflow-hidden rounded-lg bg-popover shadow-sm ring-1 ring-border/50"
            data-thread-suggestion-decided
          >
            <div className="flex min-w-0 items-center gap-x-3 gap-y-1 px-3 py-1.5">
              <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
                {acceptedUnits ? (
                  <SuggestionStatus
                    status={{
                      icon: IconCircleCheck,
                      label: t("comments.editsAccepted", {
                        count: acceptedUnits,
                      }),
                    }}
                  />
                ) : null}
                {rejectedUnits ? (
                  <SuggestionStatus
                    status={{
                      icon: IconCircleX,
                      label: t("comments.editsRejected", {
                        count: rejectedUnits,
                      }),
                    }}
                  />
                ) : null}
              </div>
              <Button
                ref={showRef}
                type="button"
                variant="link"
                size="xs"
                className="shrink-0"
                aria-expanded={shown}
                aria-controls={detailsId}
                onClick={() => {
                  if (!shown) setStep(0);
                  setShown(!shown);
                }}
                data-thread-suggestion-show
              >
                {t(shown ? "comments.hideEdits" : "comments.showEdits")}
              </Button>
            </div>
            {shown ? (
              <div id={detailsId} className="border-t border-border/60">
                {stepper}
                <div className="grid gap-2 p-2">{edits}</div>
              </div>
            ) : null}
          </div>
          {onResolve ? (
            <div
              className="flex items-center gap-2"
              data-thread-suggestion-resolve
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={onResolve}
              >
                <IconCircleCheck aria-hidden />
                {t("comments.resolve")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("comments.replyToKeepGoing")}
              </span>
            </div>
          ) : null}
        </div>
      ) : pendingUnits.length ? (
        <>
          <div
            className="overflow-hidden rounded-t-lg bg-popover shadow-sm ring-1 ring-border/50"
            data-suggestion-proposal={first.proposalId ?? first.id}
          >
            {stepper}
            <div className="grid gap-2 p-2">{edits}</div>
          </div>
          <div
            className={cn(
              "-mx-px -mt-2 rounded-b-lg border border-border/50 border-t-border/60 bg-popover p-2 shadow-sm",
              stickyDecision &&
                "sticky bottom-0 after:absolute after:-inset-x-px after:top-full after:mt-px after:h-3.5 after:bg-popover",
            )}
            data-suggestion-group-decision
          >
            <SuggestionGroupDecision
              pendingUnitCount={pendingUnits.length}
              undecided={!acceptedUnits && !rejectedUnits}
              canDecide={canDecide}
              deciding={pending.some(busy)}
              acceptDisabled={
                pending.some(cantAccept) || pending.some(acceptBlocked)
              }
              onDecide={decideRemaining}
            />
          </div>
        </>
      ) : stepped ? (
        <div className="overflow-hidden rounded-lg bg-popover shadow-sm ring-1 ring-border/50">
          {stepper}
          <div className="grid gap-2 p-2">{edits}</div>
        </div>
      ) : (
        <div>{edits}</div>
      )}
      {sharedStatus ? (
        <SuggestionStatus status={statusLabel(sharedStatus)} />
      ) : null}
    </div>
  );
}

/** Holds a suggestion's place while it loads, or offers a retry once its read fails. */
export function ThreadSuggestionPlaceholder({
  onRetry,
}: {
  onRetry?: (() => void) | undefined;
}) {
  const t = useT();
  if (onRetry)
    return (
      <div
        className="flex items-center gap-2.5"
        data-thread-suggestion-placeholder="failed"
      >
        <div className="w-7 shrink-0" />
        <span role="alert" className="text-xs text-destructive">
          {t("comments.suggestionLoadFailed")}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          {t("comments.retry")}
        </Button>
      </div>
    );
  return (
    <div className="flex gap-2.5" data-thread-suggestion-placeholder>
      <div className="w-7 shrink-0" />
      <div className="grid min-w-0 flex-1 gap-2">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-1.5">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
    </div>
  );
}

/** A thread suggestion whose receipt reply is not in the thread. */
export function ThreadSuggestionRow(props: ThreadSuggestionProps) {
  const [first] = props.suggestions;
  if (!first) return null;
  const model =
    typeof first.metadata?.model === "string" ? first.metadata.model : null;
  return (
    <CommentRow
      avatar={<AgentAvatar model={model} />}
      name={modelDisplayName(model)}
      identity={{
        kind: "agent",
        model,
        run: {
          effort: null,
          ranAt: first.createdAt,
          threadId: null,
          canOpen: false,
        },
      }}
    >
      <ThreadSuggestionBody {...props} />
    </CommentRow>
  );
}
