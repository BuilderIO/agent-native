import { useActionMutation } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

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

/** Puts a thread after every thread at or before its moment, as Clips does. */
function withThread(threads: ClipThreadView[], thread: ClipThreadView) {
  const index = threads.findIndex(
    (other) => other.videoTimestampMs > thread.videoTimestampMs,
  );
  return index < 0
    ? [...threads, thread]
    : [...threads.slice(0, index), thread, ...threads.slice(index)];
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
  const add = useActionMutation<{ id: string; threadId: string }, AddClipComment>(
    "add-clip-comment",
    { skipActionQueryInvalidation: true },
  );
  const resolve = useActionMutation<
    { id: string; resolved: boolean },
    ResolveClipComment
  >("resolve-clip-comment", { skipActionQueryInvalidation: true });
  const { mutateAsync: addAsync } = add;
  const { mutateAsync: resolveAsync } = resolve;
  const authorEmail = author.email?.trim() || null;
  const authorName = author.name?.trim() || authorEmail;

  const change = useCallback(
    async (
      recordingId: string,
      update: (list: ClipCommentList) => ClipCommentList,
    ) => {
      const queryKey = clipCommentListKey(documentId, recordingId);
      // A read already on its way would land over the change.
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<ClipCommentList>(queryKey, (list) =>
        list ? update(list) : list,
      );
    },
    [documentId, queryClient],
  );
  const reread = useCallback(
    (recordingId: string) =>
      void queryClient.invalidateQueries({
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

  const startThread = useCallback(
    async (input: {
      recordingId: string;
      content: string;
      videoTimestampMs: number;
      operationId: string;
    }) => {
      const { recordingId, operationId } = input;
      await change(recordingId, (list) => ({
        ...list,
        threads: withThread(list.threads, {
          ...draft(operationId, input.content),
          videoTimestampMs: input.videoTimestampMs,
          replyCount: 0,
          replies: [],
        }),
      }));
      try {
        const saved = await addAsync({
          documentId,
          recordingId,
          content: input.content,
          videoTimestampMs: input.videoTimestampMs,
        });
        await change(recordingId, (list) => ({
          ...list,
          threads: list.threads.map((thread) =>
            thread.operationId === operationId
              ? { ...thread, id: saved.threadId, operationId: undefined }
              : thread,
          ),
        }));
        return saved;
      } catch (error) {
        await change(recordingId, (list) => ({
          ...list,
          threads: list.threads.filter(
            (thread) => thread.operationId !== operationId,
          ),
        }));
        throw error;
      } finally {
        reread(recordingId);
      }
    },
    [addAsync, change, documentId, draft, reread],
  );

  const reply = useCallback(
    async (input: {
      recordingId: string;
      threadId: string;
      content: string;
      operationId: string;
    }) => {
      const { recordingId, threadId, operationId } = input;
      const onThread = (
        list: ClipCommentList,
        update: (thread: ClipThreadView) => ClipThreadView,
      ) => ({
        ...list,
        threads: list.threads.map((thread) =>
          thread.id === threadId ? update(thread) : thread,
        ),
      });
      await change(recordingId, (list) =>
        onThread(list, (thread) => ({
          ...thread,
          replyCount: thread.replyCount + 1,
          replies: [...thread.replies, draft(operationId, input.content)],
        })),
      );
      try {
        const saved = await addAsync({
          documentId,
          recordingId,
          content: input.content,
          threadId,
        });
        await change(recordingId, (list) =>
          onThread(list, (thread) => ({
            ...thread,
            replies: thread.replies.map((entry) =>
              entry.operationId === operationId
                ? { ...entry, id: saved.id, operationId: undefined }
                : entry,
            ),
          })),
        );
        return saved;
      } catch (error) {
        await change(recordingId, (list) =>
          onThread(list, (thread) => ({
            ...thread,
            replyCount: Math.max(0, thread.replyCount - 1),
            replies: thread.replies.filter(
              (entry) => entry.operationId !== operationId,
            ),
          })),
        );
        throw error;
      } finally {
        reread(recordingId);
      }
    },
    [addAsync, change, documentId, draft, reread],
  );

  // The list holds open threads only, so a resolved one leaves it.
  const resolveThread = useCallback(
    async (input: { recordingId: string; threadId: string }) => {
      const { recordingId, threadId } = input;
      let taken: ClipThreadView | undefined;
      await change(recordingId, (list) => {
        taken = list.threads.find((thread) => thread.id === threadId);
        return taken
          ? {
              ...list,
              threads: list.threads.filter((thread) => thread !== taken),
            }
          : list;
      });
      try {
        await resolveAsync({
          documentId,
          recordingId,
          threadId,
          resolved: true,
        });
      } catch (error) {
        const thread = taken;
        if (thread) {
          await change(recordingId, (list) =>
            list.threads.some((other) => other.id === threadId)
              ? list
              : { ...list, threads: withThread(list.threads, thread) },
          );
        }
        throw error;
      } finally {
        reread(recordingId);
      }
    },
    [change, documentId, reread, resolveAsync],
  );

  return useMemo(
    () => ({ startThread, reply, resolveThread }),
    [reply, resolveThread, startThread],
  );
}
