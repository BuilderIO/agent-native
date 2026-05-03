import { useMemo, useState } from "react";
import { IconSend } from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  NotificationsList,
  type NotificationItem,
  type NotificationKind,
} from "@/components/workspace/notifications-list";
import { PageHeader } from "@/components/library/page-header";

export function meta() {
  return [{ title: "Notifications · Clips" }];
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
  const [filter, setFilter] = useState<"all" | NotificationKind>("all");
  const [replyFor, setReplyFor] = useState<NotificationItem | null>(null);
  const [replyText, setReplyText] = useState("");

  const qc = useQueryClient();
  const { data: aggregated, isLoading } = useActionQuery<{
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
      toast.success("Reply sent");
      setReplyText("");
      setReplyFor(null);
      qc.invalidateQueries({ queryKey: ["action", "list-notifications"] });
      qc.invalidateQueries({ queryKey: ["action", "list-comments"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  }

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Notifications
        </h1>
      </PageHeader>
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-muted-foreground mb-4">
          Comments, reactions, mentions, and shares on your recordings in the
          last 30 days.
        </p>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="comment">Comments</TabsTrigger>
            <TabsTrigger value="reaction">Reactions</TabsTrigger>
            <TabsTrigger value="mention">Mentions</TabsTrigger>
            <TabsTrigger value="share">Shares</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <NotificationsList items={filtered} onReply={setReplyFor} />
          )}
        </div>

        {replyFor ? (
          <div className="mt-6 rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground mb-1.5">
              Reply to {replyFor.authorEmail} on{" "}
              <span className="font-medium text-foreground">
                {replyFor.recordingTitle}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply…"
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
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
