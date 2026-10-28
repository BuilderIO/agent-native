import { useActionMutation } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  optimisticClipCommentId,
  type ClipCommentView,
  type ClipThreadView,
} from "./clip-comments";

export type ClipCommentList = {
  threads: ClipThreadView[];
  truncated: boolean;
};

type AddClipComment = {
  documentId: string;
  recordingId: string;
  content: string;
  videoTimestampMs?: number;
  threadId?: string;
};

type ResolveClipComment = {
  documentId: string;
  recordingId: string;
  threadId: string;
  resolved: boolean;
};

export function clipCommentListKey(documentId: string, recordingId: string) {
  return ["action", "list-clip-comments", { documentId, recordingId }] as const;
}

/** A write `savedId` names once Clips has taken it. */
type ClipCommentWrite =
  | { kind: "thread"; thread: ClipThreadView; savedId?: string }
  | {
      kind: "reply";
      threadId: string;
      reply: ClipCommentView;
      savedId?: string;
    }
  | { kind: "resolve"; threadId: string };

type PendingWrite = ClipCommentWrite & { id: number };

// Writes wait beside the Clip's list rather than in it: a read landing first
// would replace them there, and taking a refused one back must not undo what
// that read brought.
const pendingWrites = new Map<string, readonly PendingWrite[]>();
const pendingListeners = new Set<() => void>();
const NO_WRITES: readonly PendingWrite[] = [];
let lastWriteId = 0;

function clipKey(documentId: string, recordingId: string) {
  return JSON.stringify([documentId, recordingId]);
}

function changeWrites(
  key: string,
  update: (writes: readonly PendingWrite[]) => readonly PendingWrite[],
) {
  const writes = update(pendingWrites.get(key) ?? NO_WRITES);
  if (writes.length) pendingWrites.set(key, writes);
  else pendingWrites.delete(key);
  for (const listener of pendingListeners) listener();
}

function subscribeWrites(listener: () => void) {
  pendingListeners.add(listener);
  return () => void pendingListeners.delete(listener);
}

/** Puts a thread after every thread at or before its moment, as Clips does. */
function withThread(threads: ClipThreadView[], thread: ClipThreadView) {
  const index = threads.findIndex(
    (other) => other.videoTimestampMs > thread.videoTimestampMs,
  );
  return index < 0
    ? [...threads, thread]
    : [...threads.slice(0, index), thread, ...threads.slice(index)];
}

function withWrites(
  threads: ClipThreadView[],
  writes: readonly PendingWrite[],
): ClipThreadView[] {
  let shown = threads;
  for (const write of writes) {
    if (write.kind !== "thread") continue;
    const { savedId } = write;
    if (savedId === undefined) shown = withThread(shown, write.thread);
    else if (!shown.some((thread) => thread.id === savedId)) {
      shown = withThread(shown, {
        ...write.thread,
        id: savedId,
        operationId: undefined,
      });
    }
  }
  for (const write of writes) {
    if (write.kind !== "reply") continue;
    const { savedId } = write;
    shown = shown.map((thread) =>
      thread.id !== write.threadId ||
      (savedId !== undefined &&
        thread.replies.some((reply) => reply.id === savedId))
        ? thread
        : {
            ...thread,
            replyCount: thread.replyCount + 1,
            replies: [
              ...thread.replies,
              savedId === undefined
                ? write.reply
                : { ...write.reply, id: savedId, operationId: undefined },
            ],
          },
    );
  }
  // The list holds open threads only, so a resolved one leaves it.
  const resolving = new Set(
    writes.flatMap((write) =>
      write.kind === "resolve" ? [write.threadId] : [],
    ),
  );
  return resolving.size
    ? shown.filter((thread) => !resolving.has(thread.id))
    : shown;
}

/**
 * A Clip's listed threads with the reader's writes to them: each shows from
 * the moment it's made until Clips refuses it, or until the list read after
 * Clips took it has landed.
 */
export function useClipThreadsWithWrites(
  documentId: string,
  recordingId: string,
  threads: ClipThreadView[] | undefined,
) {
  const key = clipKey(documentId, recordingId);
  const writes = useSyncExternalStore(
    subscribeWrites,
    () => pendingWrites.get(key) ?? NO_WRITES,
    () => NO_WRITES,
  );
  return useMemo(
    () => (threads && writes.length ? withWrites(threads, writes) : threads),
    [threads, writes],
  );
}

