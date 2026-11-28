import { callAction } from "@agent-native/core/client/hooks";
import { summaryCovers, summaryMessages } from "@shared/thread-summary";
import type { ConversationSummary, EmailMessage } from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

type StoredSummary = { summary: ConversationSummary | null };
type SummaryRun = { pending: boolean; error: unknown };

function summaryQueryKey(accountEmail: string, threadId: string) {
  return ["thread-summary", accountEmail.toLowerCase(), threadId] as const;
}

function targetId(accountEmail: string, threadId: string) {
  return `${accountEmail.toLowerCase()}:${threadId}`;
}

const hiddenUntilReload = new Set<string>();

function snapshotOf(messages: EmailMessage[] | undefined) {
  if (!messages) return undefined;
  const covered = summaryMessages(messages);
  const [latest = null] = covered.slice(-1);
  return latest ? `${latest.id}:${covered.length}` : undefined;
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

  const [runs, setRuns] = useState<Record<string, SummaryRun>>({});
  const running = useRef(new Set<string>());
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [, setHiddenVersion] = useState(0);
  const attempted = useRef(new Set<string>());

  const summary = stored.data?.summary ?? null;
  const observed = messagesSettled ? threadMessages : undefined;
  const snapshot = snapshotOf(observed);
  const run = id ? runs[id] : undefined;
  const pending = run?.pending ?? false;
  const error = run?.error ?? null;
  const open =
    !!id && !hiddenUntilReload.has(id) && (requestedId === id || !!summary);
  const stale =
    !!summary && !!observed && !!snapshot && !summaryCovers(summary, observed);

  const start = useCallback(() => {
    if (!threadId) return;
    const key = targetId(accountEmail, threadId);
    if (running.current.has(key)) return;
    running.current.add(key);
    attempted.current.add(`${key}:${snapshot ?? ""}`);
    setRuns((all) => ({ ...all, [key]: { pending: true, error: null } }));
    const finish = (next: SummaryRun) => {
      running.current.delete(key);
      setRuns((all) => ({ ...all, [key]: next }));
    };
    const queryKey = summaryQueryKey(accountEmail, threadId);
    void (
      callAction("summarize-thread", { accountEmail, threadId }) as Promise<{
        summary: ConversationSummary;
        cached: boolean;
      }>
    ).then(
      async ({ summary: fresh }) => {
        await qc.cancelQueries({ queryKey });
        qc.setQueryData<StoredSummary>(queryKey, { summary: fresh });
        finish({ pending: false, error: null });
      },
      (failure: unknown) => finish({ pending: false, error: failure }),
    );
  }, [accountEmail, threadId, snapshot, qc]);

  useEffect(() => {
    if (!open || !stale || pending) return;
    if (attempted.current.has(`${id}:${snapshot}`)) return;
    start();
  }, [id, snapshot, open, pending, stale, start]);

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
