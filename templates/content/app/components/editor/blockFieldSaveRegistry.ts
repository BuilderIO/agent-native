// Module-level registry of ONE shared save controller per Blocks-field key.
//
// PROBLEM (cross-instance write inversion — what the per-key lane could NOT fix):
//   A non-primary Blocks field saves through a debounced controller, and one
//   controller was created PER `AdditionalBlockEditor` mount. The editor unmounts
//   on collapse and remounts on reopen under the SAME `documentId:propertyId`
//   key. Across that collapse→reopen, two controller instances for the same key
//   can exist briefly: the OLD instance's unmount-flush is still settling while a
//   NEW instance accepts a newer edit. Each controller has its OWN pending and
//   in-flight state, so they cannot see each other's recency.
//
//   The per-key serialization lane only ordered saves by ENQUEUE order. With two
//   independent controllers the enqueue interleaving can be
//   oldA → newC → oldB (the old controller issues a trailing save AFTER the new
//   controller's edit), so a STALE value lands last and the user's newest edit is
//   lost. Enqueue order can't capture content-recency across two controllers.
//
// FIX (one shared controller per key, ref-counted):
//   There is exactly ONE controller instance per `documentId:propertyId` key, so
//   there is exactly ONE `pending` value, ONE in-flight save, and a single
//   single-flight + trailing pipeline for the field — regardless of how many
//   editor instances mount/unmount/collapse/reopen. "Newest-wins WITHIN one
//   controller" (already guaranteed by the controller) now applies across ALL
//   instances, because there is only ever the one controller. An older save can
//   never overwrite a newer one for the same field.
//
//   - acquire(key, factory): returns the SAME controller for a key, creating it
//     once (via `factory`) and bumping a ref-count. Concurrent editor instances
//     for the same key share it.
//   - release(key): decrements the ref-count. When it reaches 0 we do NOT evict
//     immediately: we flush-then-evict. The final flush still lands, and a quick
//     reopen BEFORE the flush settles re-acquires the SAME instance (ref-count
//     goes back above 0, eviction is cancelled) — so there is never a competing
//     second controller for the key.
//
// This subsumes the lane for cross-instance ordering: with a single controller
// per key, the lane has nothing left to serialize. The lane is therefore removed
// (see git history) to avoid two mechanisms that could disagree.

import type { BlockFieldSaveController } from "./blockFieldSaveController";

interface Entry {
  controller: BlockFieldSaveController;
  refCount: number;
  // Set while a flush-then-evict is pending after refCount hit 0. If a reopen
  // re-acquires before the flush settles, we clear this so the entry is NOT
  // evicted out from under the live instance.
  evicting: boolean;
}

const registry = new Map<string, Entry>();

/**
 * Acquire the shared controller for `key`, creating it once via `factory`.
 * Increments the ref-count and cancels any in-progress eviction so a reopen
 * reuses the live instance rather than racing a fresh one.
 */
export function acquireBlockFieldSaveController(
  key: string,
  factory: () => BlockFieldSaveController,
): BlockFieldSaveController {
  const entry = ensureEntry(key, factory);
  entry.refCount += 1;
  // A reopen before a pending eviction settled: keep the instance alive.
  entry.evicting = false;
  return entry.controller;
}

/**
 * Return the EXISTING shared controller for `key`, or undefined if none is
 * registered yet. Does NOT create an entry and does NOT change the ref-count.
 *
 * Used during render to seed a remount's displayed content from the live
 * controller's latest pending value. If no controller exists yet there is no
 * pending content to recover, so the caller falls back to the server value —
 * which is correct. Crucially, peeking never creates an unreferenced entry, so a
 * render that is discarded before commit (concurrent/StrictMode) leaks nothing;
 * the lasting entry is only created by the formal acquire in the mount effect.
 */
export function peekBlockFieldSaveController(
  key: string,
): BlockFieldSaveController | undefined {
  return registry.get(key)?.controller;
}

function ensureEntry(
  key: string,
  factory: () => BlockFieldSaveController,
): Entry {
  let entry = registry.get(key);
  if (!entry) {
    entry = { controller: factory(), refCount: 0, evicting: false };
    registry.set(key, entry);
  }
  return entry;
}

function controllerIsDirty(controller: BlockFieldSaveController): boolean {
  return controller.pending !== controller.lastSaved;
}

/**
 * Release one reference to the controller for `key`. When the last reference is
 * released we flush-then-evict: flush the latest dirty content so a debounce
 * that hadn't fired is not dropped, then remove the entry ONLY if it is still
 * unreferenced after the flush settles (a reopen during the flush re-acquires
 * the same instance and cancels the eviction).
 */
export function releaseBlockFieldSaveController(key: string): void {
  const entry = registry.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  // Last reference gone: flush the final pending content, then evict once it
  // has fully settled — but only if nobody re-acquired in the meantime.
  entry.evicting = true;
  const settle = () => {
    const current = registry.get(key);
    // Evict only if it is the SAME entry, still unreferenced, and still marked
    // for eviction (a reopen would have flipped `evicting` off / refCount up).
    if (current === entry && current.refCount === 0 && current.evicting) {
      if (controllerIsDirty(current.controller)) {
        current.evicting = false;
        return;
      }
      registry.delete(key);
      // Drop the per-key save-impl ref alongside the controller. It is only
      // cleared on test reset otherwise, so without this it accumulates one
      // entry per key for the lifetime of the page. A subsequent re-acquire of
      // the same key recreates a fresh impl ref via blockFieldSaveImplRef (the
      // hook writes its current impl every render before the acquire effect), so
      // there is no stale closure. Only delete here — never while refCount > 0
      // or a reopen is pending — because the live factory closes over this ref.
      saveImpls.delete(key);
    }
  };
  // flush() resolves after any in-flight save AND the trailing save have
  // settled, so the final DB value is the latest content before we drop state.
  Promise.resolve(entry.controller.flush()).then(settle, settle);
}

// The shared controller for a key is created ONCE, but each editor mount carries
// its own `save` implementation (a fresh `useSetDocumentProperty(...).mutateAsync`
// closure per render). To keep one controller while still calling the freshest
// impl, the controller's `save` reads through a per-key impl ref that every mount
// updates on acquire. The save TARGET (documentId:propertyId) is fixed by the key,
// so this only swaps the function identity, never the field it writes to.
type SaveImpl = (value: string) => Promise<unknown>;
const saveImpls = new Map<string, { current: SaveImpl }>();

/**
 * The mutable save-impl ref for `key`, created on first use. The shared
 * controller's factory closes over this ref; each mount writes its latest impl.
 */
export function blockFieldSaveImplRef(key: string): { current: SaveImpl } {
  let ref = saveImpls.get(key);
  if (!ref) {
    ref = {
      current: () =>
        Promise.reject(
          new Error(`No save impl registered for block field "${key}"`),
        ),
    };
    saveImpls.set(key, ref);
  }
  return ref;
}

/** Test-only: how many controllers the registry currently holds. */
export function activeControllerCount(): number {
  return registry.size;
}

/** Test-only: reset the registry between tests. */
export function __resetBlockFieldSaveRegistry(): void {
  registry.clear();
  saveImpls.clear();
}
