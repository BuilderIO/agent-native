// Per-document-id serialization lane for the row peek's primary "Content" save.
//
// WHY THIS EXISTS (async-flush-vs-sync-teardown race): the preview save
// controller already guarantees newest-wins WITHIN one controller via single-
// flight + trailing. But the peek's ONE controller services MANY document ids
// over its lifetime — the row switches, the controller rebases its target id,
// and a flush triggered by that switch must persist the OLD row's trailing edit
// to the OLD id, dispatched BEFORE the rebase, never retargeted to the new row.
//
// The previous controller `flush()` DEFERRED the trailing save behind awaiting
// the in-flight save. Call sites invoked flush() fire-and-forget, so the rebase
// / unmount / navigation proceeded immediately and the deferred trailing save
// either never dispatched (mark() reset pending) or dispatched against the NEW
// row's id. The fix is to dispatch the final save SYNCHRONOUSLY at flush time,
// bound to the doc id captured at that moment — but a synchronous dispatch that
// can overlap an in-flight save for the same doc reintroduces write-inversion
// (the server write is unconditional, last-to-arrive wins).
//
// This lane restores ordering WITHOUT deferring dispatch: every save is enqueued
// on a per-doc-id chain. Dispatch order == enqueue order, so for a given doc id
// the writes commit in the order they were issued and the latest payload is
// final. Saves for DIFFERENT doc ids run on independent chains and never block
// or clobber each other. The enqueue itself is synchronous (the chain's tail is
// extended immediately), so the write is committed-to before the caller returns
// — which is what lets a fire-and-forget flush still beat teardown.
//
// Unlike the block-field registry (one shared controller per key, so the lane
// had nothing left to serialize and was removed), here a single controller spans
// many ids; the lane is the only thing that can order cross-id and same-id saves
// issued by that one controller.

type Saver = () => Promise<unknown>;

interface Lane {
  // The tail of the per-key promise chain. A new save appends to this; the next
  // save awaits it before running, so runs are strictly serialized in enqueue
  // order. Resolves (never rejects) so one failed save does not wedge the chain.
  tail: Promise<void>;
  // Outstanding (enqueued-but-not-settled) save count. When it returns to 0 the
  // lane is idle and can be dropped so the map does not grow unbounded.
  pending: number;
  // True while a save for this key is actually running (between dispatch and
  // settle). An idle lane (no running save) dispatches the NEXT save
  // SYNCHRONOUSLY rather than after a microtask hop — this is what lets a
  // fire-and-forget flush guarantee the write is dispatched (save() invoked)
  // before the caller's synchronous teardown line runs, not merely before async
  // IO. A busy lane still serializes the new save after the running one.
  running: boolean;
}

const lanes = new Map<string, Lane>();

/**
 * Enqueue `run` on the serialization lane for `key` (a document id). The save is
 * dispatched in enqueue order relative to other saves for the SAME key, after
 * any already-enqueued save for that key settles. Saves for different keys are
 * independent. Returns a promise that settles when THIS save settles.
 *
 * The enqueue is synchronous: by the time this returns, the lane's tail already
 * includes `run`, so a caller that does not await is still guaranteed the write
 * is committed-to before it proceeds to teardown/navigation.
 *
 * A rejected `run` is surfaced through the returned promise but does NOT break
 * the chain — subsequent saves for the key still run in order.
 */
export function enqueuePreviewSave(key: string, run: Saver): Promise<void> {
  let lane = lanes.get(key);
  if (!lane) {
    lane = { tail: Promise.resolve(), pending: 0, running: false };
    lanes.set(key, lane);
  }
  const entry = lane;
  entry.pending += 1;

  // The actual run, with bookkeeping. Invokes `run()` SYNCHRONOUSLY (so an idle
  // lane dispatches the save before returning) and returns a promise that
  // settles when THIS save settles. Surfaces the error to the issuing caller but
  // the caller (below) keeps the tail resolved, so one failed save cannot wedge
  // later saves for the key.
  const runOne = (): Promise<void> => {
    entry.running = true;
    // Call run() NOW (synchronously) so an idle-lane dispatch issues the save
    // before this function returns. A synchronous throw is normalized into a
    // rejected promise so it flows through the same settle path.
    let raw: Promise<unknown>;
    try {
      raw = Promise.resolve(run());
    } catch (err) {
      raw = Promise.reject(err);
    }
    return raw
      .then(() => undefined)
      .finally(() => {
        entry.running = false;
        entry.pending -= 1;
        // Drop the lane once fully idle so the map does not grow per-row forever.
        if (entry.pending === 0 && lanes.get(key) === entry) {
          lanes.delete(key);
        }
      });
  };

  if (!entry.running) {
    // IDLE lane: dispatch SYNCHRONOUSLY. run() is invoked before this function
    // returns, so a fire-and-forget caller's next synchronous line (a rebase /
    // teardown) happens AFTER the write has been issued. The tail advances to
    // this save so a later enqueue serializes behind it.
    const result = runOne();
    // The tail must resolve (never reject) regardless of this save's outcome.
    entry.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // BUSY lane: serialize after the running/queued saves. run() fires when the
  // tail resolves (after the prior save settles), preserving enqueue order.
  let settle!: () => void;
  let fail!: (err: unknown) => void;
  const result = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  entry.tail = entry.tail.then(() =>
    runOne().then(settle, (err) => {
      fail(err);
    }),
  );
  return result;
}

/** Test-only: how many active (non-idle) lanes the registry holds. */
export function activeLaneCount(): number {
  return lanes.size;
}

/** Test-only: reset all lanes between tests. */
export function __resetPreviewSaveLanes(): void {
  lanes.clear();
}
