import { callAction } from "@agent-native/core/client/hooks";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { sourceDependencyIds } from "./source-dependencies";
import { SourceHydration, type SourceHydrationFile } from "./source-hydration";

interface SourceReadResult {
  files: Array<{ id: string; content: string; updatedAt: string }>;
}

/** Fetch only demanded file bodies; metadata alone never becomes empty source. */
export function useDesignSourceHydration(
  designId: string | undefined,
  files: readonly (SourceHydrationFile & { filename: string })[],
  demandedIds: readonly string[],
  pinnedIds: ReadonlySet<string>,
  dirtyIds: ReadonlySet<string>,
) {
  const [revision, changed] = useReducer((value: number) => value + 1, 0);
  const [loader, setLoader] = useState<SourceHydration | null>(null);

  useEffect(() => {
    if (!designId) {
      setLoader(null);
      return;
    }
    const next = new SourceHydration(async (fileId) => {
      const result = await callAction<SourceReadResult>(
        "get-design",
        { id: designId, fileId },
        { method: "GET" },
      );
      const file = result.files.find((entry) => entry.id === fileId);
      if (!file || typeof file.content !== "string") {
        throw new Error(`Source for screen ${fileId} was not returned`);
      }
      return { content: file.content, updatedAt: file.updatedAt };
    }, changed);
    setLoader(next);
    return () => next.dispose();
  }, [designId]);

  useEffect(() => {
    loader?.setDirty(dirtyIds);
    loader?.sync(files);
  }, [dirtyIds, files, loader]);
  const dependencyIds = useMemo(
    () =>
      loader
        ? sourceDependencyIds(files, demandedIds, (id) => loader.get(id))
        : { ids: [...demandedIds], overflow: false, failed: false },
    [demandedIds, files, loader, revision],
  );
  useEffect(() => {
    loader?.setPinned(new Set([...pinnedIds, ...dependencyIds.ids]));
  }, [dependencyIds, loader, pinnedIds]);
  useEffect(() => {
    if (!loader) return;
    for (const id of dependencyIds.ids) {
      const state = loader.get(id);
      if (
        state.status !== "error" &&
        !(state.status === "ready" && state.refreshError)
      ) {
        void loader.request(id);
      }
    }
  }, [dependencyIds, dirtyIds, files, loader]);

  const retrySources = useCallback(
    (id: string) => {
      if (!loader) return;
      for (const target of new Set([id, ...dependencyIds.ids])) {
        const state = loader.get(target);
        if (
          target === id ||
          state.status === "error" ||
          (state.status === "ready" && state.refreshError)
        )
          void loader.request(target);
      }
    },
    [dependencyIds, loader],
  );

  return {
    retrySources,
    loader,
    revision,
    dependencyOverflow: dependencyIds.overflow || dependencyIds.failed,
  };
}