/**
 * Comments on a page's Clips, saved in Clips. Each write shows on the Clip's
 * list at once and is taken back if Clips refuses it; the list is read again
 * either way, since only Clips knows what it kept.
 */
export function useClipCommentWrites(
  documentId: string,
  author: { email?: string | null; name?: string | null },
) {
  const queryClient = useQueryClient();
  const add = useActionMutation<
    { id: string; threadId: string },
    AddClipComment
  >("add-clip-comment", { skipActionQueryInvalidation: true });
  const resolve = useActionMutation<
    { id: string; resolved: boolean },
    ResolveClipComment
  >("resolve-clip-comment", { skipActionQueryInvalidation: true });
  const { mutateAsync: addAsync } = add;
  const { mutateAsync: resolveAsync } = resolve;
  const authorEmail = author.email?.trim() || null;
  const authorName = author.name?.trim() || authorEmail;

  const reread = useCallback(
    (recordingId: string) =>
      queryClient.invalidateQueries({
        queryKey: clipCommentListKey(documentId, recordingId),
        exact: true,
      }),
    [documentId, queryClient],
  );
  const draft = useCallback(
    (operationId: string, content: string): ClipCommentView => ({
      id: optimisticClipCommentId(operationId),
      authorEmail,
      authorName,
      content,
      createdAt: new Date().toISOString(),
      operationId,
    }),
    [authorEmail, authorName],
  );

  const send = useCallback(
    async <T>(
      recordingId: string,
      write: ClipCommentWrite,
      save: () => Promise<T>,
      savedIdOf?: (saved: T) => string,
    ) => {
      const key = clipKey(documentId, recordingId);
      const id = ++lastWriteId;
      const drop = () =>
        changeWrites(key, (writes) =>
          writes.filter((entry) => entry.id !== id),
        );
      changeWrites(key, (writes) => [...writes, { ...write, id }]);
      const saved = await save().catch((error: unknown) => {
        drop();
        void reread(recordingId);
        throw error;
      });
      const savedId = savedIdOf?.(saved);
      if (savedId !== undefined) {
        changeWrites(key, (writes) =>
          writes.map((entry) =>
            entry.id === id && entry.kind !== "resolve"
              ? { ...entry, savedId }
              : entry,
          ),
        );
      }
      void reread(recordingId).finally(drop);
      return saved;
    },
    [documentId, reread],
  );

  const startThread = useCallback(
    (input: {
      recordingId: string;
      content: string;
      videoTimestampMs: number;
      operationId: string;
    }) =>
      send(
        input.recordingId,
        {
          kind: "thread",
          thread: {
            ...draft(input.operationId, input.content),
            videoTimestampMs: input.videoTimestampMs,
            replyCount: 0,
            replies: [],
          },
        },
        () =>
          addAsync({
            documentId,
            recordingId: input.recordingId,
            content: input.content,
            videoTimestampMs: input.videoTimestampMs,
          }),
        (saved) => saved.threadId,
      ),
    [addAsync, documentId, draft, send],
  );

  const reply = useCallback(
    (input: {
      recordingId: string;
      threadId: string;
      content: string;
      operationId: string;
    }) =>
      send(
        input.recordingId,
        {
          kind: "reply",
          threadId: input.threadId,
          reply: draft(input.operationId, input.content),
        },
        () =>
          addAsync({
            documentId,
            recordingId: input.recordingId,
            content: input.content,
            threadId: input.threadId,
          }),
        (saved) => saved.id,
      ),
    [addAsync, documentId, draft, send],
  );

  const resolveThread = useCallback(
    (input: { recordingId: string; threadId: string }) =>
      send(
        input.recordingId,
        { kind: "resolve", threadId: input.threadId },
        () =>
          resolveAsync({
            documentId,
            recordingId: input.recordingId,
            threadId: input.threadId,
            resolved: true,
          }),
      ),
    [documentId, resolveAsync, send],
  );

  return useMemo(
    () => ({ startThread, reply, resolveThread }),
    [reply, resolveThread, startThread],
  );
}
