import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import {
  createPollEngine,
  type PollEngineHandle,
} from "@agent-native/core/shared";
import { useEffect, useRef } from "react";

import type { DesignSystemIndexingStatus } from "../../shared/design-system-validation";

// Per-id backoff for `refresh-design-system-indexing-status`. A design
// system stuck in "indexing" (Builder never confirms completion) used to be
// checked on a fixed 5s cadence forever — in production, a handful of stuck
// systems in one tab produced tens of thousands of calls over a few hours.
// Doubling the delay each unconfirmed check, up to a cap, keeps a live check
// prompt while bounding the worst case.
const INDEXING_POLL_INITIAL_DELAY_MS = 5_000;
const INDEXING_POLL_MAX_DELAY_MS = 5 * 60_000;
// A row that still hasn't confirmed after this long is treated the same as
// the server's own `stale` response (see refresh-design-system-indexing-
// status): stop polling it locally. This only matters when the action call
// itself keeps failing (so we never receive a `stale` response to act on) —
// the server-computed staleness is the primary backstop.
const INDEXING_POLL_BUDGET_MS = 30 * 60_000;
const INDEXING_POLL_TIMEOUT_MS = 30_000;

interface IndexingPollState {
  delayMs: number;
  nextDueAt: number;
  firstSeenAt: number;
}

type RefreshIndexingStatusResult = {
  updated?: boolean;
  stale?: boolean;
  indexingStatus?: DesignSystemIndexingStatus;
};

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
  const indexingIdsKey = designSystems
    .filter((ds) => ds.indexingStatus === "indexing")
    .map((ds) => ds.id)
    .join(",");

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const scheduleRef = useRef(new Map<string, IndexingPollState>());
  const engineRef = useRef<PollEngineHandle | null>(null);

  // `list-design-systems` only reads the status persisted at index/sync time,
  // which never advances past "indexing" on its own once Builder actually
  // finishes (or fails) — see refresh-design-system-indexing-status. Keep
  // checking only those rows, at a per-id backoff, until the list reports a
  // terminal state. A variable cadence needs createPollEngine directly, not
  // usePollLoop (whose public intervalMs is a fixed number) — see
  // use-run-stuck-detection.ts for the same pattern. Created once so an id
  // being added or removed from the indexing set (below) doesn't reset the
  // backoff already earned by the others.
  useEffect(() => {
    const attempt = async (signal: AbortSignal) => {
      const now = Date.now();
      const due = Array.from(scheduleRef.current.entries()).filter(
        ([, state]) => state.nextDueAt <= now,
      );
      if (due.length === 0) return;

      let anyUpdated = false;
      await Promise.all(
        due.map(async ([id, state]) => {
          let result: RefreshIndexingStatusResult | null = null;
          try {
            result = await callAction(
              "refresh-design-system-indexing-status",
              { id },
              { signal },
            );
          } catch (err) {
            // `result` stays null (distinct from a real response) and falls
            // through to the same backoff as an unconfirmed response below.
            // Leaving nextDueAt unmoved here would make a persistent failure
            // (revoked access, an outage) retry on every tick instead of
            // backing off.
            console.error(
              `Failed to refresh indexing status for design system ${id}:`,
              err,
            );
          }
          // A CONFIRMED terminal indexingStatus is also a done signal even
          // when `updated` is false — another writer (a second tab, an
          // agent) already persisted it. Without this, that id kept
          // re-checking every backoff step, showing "indexing" until the
          // 30-minute budget ran out instead of picking up the already-saved
          // result. A missing field (not the same as a confirmed "indexing")
          // falls through to the unconfirmed path below rather than being
          // read as terminal.
          if (
            result?.updated ||
            (result?.indexingStatus !== undefined &&
              result.indexingStatus !== "indexing")
          ) {
            anyUpdated = true;
            scheduleRef.current.delete(id);
            return;
          }
          // Re-read the clock instead of reusing the outer `now`: a focus
          // reset (below) can rewrite this same state object in place while
          // this call was in flight, and anchoring to a stale start time
          // would fight that reset instead of building on it.
          const settledAt = Date.now();
          if (
            result?.stale ||
            settledAt - state.firstSeenAt > INDEXING_POLL_BUDGET_MS
          ) {
            // The server confirmed this row hasn't moved in a long time, or
            // we've been unable to confirm either way for the whole budget.
            // Stop polling it — the persisted status is untouched and still
            // truthfully reads "indexing", it's just no longer worth
            // checking on a fixed cadence.
            scheduleRef.current.delete(id);
            return;
          }
          // Use the current delay for this wait, then double it for the
          // next one — so the first re-check lands at the initial delay
          // instead of already doubled.
          state.nextDueAt = settledAt + state.delayMs;
          state.delayMs = Math.min(
            state.delayMs * 2,
            INDEXING_POLL_MAX_DELAY_MS,
          );
        }),
      );
      if (anyUpdated) void refetchRef.current();
    };

    const engine = createPollEngine(attempt, {
      intervalMs: () => {
        const now = Date.now();
        let minDelay = INDEXING_POLL_MAX_DELAY_MS;
        for (const state of scheduleRef.current.values()) {
          minDelay = Math.min(minDelay, Math.max(0, state.nextDueAt - now));
        }
        return minDelay;
      },
      timeoutMs: INDEXING_POLL_TIMEOUT_MS,
      // Nothing to check until the sync effect below populates a first id.
      leading: false,
    });
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  // Add newly-seen ids (fresh budget, immediate check) and drop ids the list
  // no longer reports as indexing. Existing entries keep their backoff.
  useEffect(() => {
    const now = Date.now();
    const active = new Set(indexingIdsKey ? indexingIdsKey.split(",") : []);
    let addedNew = false;
    for (const id of scheduleRef.current.keys()) {
      if (!active.has(id)) scheduleRef.current.delete(id);
    }
    for (const id of active) {
      if (!scheduleRef.current.has(id)) {
        scheduleRef.current.set(id, {
          delayMs: INDEXING_POLL_INITIAL_DELAY_MS,
          nextDueAt: now,
          firstSeenAt: now,
        });
        addedNew = true;
      }
    }
    if (addedNew) engineRef.current?.pollNow();
  }, [indexingIdsKey]);

  // A tab that was away for a while (and so backed off toward the 5 min cap)
  // deserves a prompt recheck once the user actually comes back to it.
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      for (const state of scheduleRef.current.values()) {
        state.delayMs = INDEXING_POLL_INITIAL_DELAY_MS;
        state.nextDueAt = now;
        state.firstSeenAt = now;
      }
      engineRef.current?.pollNow();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
