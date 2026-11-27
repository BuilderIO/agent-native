import { callAction } from "@agent-native/core/client/hooks";
import type { ConversationSummary, EmailMessage } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

type StoredSummary = { summary: ConversationSummary | null };
type SummaryTarget = { accountEmail: string; threadId: string };

function summaryQueryKey(accountEmail: string, threadId: string) {
  return ["thread-summary", accountEmail.toLowerCase(), threadId] as const;
}

function targetId(accountEmail: string, threadId: string) {
  return `${accountEmail.toLowerCase()}:${threadId}`;
}

const hiddenUntilReload = new Set<string>();

export function latestSummarizedId(messages: EmailMessage[] | undefined) {
  let latest: EmailMessage | undefined;
  for (const message of messages ?? []) {
    if (message.isDraft) continue;
    if (
      !latest ||
      new Date(message.date).getTime() >= new Date(latest.date).getTime()
    ) {
      latest = message;
    }
  }
  return latest?.id;
}

export function useThreadSummaryPanel({
  accountEmail,
  threadId,
  threadMessages,
  messagesSettled,
}: {
  accountEmail: string;
  threadId: string | undefined;
  threadMessages: EmailMessage[] | undefined;
  messagesSettled: boolean;
}) {
  const qc = useQueryClient();
  const id = threadId ? targetId(accountEmail, threadId) : null;

  const stored = useQuery<StoredSummary>({
    queryKey: summaryQueryKey(accountEmail, threadId ?? ""),
    queryFn: () =>
      callAction(
        "get-thread-summary",
        { accountEmail, threadId: threadId ?? "" },
        { method: "GET" },
      ),
    enabled: !!threadId,
    staleTime: 60_000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (target: SummaryTarget) =>
      callAction("summarize-thread", target) as Promise<{
        summary: ConversationSummary;
        cached: boolean;
      }>,
    onSuccess: ({ summary }, target) => {
      qc.setQueryData<StoredSummary>(
        summaryQueryKey(target.accountEmail, target.threadId),
        { summary },
      );
    },
  });

  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [, setHiddenVersion] = useState(0);
  const attempted = useRef(new Set<string>());

  const summary = stored.data?.summary ?? null;
  const latestId = messagesSettled
    ? latestSummarizedId(threadMessages)
    : undefined;
  const forThisThread =
    !!id &&
    !!mutation.variables &&
    targetId(mutation.variables.accountEmail, mutation.variables.threadId) ===
      id;
  const pending = forThisThread && mutation.isPending;
  const error = forThisThread && mutation.isError ? mutation.error : null;
  const open =
    !!id && !hiddenUntilReload.has(id) && (requestedId === id || !!summary);
  const stale = !!summary && !!latestId && summary.lastMessageId !== latestId;

  const { mutate } = mutation;
  const start = useCallback(() => {
    if (!threadId) return;
    attempted.current.add(
      `${targetId(accountEmail, threadId)}:${latestId ?? ""}`,
    );
    mutate({ accountEmail, threadId });
  }, [accountEmail, threadId, latestId, mutate]);

  useEffect(() => {
    if (!open || !stale || pending) return;
    if (attempted.current.has(`${id}:${latestId}`)) return;
    start();
  }, [id, latestId, open, pending, stale, start]);

  const toggle = useCallback(() => {
    if (!id) return;
    if (open) {
      hiddenUntilReload.add(id);
      setRequestedId(null);
      setHiddenVersion((version) => version + 1);
      return;
    }
    hiddenUntilReload.delete(id);
    setRequestedId(id);
    setHiddenVersion((version) => version + 1);
    if (!pending && (!summary || stale)) start();
  }, [id, open, pending, stale, start, summary]);

  return {
    open,
    summary,
    pending,
    error,
    toggle,
    retry: start,
  };
}
