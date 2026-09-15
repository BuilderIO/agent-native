import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef } from "react";

import type { DesignSystemIndexingStatus } from "../../shared/design-system-validation";

type DesignSystemSummary = {
  id: string;
  title: string;
  description: string | null;
  data: string;
  isDefault: boolean;
  visibility?: "private" | "org" | "public" | null;
  accessRole?: "owner" | "admin" | "editor" | "commenter" | "viewer";
  canManage?: boolean;
  createdAt: string;
  indexingStatus?: DesignSystemIndexingStatus;
};

export function useDesignSystems() {
  const { data, isLoading, error, refetch } = useActionQuery<{
    designSystems: DesignSystemSummary[];
  }>("list-design-systems");

  const designSystems: DesignSystemSummary[] = data?.designSystems ?? [];
  const defaultSystem =
    designSystems.find((ds) => ds.isDefault) ?? designSystems[0];

  // `list-design-systems` only reads the status persisted at index/sync time,
  // which never advances past "indexing" on its own once Builder actually
  // finishes (or fails) — see refresh-design-system-indexing-status. Ask
  // Builder once per id per mount for whichever rows are still marked
  // indexing, and refetch the list only if something actually changed.
  const attemptedRefreshRef = useRef(new Set<string>());
  useEffect(() => {
    const idsToRefresh = designSystems
      .filter((ds) => ds.indexingStatus === "indexing")
      .map((ds) => ds.id)
      .filter((id) => !attemptedRefreshRef.current.has(id));
    if (idsToRefresh.length === 0) return;
    for (const id of idsToRefresh) attemptedRefreshRef.current.add(id);

    void Promise.all(
      idsToRefresh.map((id) =>
        callAction("refresh-design-system-indexing-status", { id }).catch(
          () => {
            // A transient failure (network blip, timeout) is not a confirmed
            // "still indexing" — un-mark it so the next render with a real
            // reason to re-run this effect (e.g. the list's own poll) gets
            // another attempt, instead of leaving the row stuck for the rest
            // of this mount's lifetime.
            attemptedRefreshRef.current.delete(id);
            return null;
          },
        ),
      ),
    ).then((results) => {
      if (
        results.some(
          (result) => (result as { updated?: boolean } | null)?.updated,
        )
      ) {
        void refetch();
      }
    });
  }, [designSystems, refetch]);

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
