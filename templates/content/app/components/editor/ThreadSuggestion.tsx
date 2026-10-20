import { useT } from "@agent-native/core/client/i18n";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import {
  IconArrowBackUp,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconX,
} from "@tabler/icons-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AgentAvatar, agentDisplayName } from "./agent-identity";
import { trimDiffContext, wordDiff } from "./comment-ai-diff";
import { CommentRow } from "./CommentRow";
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

/** One edit's word diff, with its own Accept and Reject or outcome. */
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
  return (
    <div
      className="grid grid-cols-1 gap-2"
      data-thread-suggestion={suggestion.id}
      data-thread-suggestion-status={suggestion.status}
    >
      {segments.length ? (
        <p
          aria-label={t("comments.suggestedChange")}
          className={cn(
            "whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 leading-6",
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
      {conflict || suggestion.status === "stale" ? (
        <p role="alert" className="text-xs text-destructive">
          {t("editor.toolbar.conflict")}
        </p>
      ) : null}
      {pending && canDecide ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            disabled={busy || conflict}
            onClick={(event) => {
              event.stopPropagation();
              onDecide("accepted");
            }}
            data-suggestion-decision="accepted"
          >
            <IconCheck aria-hidden />
            {t("editor.acceptSuggestion")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onDecide("rejected");
            }}
            data-suggestion-decision="rejected"
          >
            <IconX aria-hidden />
            {t("editor.rejectSuggestion")}
          </Button>
        </div>
      ) : showStatus ? (
        <SuggestionStatus status={statusLabel(suggestion.status)} />
      ) : null}
    </div>
  );
}

/**
 * An AI suggestion shown in place of its receipt reply inside the comment
 * thread that asked for it. Separate changes arrive as one proposal, so the
 * summary is said once above every edit. Deciding changes only the
 * suggestions; the thread stays open until someone resolves it.
 */
export function ThreadSuggestionBody({
  suggestions,
  canDecide,
  busy,
  conflict,
  onDecide,
  onDecideRemaining,
}: ThreadSuggestionProps) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const [first] = suggestions;
  if (!first) return null;
  const pending = suggestions.filter(
    (suggestion) => suggestion.status === "pending",
  );
  // Edits that all ended the same way say so once, under the last of them.
  const sharedStatus =
    suggestions.length > 1 &&
    suggestions.every((suggestion) => suggestion.status === first.status)
      ? first.status
      : null;
  return (
    <div
      className="mt-0.5 grid grid-cols-1 gap-2"
      data-thread-suggestion-group={first.proposalId ?? first.id}
    >
      <p className={cn(!pending.length && "text-muted-foreground")}>
        {first.proposalSummary || first.summary}
      </p>
      {suggestions.map((suggestion) => (
        <ThreadSuggestionEdit
          key={suggestion.id}
          suggestion={suggestion}
          canDecide={canDecide}
          busy={busy(suggestion)}
          conflict={conflict(suggestion)}
          onDecide={(decision) => onDecide(suggestion, decision)}
          showStatus={!sharedStatus}
        />
      ))}
      {sharedStatus ? (
        <SuggestionStatus status={statusLabel(sharedStatus)} />
      ) : null}
      {canDecide && onDecideRemaining && pending.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending.some(busy) || pending.some(conflict)}
            onClick={(event) => {
              event.stopPropagation();
              onDecideRemaining("accepted");
            }}
            data-suggestion-proposal-decision="accepted"
          >
            {t("comments.acceptRemaining")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={pending.some(busy)}
            onClick={(event) => {
              event.stopPropagation();
              onDecideRemaining("rejected");
            }}
            data-suggestion-proposal-decision="rejected"
          >
            {t("comments.rejectRemaining")}
          </Button>
        </div>
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
