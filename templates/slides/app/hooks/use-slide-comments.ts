import {
  emailToColor,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";

export interface SlideComment {
  id: string;
  deck_id: string;
  slide_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  quoted_text: string | null;
  author_email: string;
  author_name: string | null;
  resolved: number | boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentThread {
  threadId: string;
  quotedText: string | null;
  resolved: boolean;
  comments: SlideComment[];
}

function isResolved(
  val: number | boolean | string | null | undefined,
): boolean {
  return val === true || val === 1 || val === "1" || val === "true";
}

function groupIntoThreads(comments: SlideComment[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  for (const c of comments) {
    if (!map.has(c.thread_id)) {
      map.set(c.thread_id, {
        threadId: c.thread_id,
        quotedText: c.quoted_text,
        resolved: isResolved(c.resolved),
        comments: [],
      });
    }
    map.get(c.thread_id)!.comments.push(c);
  }
  return Array.from(map.values());
}

export function useSlideComments(
  deckId: string | null,
  slideId: string | null,
) {
  return useActionQuery<CommentThread[]>(
    "list-slide-comments",
    deckId && slideId ? { deckId, slideId } : undefined,
    {
      enabled: !!(deckId && slideId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (data: any) => {
        const raw = data?.comments ?? data;
        const comments: SlideComment[] = Array.isArray(raw) ? raw : [];
        return groupIntoThreads(comments);
      },
    },
  );
}

export function useCreateSlideComment() {
  return useActionMutation("add-slide-comment");
}

export function useResolveSlideComment() {
  return useActionMutation<
    { ok: boolean; resolved?: boolean },
    { id: string; resolved?: boolean }
  >("update-slide-comment");
}

export function useDeleteSlideComment() {
  return useActionMutation<{ ok: boolean }, { id: string }>(
    "delete-slide-comment",
  );
}

/** Derive a display color for an author email */
export { emailToColor };

/** Relative time string (e.g., "2 min ago") */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
