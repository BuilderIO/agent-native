/**
 * Attention Queue data hook.
 *
 * Wraps `useActionQuery("list-attention-queue")` + optimistic mutations
 * for snooze / dismiss / done / mute. The card components stay dumb —
 * they call the returned mutator callbacks and the cache flips
 * synchronously (per the `feedback_optimistic_ui` rule: never block on a
 * server round-trip for inbox-zero gestures).
 *
 * The queue list is invalidated by `root.tsx`'s `useDbSync` whenever an
 * action mutation fires — so an agent-side change (e.g. `snooze-queue-item`
 * called via MCP) lands in the UI within ~2s without manual coordination.
 */
import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { agentNativePath } from "@agent-native/core/client";

export type QueueCardType =
  | "pr-to-review"
  | "my-pr-status-change"
  | "my-pr-ci-failure"
  | "run-needs-input"
  | "error-new";

export interface QueueBadge {
  label: string;
  tone: "neutral" | "info" | "warning" | "danger" | "success";
}

export interface QueueCta {
  label: string;
  action: "open" | "snooze" | "dismiss" | "done";
  href?: string;
}

export interface QueueCard {
  id: string;
  type: QueueCardType;
  title: string;
  subtitle?: string;
  badges: QueueBadge[];
  meta: { ageSeconds: number; risk?: "low" | "med" | "high" };
  ctas: QueueCta[];
  pr?: {
    owner: string;
    repo: string;
    number: number;
    htmlUrl: string;
    author?: string;
  };
  run?: { runId: string; threadId?: string };
  error?: { sentryUrl?: string; service?: string };
}

export interface QueueDiagnostic {
  source: "github" | "runs" | "sentry";
  level: "info" | "warning" | "error";
  message: string;
}

export interface QueueResponse {
  cards: QueueCard[];
  counts: {
    total: number;
    byType: Record<QueueCardType, number>;
  };
  state: {
    githubConnected: boolean;
    mutedCardTypes: QueueCardType[];
  };
  diagnostics: QueueDiagnostic[];
}

const QUEUE_QUERY_KEY: QueryKey = ["action", "list-attention-queue"];
const ACTION_PREFIX = agentNativePath("/_agent-native/actions");

async function actionPost<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${ACTION_PREFIX}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Action ${name} failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = String(data.error);
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return res.json();
}

async function actionGet<T>(name: string): Promise<T> {
  const res = await fetch(`${ACTION_PREFIX}/${name}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Action ${name} failed (${res.status})`);
  }
  return res.json();
}

export function useAttentionQueue() {
  return useQuery<QueueResponse>({
    queryKey: QUEUE_QUERY_KEY,
    queryFn: () => actionGet<QueueResponse>("list-attention-queue"),
    refetchOnWindowFocus: true,
    // 30s background refetch so the queue stays alive even if `useDbSync`
    // misses a poll cycle. Fast enough for the inbox feel, slow enough not
    // to hammer GitHub rate limits.
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
}

/**
 * Optimistically remove a card from the cache. Returns a rollback that
 * re-inserts the card at its original index — used by mutation `onError`
 * handlers so a failed snooze/dismiss/done puts the card right back.
 */
function removeCardFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  itemKey: string,
): () => void {
  const previous = queryClient.getQueryData<QueueResponse>(QUEUE_QUERY_KEY);
  if (!previous) return () => {};
  const index = previous.cards.findIndex((c) => c.id === itemKey);
  if (index === -1) return () => {};
  const removed = previous.cards[index];
  const next: QueueResponse = {
    ...previous,
    cards: previous.cards.filter((c) => c.id !== itemKey),
    counts: {
      total: Math.max(0, previous.counts.total - 1),
      byType: {
        ...previous.counts.byType,
        [removed.type]: Math.max(0, previous.counts.byType[removed.type] - 1),
      },
    },
  };
  queryClient.setQueryData(QUEUE_QUERY_KEY, next);
  return () => {
    const current = queryClient.getQueryData<QueueResponse>(QUEUE_QUERY_KEY);
    if (!current) return;
    // Re-insert at the original index when possible — but only if the card
    // isn't already there (e.g. a concurrent refetch may have re-inserted it).
    if (current.cards.some((c) => c.id === removed.id)) return;
    const restored = [...current.cards];
    restored.splice(Math.min(index, restored.length), 0, removed);
    queryClient.setQueryData<QueueResponse>(QUEUE_QUERY_KEY, {
      ...current,
      cards: restored,
      counts: {
        total: current.counts.total + 1,
        byType: {
          ...current.counts.byType,
          [removed.type]: current.counts.byType[removed.type] + 1,
        },
      },
    });
  };
}

export function useSnoozeQueueItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemKey,
      until,
    }: {
      itemKey: string;
      until: "tomorrow" | "next-week" | string;
    }) => actionPost("snooze-queue-item", { itemKey, until }),
    onMutate: ({ itemKey, until }) => {
      const rollback = removeCardFromCache(queryClient, itemKey);
      const label =
        until === "tomorrow"
          ? "tomorrow"
          : until === "next-week"
            ? "next week"
            : "later";
      toast.success(`Snoozed until ${label}.`);
      return { rollback };
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback?.();
      toast.error(err instanceof Error ? err.message : "Could not snooze.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
    },
  });
}

