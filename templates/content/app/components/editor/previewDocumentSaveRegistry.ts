// Module-level registry of ONE save controller per PEEK document id.
//
// PROBLEM (the rebase race class — what the per-doc lane could NOT fix):
//   The row peek renders a SINGLE `DatabaseItemPreview` instance whose `item`
//   prop changes on row-switch (it has no per-row `key`, so it does not remount).
//   The old design gave it ONE controller whose target document id was REBASED on
//   every row-switch, plus a shared cross-doc serialization lane. That produced
//   two timing bugs no patch could fully close:
//     - lane queue-jump: a `running`/`tail` microtask gap let a new enqueue
//       dispatch synchronously AHEAD of already-queued saves; and
//     - stale completion after rebase: an OLD-row in-flight save resolving AFTER
//       the row-switch `mark()` overwrote the SHARED controller's `lastSaved` with
//       the old payload and triggered a redundant save against the NEW row.
//   Both are properties of sharing one mutable-target controller across rows.
//
// FIX (one controller per document id, ref-counted — mirrors blockFieldSaveRegistry):
//   There is exactly ONE controller per document id. A controller's target doc id
//   is fixed at creation and NEVER changes. Switching rows RELEASES the old doc's
//   controller (whose release flushes its pending save synchronously, bound to its
//   own id) and ACQUIRES the new doc's controller. No `saveTargetIdRef` rebase on
//   a live controller; no cross-doc shared mutable target; no cross-doc lane.
//
//   With per-doc controllers each is single-flight + trailing for ITS doc only:
//     - A stale completion can only ever advance ITS OWN controller's `lastSaved`
//       (correct) — never another row's. The stale-completion-after-rebase bug is
//       structurally impossible.
//     - Single-flight per doc means at most one save in flight per id, so there is
//       nothing left for a serialization lane to order. The lane is deleted.
//
//   - acquire(id, factory): returns the SAME controller for a doc id, creating it
//     once via `factory` and bumping a ref-count.
//   - release(id): decrements the ref-count. At 0 we do NOT evict immediately: we
//     flush-then-evict. The final flush still dispatches synchronously bound to
//     this doc id, and a quick reopen BEFORE the flush settles re-acquires the
//     SAME instance (eviction cancelled) — so a quick reopen reuses the live
//     controller and there is never a competing second controller for the id.

import type { PreviewDocumentSaveController } from "./previewDocumentSaveController";

interface Entry {
  controller: PreviewDocumentSaveController;
  refCount: number;
  // Set while a flush-then-evict is pending after refCount hit 0. If a reopen
  // re-acquires before the flush settles, we clear this so the entry is NOT
  // evicted out from under the live instance.
  evicting: boolean;
}

const registry = new Map<string, Entry>();

function payloadsEqual(
  a: PreviewDocumentSaveController["pending"],
  b: PreviewDocumentSaveController["pending"],
) {
  return a.title === b.title && a.content === b.content;
}

function controllerIsDirty(controller: PreviewDocumentSaveController): boolean {
  return !payloadsEqual(controller.pending, controller.lastSaved);
}

/**
 * Acquire the controller for `documentId`, creating it once via `factory`.
 * Increments the ref-count and cancels any in-progress eviction so a reopen
 * reuses the live instance rather than racing a fresh one.
 */
export function acquirePreviewDocumentSaveController(
  documentId: string,
  factory: () => PreviewDocumentSaveController,
): PreviewDocumentSaveController {
  let entry = registry.get(documentId);
  if (!entry) {
    entry = { controller: factory(), refCount: 0, evicting: false };
    registry.set(documentId, entry);
  }
  entry.refCount += 1;
  // A reopen before a pending eviction settled: keep the instance alive.
  entry.evicting = false;
  return entry.controller;
}

/**
 * Return the EXISTING controller for `documentId`, or undefined if none is
 * registered. Does NOT create an entry and does NOT change the ref-count.
 */
export function peekPreviewDocumentSaveController(
  documentId: string,
): PreviewDocumentSaveController | undefined {
  return registry.get(documentId)?.controller;
}

/**
 * Release one reference to the controller for `documentId`. When the last
 * reference is released we flush-then-evict: flush the latest dirty payload so a
 * debounce that hadn't fired is not dropped (dispatched synchronously, bound to
 * THIS doc id), then remove the entry ONLY if it is still unreferenced after the
 * flush settles (a reopen during the flush re-acquires the same instance and
 * cancels the eviction).
 */
export function releasePreviewDocumentSaveController(documentId: string): void {
  const entry = registry.get(documentId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  entry.evicting = true;
  const settle = () => {
    const current = registry.get(documentId);
    // Evict only if it is the SAME entry, still unreferenced, and still marked
    // for eviction (a reopen would have flipped `evicting` off / refCount up).
    if (current === entry && current.refCount === 0 && current.evicting) {
      if (controllerIsDirty(current.controller)) {
        current.evicting = false;
        return;
      }
      registry.delete(documentId);
    }
  };
  // flush() dispatches the final save synchronously (so it lands before any
  // teardown/navigation) and resolves once it has settled, before we drop state.
  Promise.resolve(entry.controller.flush()).then(settle, settle);
}

/** Test-only: how many controllers the registry currently holds. */
export function activePreviewControllerCount(): number {
  return registry.size;
}

/** Test-only: reset the registry between tests. */
export function __resetPreviewDocumentSaveRegistry(): void {
  registry.clear();
}
