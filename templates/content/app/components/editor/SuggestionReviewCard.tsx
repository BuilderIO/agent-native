import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useDecideResourceSuggestion,
  useDecideResourceSuggestionProposal,
  useResourceSuggestions,
} from "@agent-native/core/client/review";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import { IconFileText } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { ContentIcon } from "@/components/icons/ContentIcon";
import { useDocument } from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

import { SuggestionReviewCardSkeleton } from "./SuggestionReviewCardSkeleton";
import { proposalGroups } from "./thread-suggestions";
import { ThreadSuggestionBody } from "./ThreadSuggestion";

type DecisionProblem = { groupKey: string; message: string };

function actionErrorCode(error: unknown): unknown {
  return (error as { errorCode?: unknown } | null)?.errorCode;
}

function groupKey(group: ResourceSuggestion[]): string {
  return group[0]?.proposalId ?? group[0]?.id ?? "";
}

// Claude mounts the card into its own document and pins an "Open in new tab"
// button over the top-right corner.
function isTransplantedEmbed(): boolean {
  return (
    typeof window !== "undefined" && "__AGENT_NATIVE_EXTERNAL_EMBED" in window
  );
}

/**
 * The suggestions one agent call made, shown on their own so a reviewer can
 * accept or reject them where the agent is. Every edit of a proposal shows,
 * so deciding all of them decides exactly what the card shows.
 */
export function SuggestionReviewCard({
  documentId,
  suggestionIds,
}: {
  documentId: string;
  suggestionIds: readonly string[];
}) {
  const t = useT();
  const documentQuery = useDocument(documentId);
  const suggestionsQuery = useResourceSuggestions({
    resourceType: "document",
    resourceId: documentId,
  });
  const decideSuggestion = useDecideResourceSuggestion();
  const decideProposal = useDecideResourceSuggestionProposal();
  const [unplaceable, setUnplaceable] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [problem, setProblem] = useState<DecisionProblem | null>(null);
  const [transplanted] = useState(isTransplantedEmbed);

  const groups = useMemo(() => {
    const all = suggestionsQuery.data?.suggestions ?? [];
    const wanted = new Set(suggestionIds);
    const proposals = new Set(
      all
        .filter((suggestion) => wanted.has(suggestion.id))
        .map((suggestion) => suggestion.proposalId)
        .filter(Boolean),
    );
    return proposalGroups(
      all.filter(
        (suggestion) =>
          wanted.has(suggestion.id) ||
          (suggestion.proposalId && proposals.has(suggestion.proposalId)),
      ),
    );
  }, [suggestionsQuery.data, suggestionIds]);

  const document = documentQuery.data;
  const canDecide = document?.canEdit === true;
  const deciding = decideSuggestion.isPending || decideProposal.isPending;

  const handleFailure = async (
    error: unknown,
    group: ResourceSuggestion[],
    decided: ResourceSuggestion[],
  ) => {
    const key = groupKey(group);
    if (actionErrorCode(error) === "suggestion_stale") {
      if (decided.length === 1) {
        const [suggestion] = decided;
        setUnplaceable((current) =>
          new Map(current).set(suggestion!.id, suggestion!.revision),
        );
      }
      setProblem({
        groupKey: key,
        message: t(
          decided.length === 1
            ? "editor.suggestionUnplaceable"
            : "editor.proposalUnplaceable",
        ),
      });
      return;
    }
    const refreshed = await suggestionsQuery.refetch();
    // Someone decided it elsewhere first: the card now shows how it ended.
    const stillPending = decided.some((suggestion) =>
      refreshed.data?.suggestions.some(
        (current) =>
          current.id === suggestion.id && current.status === "pending",
      ),
    );
    if (actionErrorCode(error) === "suggestion_conflict" && !stillPending)
      return;
    setProblem({
      groupKey: key,
      message: actionErrorMessage(error) ?? t("empty.genericError"),
    });
  };

  const onDecide = async (
    group: ResourceSuggestion[],
    suggestion: ResourceSuggestion,
    decision: SuggestionDecision,
  ) => {
    if (deciding) return;
    setProblem(null);
    try {
      await decideSuggestion.mutateAsync({
        id: suggestion.id,
        decision,
        idempotencyKey: globalThis.crypto.randomUUID(),
        observedBase: suggestion.baseRevision,
        observedRevision: suggestion.revision,
      });
      void suggestionsQuery.refetch();
    } catch (error) {
      await handleFailure(error, group, [suggestion]);
    }
  };

  const onDecideRemaining = async (
    group: ResourceSuggestion[],
    decision: SuggestionDecision,
  ) => {
    const proposalId = group[0]?.proposalId;
    const members = group.filter(
      (suggestion) => suggestion.status === "pending",
    );
    if (deciding || !proposalId || members.length === 0) return;
    setProblem(null);
    try {
      await decideProposal.mutateAsync({
        proposalId,
        decision,
        idempotencyKey: globalThis.crypto.randomUUID(),
        members: members.map((member) => ({
          id: member.id,
          observedRevision: member.revision,
          observedBase: member.baseRevision,
        })),
      });
      void suggestionsQuery.refetch();
    } catch (error) {
      await handleFailure(error, group, members);
    }
  };

  const loading =
    documentQuery.isPending ||
    (suggestionsQuery.isPending && !documentQuery.isError);
  const unavailable =
    documentQuery.isError ||
    suggestionsQuery.isError ||
    (!loading && groups.length === 0);

  return (
    <main
      className="min-h-screen bg-background text-sm text-foreground"
      data-suggestion-review-card
    >
      <div className="grid grid-cols-1 gap-3 p-4">
        {loading ? (
          <div role="status" aria-label={t("root.loadingContent")}>
            <SuggestionReviewCardSkeleton />
          </div>
        ) : unavailable ? (
          <p role="status" className="text-muted-foreground">
            {documentQuery.isError
              ? t("empty.documentNotFound")
              : t("comments.linkUnavailable")}
          </p>
        ) : (
          <>
            <header
              className={cn(
                "flex min-w-0 items-center gap-2",
                transplanted && "pe-32",
              )}
            >
              <ContentIcon
                value={document?.icon}
                size={16}
                fallback={
                  <IconFileText className="size-4 shrink-0 text-muted-foreground" />
                }
              />
              <h1 className="min-w-0 truncate font-medium">
                {document?.title?.trim() || t("sidebar.untitled")}
              </h1>
            </header>
            {groups.map((group) => {
              const key = groupKey(group);
              return (
                <section
                  key={key}
                  className="grid grid-cols-1 gap-2 border-t border-border pt-3"
                >
                  <ThreadSuggestionBody
                    suggestions={group}
                    canDecide={canDecide}
                    busy={() => deciding}
                    conflict={(suggestion) =>
                      unplaceable.get(suggestion.id) === suggestion.revision
                    }
                    onDecide={(suggestion, decision) =>
                      void onDecide(group, suggestion, decision)
                    }
                    onDecideRemaining={(decision) =>
                      void onDecideRemaining(group, decision)
                    }
                  />
                  {problem?.groupKey === key ? (
                    <p role="alert" className="text-xs text-destructive">
                      {problem.message}
                    </p>
                  ) : null}
                </section>
              );
            })}
            {!canDecide &&
            groups.some((group) =>
              group.some((suggestion) => suggestion.status === "pending"),
            ) ? (
              <p className="text-xs text-muted-foreground">
                {t("comments.suggestionReviewReadOnly")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
