// Per-field-key serialization lane for Blocks-field saves.
//
// PROBLEM (cross-instance write inversion):
//   Each AdditionalBlockEditor instance owns its OWN blockFieldSaveController,
//   which guarantees single-flight + trailing WITHIN that instance. But the
//   editor unmounts when its field is collapsed (or otherwise remounted under
//   the same `documentId:propertyId` key), and the cleanup fires a
//   fire-and-forget `void controller.flush()`. Re-expanding the SAME field
//   mounts a FRESH controller. If the user edits in the new instance before the
//   old instance's flush has settled, the OLD flush and the NEW save can be in
//   flight AT THE SAME TIME for the SAME field. The server write is
//   unconditional (last write to the DB wins), so they can commit out of order
//   and a stale value can clobber a newer one.
//
// FIX (serialize per key, ACROSS controller instances):
//   Route every save for a given `documentId:propertyId` through a module-level
//   lane keyed by that string. Each save chains after the previous save for the
//   same key, so the actual server writes for one field happen strictly in
//   ISSUE ORDER no matter which controller instance issued them. The old
//   instance's flush was issued first → it runs first; the new instance's edit
//   was issued later → it runs after and therefore wins. An older in-flight save
//   can never overwrite a newer one for the same field.
//
//   Different keys get different lanes and never serialize against each other,
//   so unrelated fields/documents save concurrently with no cross-key stall.
//
//   The lane entry is removed once its chain settles (no later save is queued),
//   so the map does not leak an entry per field touched over a session.

/** A lane is the tail promise of the currently-queued chain for one key. */
const lanes = new Map<string, Promise<unknown>>();

/**
 * Run `task` after any previously-enqueued task for `key` has settled, so saves
 * for the same field commit in issue order across controller instances.
 *
 * - Ordering: tasks for the same key run strictly one-at-a-time, in the order
 *   `enqueueFieldSave` was called — the global cross-instance guarantee.
 * - Isolation: a task's rejection does NOT poison the lane; the next task still
 *   runs (it chains off a settled tail regardless of outcome). The returned
 *   promise still rejects so the caller's controller can keep the value dirty.
 * - Cleanup: when a task settles and it is still the lane tail (nothing newer
 *   chained behind it), the lane entry is deleted to avoid unbounded growth.
 */
export function enqueueFieldSave<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = lanes.get(key) ?? Promise.resolve();

  // Chain after the previous tail, swallowing its result/rejection so this
  // task's scheduling never depends on the previous task's outcome — only its
  // completion (ordering, not success).
  const run = previous.then(
    () => task(),
    () => task(),
  );

  // This task becomes the new tail of the lane.
  lanes.set(key, run);

  // When this task settles, drop the lane entry IFF it is still the tail (i.e.
  // no newer save chained behind it). Comparing against the stored tail avoids
  // deleting a lane that a later enqueue has already extended.
  const settle = () => {
    if (lanes.get(key) === run) {
      lanes.delete(key);
    }
  };
  run.then(settle, settle);

  return run;
}

/** Test-only: how many keys currently have an active lane. */
export function activeLaneCount(): number {
  return lanes.size;
}
