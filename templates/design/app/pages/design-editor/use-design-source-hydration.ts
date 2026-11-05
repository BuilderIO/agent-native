import { callAction } from "@agent-native/core/client/hooks";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  createSourceDependencyIndex,
  scheduleSourceDependencies,
  sourceDependencyIds,
} from "./source-dependencies";
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
  const committedSourcesRef = useRef(
    new Map<string, { content: string; updatedAt: string }>(),
  );
  const commitWaitersRef = useRef(new Set<() => void>());
  const retiredLoadersRef = useRef(new WeakSet<SourceHydration>());
  const metadataIdsRef = useRef(new Set<string>());
  metadataIdsRef.current = new Set(files.map((file) => file.id));
  const committedSnapshot = new Map<
    string,
    { content: string; updatedAt: string }
  >();
  if (loader) {
    for (const file of files) {
      const state = loader.get(file.id);
      if (state.status === "ready")
        committedSnapshot.set(file.id, {
          content: state.content,
          updatedAt: state.updatedAt,
        });
    }
  }
  useEffect(() => {
    committedSourcesRef.current = committedSnapshot;
    for (const check of commitWaitersRef.current) check();
  });
  useEffect(
    () => () => {
      committedSourcesRef.current.clear();
      if (loader) retiredLoadersRef.current.add(loader);
      for (const check of commitWaitersRef.current) check();
    },
    [loader],
  );
  const awaitCommittedSources = useCallback(
    (ids: readonly string[]): Promise<void> => {
      if (!loader)
        return Promise.reject(new Error("Source loader is unavailable"));
      return new Promise((resolve, reject) => {
        const check = () => {
          if (retiredLoadersRef.current.has(loader)) {
            commitWaitersRef.current.delete(check);
            reject(new Error("Source loader was closed"));
            return;
          }
          for (const id of ids) {
            if (!metadataIdsRef.current.has(id)) {
              commitWaitersRef.current.delete(check);
              reject(new Error("Screen source is unavailable"));
              return;
            }
            const state = loader.get(id);
            if (
              state.status === "error" ||
              (state.status === "ready" && state.refreshError)
            ) {
              commitWaitersRef.current.delete(check);
              reject(new Error("Screen source could not be loaded"));
              return;
            }
            const committed = committedSourcesRef.current.get(id);
            if (
              state.status !== "ready" ||
              !committed ||
              committed.content !== state.content ||
              committed.updatedAt !== state.updatedAt
            )
              return;
          }
          commitWaitersRef.current.delete(check);
          resolve();
        };
        commitWaitersRef.current.add(check);
        check();
      });
    },
    [loader],
  );

  const dependencyIndex = useMemo(
    () => createSourceDependencyIndex(files),
    [files],
  );
  const dependencies = useMemo(
    () =>
      loader
        ? scheduleSourceDependencies(
            files,
            demandedIds,
            (id) => loader.get(id),
            128,
            dependencyIndex,
          )
        : {
            ids: [...demandedIds],
            statusByRoot: new Map(),
            idsByRoot: new Map(),
          },
    [demandedIds, files, loader, revision, dependencyIndex],
  );
  useEffect(() => {
    loader?.setPinned(new Set([...pinnedIds, ...dependencies.ids]));
  }, [dependencies, loader, pinnedIds]);
  useEffect(() => {
    if (!loader) return;
    for (const id of dependencies.ids) {
      const state = loader.get(id);
      if (
        state.status !== "error" &&
        !(state.status === "ready" && state.refreshError)
      ) {
        void loader.request(id);
      }
    }
  }, [dependencies, dirtyIds, files, loader]);

  const retrySources = useCallback(
    (id: string) => {
      if (!loader) return;
      for (const target of new Set([
        id,
        ...(dependencies.idsByRoot.get(id) ?? []),
      ])) {
        const state = loader.get(target);
        if (
          target === id ||
          state.status === "error" ||
          (state.status === "ready" && state.refreshError)
        )
          void loader.request(target);
      }
    },
    [dependencies, loader],
  );

  const leaseHydratedSource = useCallback(
    async (root: string) => {
      if (!loader) throw new Error("Source loader is unavailable");
      const leases = new Map<string, () => void>();
      const release = () => {
        for (const dispose of leases.values()) dispose();
        leases.clear();
      };
      try {
        for (;;) {
          const graph = sourceDependencyIds(
            files,
            [root],
            (id) => loader.get(id),
            dependencyIndex,
          );
          if (graph.overflow || graph.failed)
            throw new Error("Screen dependencies could not be loaded");
          for (const id of graph.ids)
            if (!leases.has(id)) leases.set(id, loader.lease(id));
          const pending = graph.ids.filter(
            (id) => loader.get(id).status !== "ready",
          );
          if (pending.length === 0) {
            await awaitCommittedSources(graph.ids);
            return release;
          }
          await Promise.all(pending.map((id) => loader.request(id)));
          for (const id of pending) {
            const state = loader.get(id);
            if (state.status !== "ready" || state.refreshError)
              throw new Error("Screen source could not be loaded");
          }
        }
      } catch (error) {
        release();
        throw error;
      }
    },
    [awaitCommittedSources, dependencyIndex, files, loader],
  );

  return {
    retrySources,
    leaseHydratedSource,
    awaitCommittedSources,
    loader,
    revision,
    dependencyStatusByRoot: dependencies.statusByRoot,
  };
}
