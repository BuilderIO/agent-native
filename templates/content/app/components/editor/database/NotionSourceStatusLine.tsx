import { actionErrorMessage } from "@agent-native/core/client/hooks";
import type { ContentDatabaseSource } from "@shared/api";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useRefreshContentDatabaseSource } from "@/hooks/use-content-database";

import { sourceRelativeTime, sourceUpdatedText } from "./source-status-text";
import { NotionLogoMark } from "./SourceLogos";
import {
  SentenceWithName,
  SourceFacts,
  SourceStatusLine,
  useNow,
} from "./SourceStatusLine";
import { dbText } from "./text";

/** Ends Notion's reason like a sentence, so the sentence after it reads apart. */
function asSentence(reason: string | null) {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return /[.!?…。！？]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The status line of a Notion database that adds details to a collection:
 * which database, when its details last updated, and what went wrong if they
 * couldn't. A failed refresh isn't saved on the source, so one this tab ran
 * shows until the next one works.
 */
export function NotionSourceStatusLine({
  source,
  documentId,
  canEdit,
  pageCount,
  onOpenSource,
}: {
  source: ContentDatabaseSource;
  documentId: string;
  canEdit: boolean;
  pageCount: number;
  onOpenSource?: (() => void) | undefined;
}) {
  const now = useNow();
  const refresh = useRefreshContentDatabaseSource(documentId);
  const [failure, setFailure] = useState<{
    reason: string | null;
    asOf: string | null;
  } | null>(null);
  // Stands only until the source updates, from this tab or any other.
  const localFailure =
    failure && failure.asOf === source.lastRefreshedAt ? failure : null;
  const failed =
    localFailure !== null || source.syncState === "error" || !!source.lastError;
  const reason = localFailure ? localFailure.reason : source.lastError;
  const syncNow = () =>
    refresh.mutate(
      // A one-page read replaces every cached row, so it would drop the rest.
      { documentId, sourceId: source.id, fullRefresh: true },
      {
        onSuccess: () => {
          setFailure(null);
          toast.success(dbText("notionSyncedToast"));
        },
        onError: (error) => {
          setFailure({
            reason:
              actionErrorMessage(error) ??
              (error instanceof Error ? error.message : null),
            asOf: source.lastRefreshedAt,
          });
        },
      },
    );

  return (
    <SourceStatusLine
      provider="notion"
      icon={<NotionLogoMark className="me-1.5 size-3.5 shrink-0" />}
      from={
        <SentenceWithName
          name={source.sourceName}
          sentence={(mark) =>
            dbText("sourceDetailsFromNotionDatabase", { name: mark })
          }
        />
      }
      onOpenSource={onOpenSource}
      updated={failed ? null : sourceUpdatedText(source.lastRefreshedAt, now)}
      facts={
        <SourceFacts
          rows={[
            { label: dbText("sourceDetailDatabase"), value: source.sourceName },
            {
              label: dbText("sourceDetailUpdated"),
              value: source.lastRefreshedAt
                ? sourceRelativeTime(source.lastRefreshedAt, now)
                : dbText("sourceNotUpdatedYet"),
            },
          ]}
        />
      }
      sync={canEdit ? { pending: refresh.isPending, run: syncNow } : null}
      unlink={
        canEdit
          ? {
              provider: "notion",
              documentId,
              sourceId: source.id,
              pageCount,
            }
          : null
      }
      problem={
        failed
          ? {
              text: [
                dbText("sourceProblemNotion"),
                asSentence(reason),
                source.lastRefreshedAt
                  ? dbText("sourceShowingDetailsAsOf", {
                      time: sourceRelativeTime(source.lastRefreshedAt, now),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" "),
              actions: canEdit ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={refresh.isPending}
                  onClick={syncNow}
                >
                  {dbText("retry")}
                </Button>
              ) : null,
            }
          : null
      }
    />
  );
}
