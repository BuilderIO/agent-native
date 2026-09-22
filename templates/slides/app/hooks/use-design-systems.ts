import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef } from "react";

import type { DesignSystemIndexingStatus } from "../../shared/design-system-validation";

const DESIGN_SYSTEM_STATUS_REFRESH_MS = 5_000;

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
  const defaultSystem = designSystems.find((ds) => ds.isDefault);

  // `list-design-systems` only reads the status persisted at index/sync time,
  // which never advances past "indexing" on its own once Builder actually
  // finishes (or fails) — see refresh-design-system-indexing-status. Keep
  // checking only those rows until the list reports a terminal state.
  const refreshTimerRef = useRef<number | null>(null);
  const refreshingIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const indexingIds = designSystems
      .filter((ds) => ds.indexingStatus === "indexing")
      .map((ds) => ds.id);
    if (indexingIds.length === 0) return;

    let disposed = false;
    const refresh = async () => {
      const idsToRefresh = indexingIds.filter(
        (id) => !refreshingIdsRef.current.has(id),
      );
      idsToRefresh.forEach((id) => refreshingIdsRef.current.add(id));
      const results = await Promise.all(
        idsToRefresh.map(async (id) => {
          try {
            return await callAction("refresh-design-system-indexing-status", {
              id,
            });
          } catch {
            return { updated: false, failed: true };
          } finally {
            refreshingIdsRef.current.delete(id);
          }
        }),
      );
      if (disposed) return;
      if (
        results.some(
          (result) => (result as { updated?: boolean } | null)?.updated,
        )
      ) {
        void refetch();
      }
      refreshTimerRef.current = window.setTimeout(
        refresh,
        DESIGN_SYSTEM_STATUS_REFRESH_MS,
      );
    };

    void refresh();
    return () => {
      disposed = true;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [designSystems, refetch]);

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
