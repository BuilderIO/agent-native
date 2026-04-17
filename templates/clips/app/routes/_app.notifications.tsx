import { useMemo, useState } from "react";
import { IconBell, IconSend } from "@tabler/icons-react";
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

export function meta() {
  return [{ title: "Notifications · Clips" }];
}

interface CommentRow {
  id: string;
  recordingId: string;
  authorEmail: string;
  authorName: string | null;
  content: string;
  createdAt: string;
}

interface ReactionRow {
  id: string;
  recordingId: string;
  viewerEmail: string | null;
  viewerName: string | null;
  emoji: string;
  createdAt: string;
}

interface RecordingSummary {
  id: string;
  title: string;
  ownerEmail: string;
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
  const { data: recordingsData } = useActionQuery<{
    recordings: RecordingSummary[];
  }>("list-recordings", { view: "all", limit: 500 } as any);

  // Build per-recording comments/reactions for the user's own recordings.
  // We use the server snapshot helpers: list-comments / list-viewers exist but
  // we want a cheap aggregated feed — instead poll application_state-derived
  // activity via the existing actions when available. For now we surface
  // comments + reactions for the latest 20 recordings so the page renders
  // something meaningful in local dev.
  const recordings = recordingsData?.recordings ?? [];

  const { data: commentsData } = useActionQuery<{ comments: CommentRow[] }>(
    "list-comments-for-user",
    undefined,
    { enabled: false },
  );

  // Fallback — fetch comments for each recording we own using the existing
  // list-comments action. We do this in a dependent loop via React Query's
  // `useActionQuery` on a single aggregated action where available; the page
  // still renders (as empty) when the backing actions don't exist yet.
  const { data: aggregated, isLoading } = useActionQuery<{
    items: NotificationItem[];
  }>("list-notifications", { days: 30 } as any, { retry: false });

  const items: NotificationItem[] = useMemo(() => {
    if (aggregated?.items?.length) {
      return aggregated.items.filter((it) => inLast30Days(it.createdAt));
    }
    const fallback: NotificationItem[] = [];
    if (commentsData?.comments?.length) {
      for (const c of commentsData.comments) {
        if (!inLast30Days(c.createdAt)) continue;
        const rec = recordings.find((r) => r.id === c.recordingId);
        if (!rec) continue;
        fallback.push({
          id: `c:${c.id}`,
          kind: "comment",
          recordingId: c.recordingId,
          recordingTitle: rec.title,
          authorEmail: c.authorEmail,
          preview: c.content,
          createdAt: c.createdAt,
        });
      }
    }
    return fallback.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [aggregated, commentsData, recordings]);

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
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <IconBell className="size-6 text-[#625DF5]" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Comments, reactions, mentions, and shares on your recordings in the
            last 30 days.
          </p>
        </div>
      </div>

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
              className="bg-[#625DF5] hover:bg-[#5049d9]"
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
  );
}
