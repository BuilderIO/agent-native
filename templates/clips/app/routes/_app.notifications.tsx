import {
  useActionQuery,
  useActionMutation,
  useT,
} from "@agent-native/core/client";
import { IconAlertTriangle, IconSend } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/library/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  NotificationsList,
  type NotificationItem,
  type NotificationKind,
} from "@/components/workspace/notifications-list";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.notificationsRoute.pageTitle }];
}

function inLast30Days(iso: string): boolean {
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return new Date(iso).getTime() >= cutoff;
  } catch {
    return false;
  }
}

export default function NotificationsRoute() {
  const t = useT();
  const [filter, setFilter] = useState<"all" | NotificationKind>("all");
  const [replyFor, setReplyFor] = useState<NotificationItem | null>(null);
  const [replyText, setReplyText] = useState("");

  const qc = useQueryClient();
  const {
    data: aggregated,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useActionQuery<{
    items: NotificationItem[];
  }>("list-notifications", { days: 30 } as any, { retry: false });

  const items: NotificationItem[] = useMemo(() => {
    if (aggregated?.items?.length) {
      return aggregated.items.filter((it) => inLast30Days(it.createdAt));
    }
    return [];
  }, [aggregated]);

  const filtered = items.filter((i) => filter === "all" || i.kind === filter);

  const addComment = useActionMutation<
    any,
    {
      recordingId: string;
      content: string;
      threadId?: string;
      parentId?: string;
      videoTimestampMs?: number;
    }
  >("add-comment");

  async function handleSendReply() {
    if (!replyFor) return;
    const content = replyText.trim();
    if (!content) return;
    try {
      await addComment.mutateAsync({
        recordingId: replyFor.recordingId,
        content,
        threadId: replyFor.id.replace(/^c:/, ""),
      });
      toast.success(t("notificationsRoute.replySent"));
      setReplyText("");
      setReplyFor(null);
      qc.invalidateQueries({ queryKey: ["action", "list-notifications"] });
      qc.invalidateQueries({ queryKey: ["action", "list-comments"] });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("notificationsRoute.sendFailed"),
      );
    }
  }

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          {t("notificationsRoute.title")}
        </h1>
      </PageHeader>
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-muted-foreground mb-4">
          {t("notificationsRoute.description")}
        </p>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">{t("notificationsRoute.all")}</TabsTrigger>
            <TabsTrigger value="comment">
              {t("notificationsRoute.comments")}
            </TabsTrigger>
            <TabsTrigger value="reaction">
              {t("notificationsRoute.reactions")}
            </TabsTrigger>
            <TabsTrigger value="mention">
              {t("notificationsRoute.mentions")}
            </TabsTrigger>
            <TabsTrigger value="share">
              {t("notificationsRoute.shares")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {t("notificationsRoute.loading")}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <IconAlertTriangle className="size-9 text-destructive" />
              <p className="text-sm font-medium">
                {t("libraryGrid.loadFailedTitle")}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                {t("libraryGrid.retry")}
              </Button>
            </div>
          ) : (
            <NotificationsList items={filtered} onReply={setReplyFor} />
          )}
        </div>

        {replyFor ? (
          <div className="mt-6 rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground mb-1.5">
              {t("notificationsRoute.replyTo", {
                email: replyFor.authorEmail,
              })}{" "}
              <span className="font-medium text-foreground">
                {replyFor.recordingTitle}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={t("notificationsRoute.replyPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
                autoFocus
              />
              <Button
                onClick={handleSendReply}
                disabled={!replyText.trim() || addComment.isPending}
                className="bg-primary hover:bg-primary/90"
              >
                <IconSend className="size-4" />
              </Button>
              <Button variant="ghost" onClick={() => setReplyFor(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
