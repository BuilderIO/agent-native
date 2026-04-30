import { useEffect, useMemo, useState } from "react";
import { useActionQuery } from "@agent-native/core/client";
import { compositions, type CompositionEntry } from "@/remotion/registry";
import {
  databaseRowToComposition,
  type DatabaseCompositionRow,
} from "@/lib/database-compositions";

function compositionChanged(
  existing: CompositionEntry,
  next: CompositionEntry,
) {
  return (
    existing.title !== next.title ||
    existing.description !== next.description ||
    existing.durationInFrames !== next.durationInFrames ||
    existing.fps !== next.fps ||
    existing.width !== next.width ||
    existing.height !== next.height ||
    JSON.stringify(existing.defaultProps) !==
      JSON.stringify(next.defaultProps) ||
    JSON.stringify(existing.tracks) !== JSON.stringify(next.tracks)
  );
}

// ─── Cross-instance reconciliation ────────────────────────────────────────────
// Multiple components mount this hook. They all observe the same React Query
// cache, but they each fire their own effect. To keep them from racing on the
// shared `compositions` singleton (and to react when DB rows are added or
// removed), we run an idempotent full reconcile guarded by a snapshot key —
// only one instance does the work per data change, the rest early-out — and
// notify every subscribed instance afterward so they all re-render together.

let lastReconciledKey: string | null = null;
const subscribers = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

function notifyAll() {
  for (const cb of subscribers) cb();
}

function snapshotKey(rows: DatabaseCompositionRow[]): string {
  // Stable identity for this set of rows — used to skip redundant reconciles.
  return JSON.stringify(
    rows
      .map((r) => [r.id, r.title, r.type, r.data])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

function reconcileRegistry(rows: DatabaseCompositionRow[]): boolean {
  let mutated = false;
  const dbIds = new Set<string>();

  // Add or update every DB-sourced entry.
  for (const row of rows) {
    const entry = databaseRowToComposition(row);
    dbIds.add(entry.id);
    const index = compositions.findIndex((c) => c.id === entry.id);
    if (index === -1) {
      compositions.push(entry);
      mutated = true;
    } else if (compositionChanged(compositions[index], entry)) {
      const existing = compositions[index];
      compositions[index] = {
        ...entry,
        component: existing.component ?? entry.component,
      };
      mutated = true;
    }
  }

  // Remove DB-sourced entries that no longer exist in the query data.
  // Static registry entries (storage !== "database") are never touched.
  for (let i = compositions.length - 1; i >= 0; i--) {
    const c = compositions[i];
    if (c.storage === "database" && !dbIds.has(c.id)) {
      compositions.splice(i, 1);
      mutated = true;
    }
  }

  return mutated;
}

export function useDatabaseCompositions() {
  const [version, setVersion] = useState(0);
  const query = useActionQuery<DatabaseCompositionRow[]>(
    "list-compositions",
    undefined,
    {
      retry: 1,
      staleTime: 2000,
    },
  );

  // Subscribe to cross-instance updates so every mounted hook re-renders when
  // any other instance reconciles the registry.
  useEffect(() => {
    return subscribe(() => setVersion((v) => v + 1));
  }, []);

  // Idempotent reconcile guarded by a snapshot key. Concurrent instances all
  // see the same query.data reference, compute the same key, and exactly one
  // of them does the work — the rest early-out.
  useEffect(() => {
    if (!query.data) return;
    const key = snapshotKey(query.data);
    if (key === lastReconciledKey) return;
    lastReconciledKey = key;
    const changed = reconcileRegistry(query.data);
    if (changed) notifyAll();
  }, [query.data]);

  // Derived merged list — recomputed from query.data each render. Callers can
  // consume this directly without touching the singleton. Static registry
  // entries (storage !== "database") are kept; DB entries replace stale ones.
  const merged = useMemo<CompositionEntry[]>(() => {
    const dbEntries = (query.data ?? []).map(databaseRowToComposition);
    const dbIds = new Set(dbEntries.map((e) => e.id));
    const staticEntries = compositions.filter(
      (c) => c.storage !== "database" && !dbIds.has(c.id),
    );
    return [...staticEntries, ...dbEntries];
    // `version` is intentionally a dep so a registry mutation re-derives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, version]);

  return {
    rows: query.data ?? [],
    compositions: merged,
    version,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