export function useDismissQueueItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemKey }: { itemKey: string }) =>
      actionPost("dismiss-queue-item", { itemKey }),
    onMutate: ({ itemKey }) => {
      const rollback = removeCardFromCache(queryClient, itemKey);
      toast.success("Dismissed.");
      return { rollback };
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback?.();
      toast.error(err instanceof Error ? err.message : "Could not dismiss.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
    },
  });
}

export function useMarkQueueItemDone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemKey }: { itemKey: string }) =>
      actionPost("mark-queue-item-done", { itemKey }),
    onMutate: ({ itemKey }) => {
      const rollback = removeCardFromCache(queryClient, itemKey);
      toast.success("Marked done.");
      return { rollback };
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback?.();
      toast.error(err instanceof Error ? err.message : "Could not mark done.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
    },
  });
}

export function useMuteCardType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      cardType,
      muted = true,
    }: {
      cardType: QueueCardType;
      muted?: boolean;
    }) => actionPost("mute-card-type", { cardType, muted }),
    onMutate: ({ cardType, muted = true }) => {
      const previous = queryClient.getQueryData<QueueResponse>(QUEUE_QUERY_KEY);
      if (!previous) {
        toast.success(muted ? `Muted ${cardType}.` : `Unmuted ${cardType}.`);
        return {};
      }
      const next: QueueResponse = {
        ...previous,
        cards: muted
          ? previous.cards.filter((c) => c.type !== cardType)
          : previous.cards,
        state: {
          ...previous.state,
          mutedCardTypes: muted
            ? Array.from(new Set([...previous.state.mutedCardTypes, cardType]))
            : previous.state.mutedCardTypes.filter((t) => t !== cardType),
        },
      };
      queryClient.setQueryData(QUEUE_QUERY_KEY, next);
      toast.success(muted ? `Muted ${cardType}.` : `Unmuted ${cardType}.`);
      return {
        rollback: () => {
          queryClient.setQueryData(QUEUE_QUERY_KEY, previous);
        },
      };
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback?.();
      toast.error(
        err instanceof Error ? err.message : "Could not update mute.",
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
    },
  });
}

/**
 * Sugar for card components: returns a stable set of mutator callbacks
 * pre-bound to the card's `itemKey` / `cardType` so the JSX stays clean.
 */
export function useQueueCardActions(card: QueueCard) {
  const snooze = useSnoozeQueueItem();
  const dismiss = useDismissQueueItem();
  const markDone = useMarkQueueItemDone();
  const muteType = useMuteCardType();

  const onSnooze = useCallback(
    (until: "tomorrow" | "next-week") => {
      snooze.mutate({ itemKey: card.id, until });
    },
    [snooze, card.id],
  );
  const onDismiss = useCallback(() => {
    dismiss.mutate({ itemKey: card.id });
  }, [dismiss, card.id]);
  const onMarkDone = useCallback(() => {
    markDone.mutate({ itemKey: card.id });
  }, [markDone, card.id]);
  const onMuteType = useCallback(() => {
    muteType.mutate({ cardType: card.type });
  }, [muteType, card.type]);

  return { onSnooze, onDismiss, onMarkDone, onMuteType };
}
