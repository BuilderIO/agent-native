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
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { AgentAvatar, agentDisplayName } from "./agent-identity";
import { trimDiffContext, wordDiff } from "./comment-ai-diff";
import { CommentRow } from "./CommentRow";
import { ProposalGroup, SuggestionDecisionButtons } from "./SuggestionControls";
import { suggestionLineExcerpt } from "./thread-suggestions";

type ThreadSuggestionProps = {
  /** One suggestion, or every edit of the proposal it belongs to, in Page order. */
  suggestions: ResourceSuggestion[];
  canDecide: boolean;
  /** A decision, or an AI revision in this thread, is still in flight. */
  busy: (suggestion: ResourceSuggestion) => boolean;
  conflict: (suggestion: ResourceSuggestion) => boolean;
  onDecide: (
    suggestion: ResourceSuggestion,
    decision: SuggestionDecision,
  ) => void;
  /** Decides every edit of the proposal still pending. */
  onDecideRemaining?: (decision: SuggestionDecision) => void;
  /**
   * Opens a proposal's edits at first. A thread keeps them closed, since the
   * Page beside it already shows them; a view without the Page opens them.
   */
  defaultExpanded?: boolean;
};

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
  canDecide,
  busy,
  conflict,
  onDecide,
  showStatus,
}: {
  suggestion: ResourceSuggestion;
  canDecide: boolean;
  busy: boolean;
  conflict: boolean;
  onDecide: (decision: SuggestionDecision) => void;
  showStatus: boolean;
}) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const excerpt = useMemo(
    () => suggestionLineExcerpt(suggestion.operations),
    [suggestion.operations],
  );
  const segments = useMemo(
    () =>
      excerpt ? trimDiffContext(wordDiff(excerpt.before, excerpt.after)) : [],
    [excerpt],
  );
  const pending = suggestion.status === "pending";
  const decidable = pending && canDecide;
  const conflicted = conflict || suggestion.status === "stale";
  if (
    !segments.length &&
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
            acceptDisabled={conflict}
            onDecide={onDecide}
          />
        </div>
      ) : null}
      {segments.length ? (
        <p
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
      ) : null}
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

/**
 * An AI suggestion shown in place of its receipt reply inside the comment
 * thread that asked for it. A proposal's edits sit in the same group as a
 * proposal in the margin, closed to its summary, edit count, Accept all and
 * Reject all until opened. Deciding changes only the suggestions; the thread
 * stays open until someone resolves it.
 */
export function ThreadSuggestionBody({
  suggestions,
  canDecide,
  busy,
  conflict,
  onDecide,
  onDecideRemaining,
  defaultExpanded = false,
}: ThreadSuggestionProps) {
  const statusLabel = useStatusLabel();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [first] = suggestions;
  if (!first) return null;
  const pending = suggestions.filter(
    (suggestion) => suggestion.status === "pending",
  );
  // Edits that all ended the same way say so once, under the group.
  const sharedStatus =
    suggestions.length > 1 &&
    suggestions.every((suggestion) => suggestion.status === first.status)
      ? first.status
      : null;
  const summary = first.proposalSummary || first.summary;
  const edits = suggestions.map((suggestion) => (
    <ThreadSuggestionEdit
      key={suggestion.id}
      suggestion={suggestion}
      canDecide={canDecide}
      busy={busy(suggestion)}
      conflict={conflict(suggestion)}
      onDecide={(decision) => onDecide(suggestion, decision)}
      showStatus={!sharedStatus}
    />
  ));
  return (
    <div
      className="mt-0.5 grid grid-cols-1 gap-2"
      data-thread-suggestion-group={first.proposalId ?? first.id}
    >
      {suggestions.length > 1 ? (
        <ProposalGroup
          proposalId={first.proposalId ?? first.id}
          summary={summary}
          totalCount={suggestions.length}
          members={suggestions}
          active={false}
          expanded={expanded}
          onExpandedChange={setExpanded}
          deciding={pending.some(busy)}
          acceptDisabled={pending.some(conflict)}
          canDecide={canDecide && !!onDecideRemaining}
          onDecide={(decision) => onDecideRemaining?.(decision)}
        >
          {edits}
        </ProposalGroup>
      ) : (
        <>
          <p className={cn(!pending.length && "text-muted-foreground")}>
            {summary}
          </p>
          <div>{edits}</div>
        </>
      )}
      {sharedStatus ? (
        <SuggestionStatus status={statusLabel(sharedStatus)} />
      ) : null}
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
      name={agentDisplayName(model)}
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
