import type {
  ClipComment,
  ClipCommentThread,
} from "@shared/clips-peer-contract";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Comment, CommentThread } from "@/hooks/use-comments";

/** A comment shown before Clips has it: the id of the write saving it. */
export type ClipCommentView = ClipComment & { operationId?: string };

export type ClipThreadView = Omit<ClipCommentThread, "replies"> & {
  operationId?: string;
  replies: ClipCommentView[];
};

/** A Clip placed in a page, with the comments the reader can see on it. */
export interface ClipCommentSource {
  recordingId: string;
  /** Open threads, in the order of the moments they're at. */
  threads: readonly ClipThreadView[];
  /** Clips takes comments on this Clip from the reader. */
  canComment: boolean;
  /** The reader owns the Clip, which lets them resolve any of its threads. */
  isOwner: boolean;
  /** The Blocks field tab the Clip is in; null is the page body. */
  fieldId: string | null;
}

/** What the page's comment margin does for the Clips placed in it. */
export interface ClipCommentHost {
  /** The reader can comment on the page. */
  canCompose: boolean;
  /** Starts a comment at `ms` into the Clip's video. */
  compose: (recordingId: string, ms: number) => void;
  /** Opens a thread's card in the margin, by its margin thread id. */
  openThread: (threadId: string) => void;
}

/** What the margin has open: a new comment's Clip, and the open thread. */
export type ClipCommentFocus = {
  pendingRecordingId: string | null;
  activeThreadId: string | null;
};

type PageClips = {
  sources: Map<symbol, ClipCommentSource>;
  sourceList: ClipCommentSource[];
  seekers: Map<symbol, { recordingId: string; seek: (ms: number) => void }>;
  playheads: Map<string, number>;
  host: ClipCommentHost | null;
  focus: ClipCommentFocus;
};

const pages = new Map<string, PageClips>();
const listeners = new Set<() => void>();
const playheadListeners = new Set<() => void>();
const NO_SOURCES: ClipCommentSource[] = [];

function page(documentId: string): PageClips {
  let clips = pages.get(documentId);
  if (!clips) {
    clips = {
      sources: new Map(),
      sourceList: NO_SOURCES,
      seekers: new Map(),
      playheads: new Map(),
      host: null,
      focus: { pendingRecordingId: null, activeThreadId: null },
    };
    pages.set(documentId, clips);
  }
  return clips;
}

function emit(set: ReadonlySet<() => void>) {
  for (const listener of set) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function subscribePlayheads(listener: () => void) {
  playheadListeners.add(listener);
  return () => void playheadListeners.delete(listener);
}

/**
 * Where a Clip's thread sits in the page's comment margin. Clips' ids name
 * nothing in Content, so the margin's id carries the Clip's too.
 */
export function clipMarginThreadId(recordingId: string, clipThreadId: string) {
  return `clip:${recordingId}:${clipThreadId}`;
}

export function optimisticClipCommentId(operationId: string) {
  return `optimistic-${operationId}`;
}

/** Puts a Clip's comments in its page's margin until it goes away. */
export function usePublishClipComments(
  documentId: string,
  source: ClipCommentSource | null,
) {
  const key = useMemo(() => Symbol("clip-comments"), []);
  useEffect(() => {
    const clips = page(documentId);
    if (source) clips.sources.set(key, source);
    else if (!clips.sources.delete(key)) return;
    clips.sourceList = [...clips.sources.values()];
    emit(listeners);
  }, [documentId, key, source]);
  useEffect(
    () => () => {
      const clips = page(documentId);
      if (!clips.sources.delete(key)) return;
      clips.sourceList = [...clips.sources.values()];
      emit(listeners);
    },
    [documentId, key],
  );
}

/** The Clips placed in a page whose comments the reader can see. */
export function useClipCommentSources(documentId: string) {
  return useSyncExternalStore(
    subscribe,
    () => pages.get(documentId)?.sourceList ?? NO_SOURCES,
    () => NO_SOURCES,
  );
}

/** Lets the Clips placed in a page open its margin, while the page shows. */
export function useClipCommentHost(
  documentId: string,
  host: ClipCommentHost | null,
) {
  useEffect(() => {
    if (!host) return;
    const clips = page(documentId);
    clips.host = host;
    emit(listeners);
    return () => {
      if (clips.host !== host) return;
      clips.host = null;
      emit(listeners);
    };
  }, [documentId, host]);
}

/** Tells the page's Clips what its margin has open. */
export function useClipCommentFocus(
  documentId: string,
  pendingRecordingId: string | null,
  activeThreadId: string | null,
) {
  useEffect(() => {
    const clips = page(documentId);
    clips.focus = { pendingRecordingId, activeThreadId };
    emit(listeners);
  }, [activeThreadId, documentId, pendingRecordingId]);
  useEffect(
    () => () => {
      const clips = pages.get(documentId);
      if (!clips) return;
      clips.focus = { pendingRecordingId: null, activeThreadId: null };
      emit(listeners);
    },
    [documentId],
  );
}

/**
 * How a Clip is marked: `pending` while a new comment on it waits, `active`
 * while one of its threads is open or pointed at.
 */
export function useClipCommentEmphasis(
  documentId: string,
  recordingId: string,
  threadIds: readonly string[],
): "pending" | "active" | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const focus = pages.get(documentId)?.focus;
      if (!focus) return null;
      if (focus.pendingRecordingId === recordingId) return "pending";
      return focus.activeThreadId && threadIds.includes(focus.activeThreadId)
        ? "active"
        : null;
    },
    () => null,
  );
}

