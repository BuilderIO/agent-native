import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ReactionHandler,
  ReactionHandlerResult,
  ReactionSummary,
} from "./reactions-tray";

/**
 * Shows a reaction on the timeline as soon as it is sent, and drops it once the
 * saved copy arrives or the save fails.
 */
export function useOptimisticReactions({
  reactions,
  onReact,
  getCurrentMs,
}: {
  reactions: { emoji: string; videoTimestampMs: number }[] | undefined;
  onReact: ReactionHandler | undefined;
  getCurrentMs: () => number;
}) {
  const [optimisticReactions, setOptimisticReactions] = useState<
    ReactionSummary[]
  >([]);
  const optimisticReactionIdRef = useRef(0);

  useEffect(() => {
    if (!optimisticReactions.length || !reactions?.length) return;
    setOptimisticReactions((current) => {
      const next = current.filter(
        (optimistic) =>
          !reactions.some(
            (persisted) =>
              persisted.emoji === optimistic.emoji &&
              Math.abs(
                persisted.videoTimestampMs - optimistic.videoTimestampMs,
              ) < 1000,
          ),
      );
      return next.length === current.length ? current : next;
    });
  }, [optimisticReactions.length, reactions]);

  const handleReact = useCallback<ReactionHandler>(
    (emoji) => {
      const optimistic = {
        id: `optimistic-reaction-${++optimisticReactionIdRef.current}`,
        emoji,
        videoTimestampMs: getCurrentMs(),
      };
      setOptimisticReactions((current) => [...current, optimistic]);

      const removeOptimistic = () => {
        setOptimisticReactions((current) =>
          current.filter((reaction) => reaction.id !== optimistic.id),
        );
      };

      let result: ReactionHandlerResult | undefined;
      try {
        result = onReact?.(emoji);
      } catch {
        removeOptimistic();
        return false;
      }

      if (result && typeof result === "object" && "then" in result) {
        return Promise.resolve(result).then(
          (saved) => {
            if (saved === false) removeOptimistic();
            return saved !== false;
          },
          () => {
            removeOptimistic();
            return false;
          },
        );
      }

      if (result === false) removeOptimistic();
      return result !== false;
    },
    [getCurrentMs, onReact],
  );

  return { optimisticReactions, handleReact };
}
