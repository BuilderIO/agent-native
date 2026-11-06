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

const NO_PREVIEWS: readonly string[] = [];

/**
 * Fetch only demanded file bodies; metadata alone never becomes empty source.
 * Preview ids load after demanded ones, within the byte budget, unpinned.
 */
export function useDesignSourceHydration(
  designId: string | undefined,
  files: readonly (SourceHydrationFile & { filename: string })[],
  demandedIds: readonly string[],
  pinnedIds: ReadonlySet<string>,
  dirtyIds: ReadonlySet<string>,
  previewIds: readonly string[] = NO_PREVIEWS,
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
  const previews = useMemo(() => {
    const demanded = new Set(dependencies.ids);
    const roots = previewIds.filter((id) => !demanded.has(id));
    if (!loader)
      return { ids: roots, statusByRoot: new Map(), idsByRoot: new Map() };
    const scheduled = scheduleSourceDependencies(
      files,
      roots,
      (id) => loader.get(id),
      128,
      dependencyIndex,
    );
    const ids = scheduled.ids.filter((id) => !demanded.has(id));
    // A preview the budget cannot reach, or one whose dependencies it cannot,
    // is never read and would otherwise report loading forever.
    for (const [root, status] of scheduled.statusByRoot) {
      if (status !== "loading") continue;
      const blocked = [root, ...(scheduled.idsByRoot.get(root) ?? [])].some(
        (id) => loader.get(id).status === "unloaded" && !loader.canLoad(id),
      );
      if (blocked) scheduled.statusByRoot.set(root, "deferred");
    }
    return { ...scheduled, ids };
  }, [dependencies, dependencyIndex, files, loader, previewIds, revision]);
  const statusByRoot = useMemo(
    () => new Map([...previews.statusByRoot, ...dependencies.statusByRoot]),
    [dependencies, previews],
  );
  const idsByRoot = useMemo(
    () => new Map([...previews.idsByRoot, ...dependencies.idsByRoot]),
    [dependencies, previews],
  );
  useEffect(() => {
    loader?.setDemand(
      new Set([...pinnedIds, ...dependencies.ids]),
      previews.ids,
    );
  }, [dependencies, loader, pinnedIds, previews.ids]);
  useEffect(() => {
    if (!loader) return;
    const requestable = (id: string) => {
      const state = loader.get(id);
      return (
        state.status !== "error" &&
        !(state.status === "ready" && state.refreshError)
      );
    };
    for (const id of dependencies.ids) {
      if (requestable(id)) void loader.request(id);
    }
    for (const id of previews.ids) {
      if (requestable(id)) void loader.request(id, "low");
    }
  }, [dependencies, dirtyIds, files, loader, previews]);

  const retrySources = useCallback(
    (id: string) => {
      if (!loader) return;
      for (const target of new Set([id, ...(idsByRoot.get(id) ?? [])])) {
        const state = loader.get(target);
        if (
          target === id ||
          state.status === "error" ||
          (state.status === "ready" && state.refreshError)
        )
          void loader.request(target);
      }
    },
    [idsByRoot, loader],
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
          const pending = graph.ids.filter((id) => {
            const state = loader.get(id);
            return state.status !== "ready" || state.refreshing === true;
          });
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

  /** Loads and holds every listed source until the returned release runs. */
  const leaseSources = useCallback(
    async (ids: readonly string[]): Promise<() => void> => {
      if (!loader) throw new Error("Source loader is unavailable");
      const releases = ids.map((id) => loader.lease(id));
      const release = () => {
        for (const dispose of releases.splice(0)) dispose();
      };
      try {
        await Promise.all(ids.map((id) => loader.request(id)));
        for (const id of ids) {
          const state = loader.get(id);
          if (state.status !== "ready" || state.refreshError)
            throw new Error("Screen source could not be loaded");
        }
        await awaitCommittedSources(ids);
        return release;
      } catch (error) {
        release();
        throw error;
      }
    },
    [awaitCommittedSources, loader],
  );

  return {
    retrySources,
    leaseSources,
    leaseHydratedSource,
    awaitCommittedSources,
    loader,
    revision,
    dependencyStatusByRoot: statusByRoot,
  };
}
