import { actionErrorMessage } from "@agent-native/core/client/hooks";
import type { ContentDatabaseSource } from "@shared/api";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  useContentDatabaseSourceRefreshing,
  useRefreshContentDatabaseSource,
} from "@/hooks/use-content-database";

import { sourceRelativeTime, sourceUpdatedText } from "./source-status-text";
import { NotionLogoMark } from "./SourceLogos";
import {
  SentenceWithName,
  SourceFacts,
  SourceStatusLine,
  useNow,
} from "./SourceStatusLine";
import { dbText } from "./text";

function asSentence(reason: string | null) {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return /[.!?…。！？]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function useNotionSyncNow(
  source: ContentDatabaseSource,
  documentId: string,
) {
  const refresh = useRefreshContentDatabaseSource(documentId);
  const pending = useContentDatabaseSourceRefreshing(source.id);
  const failed = source.syncState === "error" || !!source.lastError;
  const syncNow = () =>
    refresh.mutate(
      { documentId, sourceId: source.id, fullRefresh: true },
      {
        onSuccess: () => toast.success(dbText("notionSyncedToast")),
        onError: (error) =>
          toast.error(
            [
              dbText("sourceProblemNotion"),
              asSentence(
                actionErrorMessage(error) ??
                  (error instanceof Error ? error.message : null),
              ),
            ]
              .filter(Boolean)
              .join(" "),
          ),
      },
    );

  return { pending, failed, reason: source.lastError, syncNow };
}

export function notionSourceProblem(
  source: ContentDatabaseSource,
  reason: string | null,
  now: number,
) {
  return [
    dbText("sourceProblemNotion"),
    asSentence(reason),
    source.lastRefreshedAt
      ? dbText("sourceShowingDetailsAsOf", {
          time: sourceRelativeTime(source.lastRefreshedAt, now),
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

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
  const { pending, failed, reason, syncNow } = useNotionSyncNow(
    source,
    documentId,
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
      sync={canEdit ? { pending, run: syncNow } : null}
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
              text: notionSourceProblem(source, reason, now),
              actions: canEdit ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={pending}
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
