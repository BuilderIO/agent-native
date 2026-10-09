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

/**
 * An AI suggestion shown in place of its receipt reply inside the comment
 * thread that asked for it. Deciding it changes only the suggestion; the
 * thread stays open until someone resolves it.
 */
export function ThreadSuggestionBody({
  suggestion,
  canDecide,
  deciding,
  conflict,
  onDecide,
}: {
  suggestion: ResourceSuggestion;
  canDecide: boolean;
  deciding: boolean;
  conflict: boolean;
  onDecide: (decision: SuggestionDecision) => void;
}) {
  const t = useT();
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
  const status =
    suggestion.status === "accepted"
      ? { icon: IconCircleCheck, label: t("comments.accepted") }
      : suggestion.status === "rejected"
        ? { icon: IconCircleX, label: t("comments.rejected") }
        : suggestion.status === "superseded"
          ? { icon: IconArrowBackUp, label: t("comments.suggestionReplaced") }
          : suggestion.status === "withdrawn"
            ? {
                icon: IconArrowBackUp,
                label: t("comments.suggestionWithdrawn"),
              }
            : null;
  return (
    <div
      className="mt-0.5 grid gap-2"
      data-thread-suggestion={suggestion.id}
      data-thread-suggestion-status={suggestion.status}
    >
      <p className={cn(!pending && "text-muted-foreground")}>
        {suggestion.summary}
      </p>
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
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            disabled={deciding || conflict}
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
            disabled={deciding}
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
      ) : status ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          <status.icon size={14} aria-hidden />
          {status.label}
        </span>
      ) : null}
    </div>
  );
}

/** A thread suggestion whose receipt reply is not in the thread. */
export function ThreadSuggestionRow(
  props: Parameters<typeof ThreadSuggestionBody>[0],
) {
  const model =
    typeof props.suggestion.metadata?.model === "string"
      ? props.suggestion.metadata.model
      : null;
  return (
    <CommentRow
      avatar={<AgentAvatar model={model} />}
      name={agentDisplayName(model)}
    >
      <ThreadSuggestionBody {...props} />
    </CommentRow>
  );
}