/** The page's margin, when it has one for its Clips' comments. */
export function useClipCommentHostOf(documentId: string) {
  return useSyncExternalStore(
    subscribe,
    () => pages.get(documentId)?.host ?? null,
    () => null,
  );
}

/** Lets the margin move a Clip's video to a moment, while it plays here. */
export function useClipSeeker(
  documentId: string,
  recordingId: string,
  seek: ((ms: number) => void) | null,
) {
  useEffect(() => {
    if (!seek) return;
    const clips = page(documentId);
    const key = Symbol("clip-seeker");
    clips.seekers.set(key, { recordingId, seek });
    return () => void clips.seekers.delete(key);
  }, [documentId, recordingId, seek]);
}

/**
 * Moves the Clip's video to `ms`. A Clip placed twice moves where it was
 * placed first, the copy whose threads the margin sits beside.
 */
export function seekClip(documentId: string, recordingId: string, ms: number) {
  for (const seeker of pages.get(documentId)?.seekers.values() ?? []) {
    if (seeker.recordingId !== recordingId) continue;
    seeker.seek(ms);
    return true;
  }
  return false;
}

export function setClipPlayhead(
  documentId: string,
  recordingId: string,
  ms: number,
) {
  const clips = page(documentId);
  if (clips.playheads.get(recordingId) === ms) return;
  clips.playheads.set(recordingId, ms);
  emit(playheadListeners);
}

function clipPlayhead(documentId: string, recordingId: string) {
  return pages.get(documentId)?.playheads.get(recordingId) ?? 0;
}

/**
 * The thread the Clip's playhead last passed: the last at or before it, in
 * the order of their moments. Of several at that moment, `preferred` if it is
 * one of them.
 */
export function clipThreadPassed<T extends Pick<CommentThread, "threadId">>(
  threads: readonly (T & { clip?: CommentThread["clip"] })[],
  playheadMs: number,
  preferred?: string | null,
): T | null {
  let passedMs = -1;
  for (const thread of threads) {
    const ms = thread.clip?.videoTimestampMs;
    if (ms !== undefined && ms <= playheadMs && ms > passedMs) passedMs = ms;
  }
  const atPassed = threads.filter(
    (thread) => thread.clip?.videoTimestampMs === passedMs,
  );
  return (
    atPassed.find((thread) => thread.threadId === preferred) ??
    atPassed[atPassed.length - 1] ??
    null
  );
}

/**
 * The thread each folded Clip stack shows: the one its Clip's playhead last
 * passed. Re-renders only when one of them changes, not on every frame.
 */
export function useClipStackFronts(
  documentId: string,
  stacks: readonly { key: string; threads: readonly CommentThread[] }[],
  preferred: (stack: { threads: readonly CommentThread[] }) => string | null,
): ReadonlyMap<string, string> {
  const read = () =>
    stacks
      .flatMap((stack) => {
        const recordingId = stack.threads[0]?.clip?.recordingId;
        if (!recordingId) return [];
        const front = clipThreadPassed(
          stack.threads,
          clipPlayhead(documentId, recordingId),
          preferred(stack),
        );
        return front ? [`${stack.key}\u0000${front.threadId}`] : [];
      })
      .join("\u0001");
  const snapshot = useSyncExternalStore(subscribePlayheads, read, () => "");
  return useMemo(
    () =>
      new Map(
        snapshot
          ? snapshot.split("\u0001").map((entry) => {
              const [key = "", threadId = ""] = entry.split("\u0000");
              return [key, threadId] as const;
            })
          : [],
      ),
    [snapshot],
  );
}

function marginComment(
  documentId: string,
  threadId: string,
  parentId: string | null,
  comment: ClipCommentView,
): Comment {
  return {
    id: comment.id,
    document_id: documentId,
    thread_id: threadId,
    parent_id: parentId,
    content: comment.content,
    quoted_text: null,
    anchor_prefix: null,
    anchor_suffix: null,
    anchor_start_offset: null,
    mentions: [],
    author_email: comment.authorEmail ?? "",
    author_name: comment.authorName,
    resolved: 0,
    created_at: comment.createdAt,
    updated_at: comment.createdAt,
    notion_comment_id: null,
    ...(comment.operationId
      ? {
          mutation: {
            operationId: comment.operationId,
            kind: "create" as const,
            status: "pending" as const,
          },
        }
      : {}),
  };
}

/** A page's Clips' open threads, as the margin's comment threads. */
export function clipCommentThreads(
  documentId: string,
  sources: readonly ClipCommentSource[],
  currentUserEmail: string | null | undefined,
): CommentThread[] {
  const me = currentUserEmail?.trim().toLowerCase() || null;
  const placed = new Set<string>();
  const threads: CommentThread[] = [];
  for (const source of sources) {
    // A Clip placed twice shows its threads once, beside the first.
    if (placed.has(source.recordingId)) continue;
    placed.add(source.recordingId);
    for (const thread of source.threads) {
      const threadId = clipMarginThreadId(source.recordingId, thread.id);
      const own =
        me !== null && (thread.authorEmail ?? "").toLowerCase() === me;
      threads.push({
        threadId,
        quotedText: null,
        prefix: null,
        suffix: null,
        startOffset: null,
        field: source.fieldId
          ? { fieldId: source.fieldId, fieldName: null }
          : null,
        clip: {
          recordingId: source.recordingId,
          threadId: thread.id,
          videoTimestampMs: thread.videoTimestampMs,
          canComment: source.canComment,
          canResolve: source.canComment && (source.isOwner || own),
        },
        resolved: false,
        comments: [
          marginComment(documentId, threadId, null, thread),
          ...thread.replies.map((reply) =>
            marginComment(documentId, threadId, thread.id, reply),
          ),
        ],
      });
    }
  }
  return threads;
}
