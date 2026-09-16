import {
  PENDING_TEXT_INTERCEPT_CAP_MS,
  routePendingTextEditKey,
} from "./pending-text-edit";

export interface BeginTextEditOptions {
  afterPointerGesture?: boolean;
  /** Escape keeps what was typed (Figma): open the session, land the buffer,
   *  and close it again — never a path that drops the keystrokes. */
  commitImmediately?: boolean;
  /** Interception is over but the typed text is still owed to the node: open
   *  the session already holding it, caret at the end, and capture nothing. */
  deliverOwed?: boolean;
}

/** Returns whether the command actually reached a frame. A canvas whose iframe
 *  is not attached yet cannot deliver it, and the caller must keep the intent
 *  rather than consume it. */
export type BeginTextEditFn = (
  nodeId: string,
  options?: BeginTextEditOptions,
) => boolean;

/** Hands back, and forgets, whatever the owning canvas buffered for `nodeId`
 *  after it took interception over. */
export type ReclaimTextEditBufferFn = (nodeId: string) => string;

/** Writes owed text straight into the node's source when no owner became
 *  ready to take it. Returns whether the node now holds that text. */
export type PendingTextHostCommitFn = (
  owner: string,
  nodeId: string,
  text: string,
) => boolean;

/**
 * Identity of the canvas that owns a node: a screen's own file id, or the
 * board file id for the overview board surface. Breakpoint preview frames
 * render the same screen and must NEVER register — they would collide with
 * the primary frame on the same key and steal its activation.
 */
type OwnerIdentity = string;

type TeardownKind = "revoke" | "cleanup";

export interface PendingTextCaptureHandle {
  readonly token: number;
  /** Attaches the created node once the insert has returned its id. */
  bind(nodeId: string): void;
  cancel(): void;
}

interface TextEditOwner {
  begin: BeginTextEditFn;
  reclaim?: ReclaimTextEditBufferFn;
}

interface ActiveCapture {
  token: number;
  owner: OwnerIdentity;
  nodeId: string | null;
  /** Typed text this host holds for the node. Once interception has ended it
   *  is an obligation: delivered, committed, or loudly reported — never
   *  expired. */
  buffer: string;
  /** Keystrokes are still held back from the host, here or in the canvas that
   *  took them over. Ends at the cap, on Escape, on an explicit failure, or when
   *  the text goes out for delivery, and never restarts. */
  intercepting: boolean;
  /** The owning canvas took the buffer and intercepts from here. The record
   *  itself stays as the request's identity, so a later stand-down still tears
   *  down the activation and the retries that outlived the handoff. */
  handedOff: boolean;
  interceptUntil: number;
  /** A begin-text-edit call whose owner canvas was not mounted yet. It rides
   *  on the capture so cancelling the capture drops the request with it — a
   *  request that outlived its node would re-open an edit on nothing. */
  pendingBegin: { options?: BeginTextEditOptions } | null;
  /** Escape arrived while these keystrokes were still undelivered: the owner
   *  commits them and closes the session instead of leaving it open. */
  commitOnBegin: boolean;
  /** The owed text went out to a mounted owner and waits for the frame to take
   *  it. That copy dies with the owner's bridge queue, so this one stays. */
  deliveryPosted: boolean;
  deliveryFallbackArmed: boolean;
  /** The host-side commit owns this record now: it is detached from `active`,
   *  intercepts nothing, and exists only to carry the text until a write is
   *  accepted. */
  committing: boolean;
  commitAttempts: number;
  teardownRun: boolean;
  timers: number[];
  /** The host write that owns this payload, captured when the record detached.
   *  Retrying against whatever is registered LATER would write one editor's
   *  text through another's writer. */
  commitFn: PendingTextHostCommitFn | null;
  retryTimer: number | null;
  /** Everything else this one creation started. `revoke` undoes what could
   *  still write the text (the canvas's delayed activation, its queued begin,
   *  the frame's copy); `cleanup` deletes the abandoned node. The host-side
   *  write runs only the former — the node is where its text has to land. */
  teardown: Array<{ run: () => void; kind: TeardownKind; done: boolean }>;
}

/**
 * Host-level keystroke capture for the T-tool creation gesture. Exactly one is
 * armed at a time, SYNCHRONOUSLY at the gesture boundary, before any canvas is
 * asked to open an edit session.
 *
 * It exists because the canvas that owns the new node may not be mounted yet:
 * the overview board surface only renders once its file has content, so the
 * very insert that creates a board text node is what causes its canvas to
 * mount. Arming inside `DesignCanvas.beginTextEdit` therefore armed some other
 * screen's buffer, which then swallowed every keystroke of the gesture.
 *
 * It does two jobs with different lifetimes. Interception holds keys back while
 * the owner's save and mount are in flight, and ends on the cap, Escape, or an
 * explicit failure. Delivery of what was already typed does not end with it:
 * the text goes to the owner whenever it is ready, or into the node's source
 * host-side, or it fails loudly.
 */
let active: ActiveCapture | null = null;
let nextToken = 1;
const owners = new Map<OwnerIdentity, TextEditOwner>();
let hostCommit: PendingTextHostCommitFn | null = null;
/** Records detached from `active` that still owe their text to a host write. */
const hostCommitQueue = new Set<ActiveCapture>();

function liveCapture(): ActiveCapture | null {
  if (active?.intercepting && Date.now() > active.interceptUntil) {
    endInterception(active);
  }
  return active;
}

function matches(
  capture: ActiveCapture | null,
  owner: OwnerIdentity,
  nodeId: string,
): capture is ActiveCapture {
  return capture?.owner === owner && capture.nodeId === nodeId;
}

function owedOptions(capture: ActiveCapture): BeginTextEditOptions {
  return capture.commitOnBegin
    ? { commitImmediately: true }
    : { deliverOwed: true };
}

function stopListening(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("pointerdown", onPointerDown, true);
}

function startListening(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pointerdown", onPointerDown, true);
}

function clearRecord(): ActiveCapture | null {
  const record = active;
  active = null;
  stopListening();
  if (record && typeof window !== "undefined") {
    for (const timer of record.timers) window.clearTimeout(timer);
  }
  return record;
}

/** Everything this one creation started: the owning canvas's delayed
 *  activation, its bridge copy of the delivery, and the editor's retry ladder.
 *  Idempotent — the host-side commit runs it before its write, and a later
 *  stand-down must not run it twice. */
function runTeardown(capture: ActiveCapture, kind?: TeardownKind): void {
  for (const entry of capture.teardown) {
    if (entry.done || (kind && entry.kind !== kind)) continue;
    entry.done = true;
    entry.run();
  }
}

/** Drops the request AND everything it started. Clears `active` first, so a
 *  teardown that settles the retry ladder sees the capture already stood down
 *  and lets the ladder's own empty-node cleanup run. */
function cancelActive(): void {
  const canceled = clearRecord();
  if (!canceled) return;
  runTeardown(canceled);
}

/** Ends interception for good and gathers every typed character into this
 *  record — including the keys a canvas that took interception over is still
 *  holding, which would otherwise die with that canvas's request. */
function stopIntercepting(capture: ActiveCapture): void {
  capture.intercepting = false;
  if (capture.handedOff && capture.nodeId) {
    capture.buffer +=
      owners.get(capture.owner)?.reclaim?.(capture.nodeId) ?? "";
  }
  capture.handedOff = false;
}

function endInterception(capture: ActiveCapture): void {
  stopIntercepting(capture);
  if (!capture.buffer) {
    cancelActive();
    return;
  }
  oweDelivery(capture);
}

function oweDelivery(capture: ActiveCapture): void {
  const options = owedOptions(capture);
  capture.pendingBegin = { options };
  capture.deliveryPosted = false;
  armDeliveryFallback(capture);
  const begin = capture.nodeId ? owners.get(capture.owner)?.begin : undefined;
  if (
    capture.nodeId &&
    begin?.(capture.nodeId, options) &&
    active === capture
  ) {
    capture.pendingBegin = null;
    capture.deliveryPosted = true;
  }
}

/** One full save-and-mount window after interception ends. An owner that has
 *  still not taken the text by then is not coming, and the text must not wait
 *  in memory for a reload to lose it. */
function armDeliveryFallback(capture: ActiveCapture): void {
  if (capture.deliveryFallbackArmed || typeof window === "undefined") return;
  capture.deliveryFallbackArmed = true;
  capture.timers.push(
    window.setTimeout(() => {
      if (active !== capture || capture.intercepting || !capture.buffer) return;
      commitOwedHostSide(capture);
    }, PENDING_TEXT_INTERCEPT_CAP_MS),
  );
}

/** Backoff for a host write that was refused or threw. A rejected publication
 *  and a momentarily unreadable source are both recoverable a moment later. */
export const HOST_COMMIT_RETRY_DELAYS_MS = [250, 1_000, 3_000];

/**
 * The frame's copy is revoked FIRST — from here only this write can land the
 * text, so an accepted commit is the single copy (see the delivery revoke in
 * DesignCanvas). ONLY the revoke teardowns run: the cleanup teardown deletes
 * the node this text still has to land in. The record then leaves `active`:
 * detached it holds no listeners, intercepts nothing, and cannot be resurrected
 * into a session or block the next creation, but it still carries the only
 * buffer there is until a write is accepted.
 */
function commitOwedHostSide(capture: ActiveCapture): void {
  runTeardown(capture, "revoke");
  const detached = (active === capture ? clearRecord() : null) ?? capture;
  detached.committing = true;
  detached.intercepting = false;
  detached.handedOff = false;
  detached.pendingBegin = null;
  detached.deliveryPosted = false;
  // Bound to the writer that exists NOW. A retry that reached whatever was
  // registered later would push one editor's text through another's writer.
  detached.commitFn = hostCommit;
  hostCommitQueue.add(detached);
  attemptHostCommit(detached);
}

function attemptHostCommit(record: ActiveCapture): void {
  if (!hostCommitQueue.has(record) || !record.buffer) return;
  const { owner, nodeId, buffer, commitFn } = record;
  let committed = false;
  let error: unknown = null;
  try {
    committed = Boolean(nodeId && commitFn?.(owner, nodeId, buffer));
  } catch (caught) {
    error = caught;
  }
  if (committed) {
    settleHostCommit(record);
    return;
  }
  // Refused or threw: the text is still owed. Dropping it here left nothing but
  // a log line with its length — the exact unrecoverable failure this whole
  // capture exists to prevent.
  const delay = HOST_COMMIT_RETRY_DELAYS_MS[record.commitAttempts];
  record.commitAttempts += 1;
  if (delay !== undefined && commitFn && typeof window !== "undefined") {
    record.retryTimer = window.setTimeout(() => {
      record.retryTimer = null;
      attemptHostCommit(record);
    }, delay);
    return;
  }
  settleHostCommit(record);
  reportUnwrittenText(record, error, commitFn ? "commit-failed" : "no-writer");
}

function settleHostCommit(record: ActiveCapture): void {
  hostCommitQueue.delete(record);
  if (record.retryTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(record.retryTimer);
  }
  record.retryTimer = null;
}

/** The write never landed. The NODE is what stays recoverable — its cleanup
 *  teardown is deliberately never run from this path — and the report names it
 *  so the failure is actionable. The characters themselves are never logged. */
function reportUnwrittenText(
  record: ActiveCapture,
  error: unknown,
  reason: string,
): void {
  // Never the error OBJECT and never its message: a thrown error routinely
  // quotes the value that failed, so logging it hands back the very characters
  // this path refuses to log. Class and code identify the failure; the length
  // and ids make it actionable.
  const errorType =
    error === null || error === undefined
      ? undefined
      : ((error as { constructor?: { name?: string } }).constructor?.name ??
        typeof error);
  console.error(
    `[design] typed text could not be written to ${record.owner}/${record.nodeId} after ${record.commitAttempts} attempts; the empty layer is kept so the text can be retyped into it`,
    {
      screenId: record.owner,
      nodeId: record.nodeId,
      length: record.buffer.length,
      reason,
      errorType,
    },
  );
}

function onKeyDown(event: KeyboardEvent): void {
  const capture = liveCapture();
  if (!capture) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    // Undo walks the creation itself back, so the node this buffer is bound to
    // is about to stop existing. Stand down and let the chord through instead
    // of holding keystrokes for a node nobody will ever open.
    cancelActive();
    return;
  }
  // Past interception this listener stays only for the stand-downs above and
  // pointer-away; every other key belongs to the host again. Handed off, the
  // owning canvas intercepts instead.
  if (!capture.intercepting || capture.handedOff) return;
  const routed = routePendingTextEditKey(event);
  if (routed.action === "pass") return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (routed.action === "buffer") {
    capture.buffer += routed.char;
  } else if (routed.action === "drop-last") {
    capture.buffer = capture.buffer.slice(0, -1);
  } else if (routed.action === "clear-and-swallow") {
    // Escape ends the session but KEEPS the text (Figma). Only an empty
    // creation is abandoned; one with keystrokes hands them to its owner to
    // commit, so the buffer is never the thing Escape throws away.
    if (capture.buffer) {
      capture.commitOnBegin = true;
      capture.intercepting = false;
      oweDelivery(capture);
    } else {
      cancelActive();
    }
  }
}

function onPointerDown(): void {
  // The user clicked somewhere else in the host — stand the whole request
  // down, not just the buffer: a delayed activation or a retry that survives
  // this click yanks focus back into a node they have walked away from.
  cancelActive();
}

/** Arms the capture for a T-tool creation on `owner`. Supersedes any capture
 *  still armed for an earlier creation. */
export function armPendingTextCapture(args: {
  owner: OwnerIdentity;
}): PendingTextCaptureHandle {
  const token = nextToken++;
  cancelActive();
  const capture: ActiveCapture = {
    token,
    owner: args.owner,
    nodeId: null,
    buffer: "",
    intercepting: true,
    handedOff: false,
    interceptUntil: Date.now() + PENDING_TEXT_INTERCEPT_CAP_MS,
    pendingBegin: null,
    commitOnBegin: false,
    deliveryPosted: false,
    deliveryFallbackArmed: false,
    committing: false,
    commitAttempts: 0,
    teardownRun: false,
    timers: [],
    commitFn: null,
    retryTimer: null,
    teardown: [],
  };
  active = capture;
  startListening();
  if (typeof window !== "undefined") {
    // The cap has to fire even when no key and no owner registration asks for
    // it: that is what moves a stalled canvas's buffer on to delivery.
    capture.timers.push(
      window.setTimeout(() => {
        if (active === capture) liveCapture();
      }, PENDING_TEXT_INTERCEPT_CAP_MS + 1),
    );
  }
  return {
    token,
    bind(nodeId: string) {
      if (active?.token !== token) return;
      active.nodeId = nodeId;
    },
    cancel() {
      // Token-scoped: a later creation on the same surface already superseded
      // this one, and cancelling the earlier request must not touch it.
      if (active?.token === token) cancelActive();
    },
  };
}

/** Registers work belonging to this exact creation, to be undone when the
 *  request stands down (pointer-away, Escape, undo, supersede, an interception
 *  that ends with nothing typed) or is committed host-side.
 *  Identity-scoped: a callback for any other creation is ignored outright. */
export function onPendingTextCaptureCancel(
  owner: OwnerIdentity,
  nodeId: string,
  teardown: () => void,
  options?: { kind?: TeardownKind },
): void {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId)) return;
  capture.teardown.push({
    run: teardown,
    kind: options?.kind ?? "revoke",
    done: false,
  });
}

/** Registers the canvas that owns `identity`. Call it for the primary frame of
 *  a screen and for the board canvas only, and never gate it on the canvas
 *  being the active surface — an inactive board canvas must still be routable.
 *  `reclaim` gives back whatever that canvas buffered after taking the keys
 *  over. The returned unregister is identity-guarded so a stale unmount cannot
 *  remove a replacement. */
export function registerTextEditOwner(
  identity: OwnerIdentity | undefined,
  beginTextEdit: BeginTextEditFn,
  reclaim?: ReclaimTextEditBufferFn,
): () => void {
  if (!identity) return () => {};
  const entry: TextEditOwner = { begin: beginTextEdit, reclaim };
  owners.set(identity, entry);
  const capture = liveCapture();
  if (
    capture?.owner === identity &&
    capture.nodeId &&
    capture.pendingBegin !== null
  ) {
    // Keep the intent unless the command actually reached a frame. A canvas
    // can register before its iframe is attached (conditional/keyed render),
    // and consuming the intent there dropped the creation with no retry.
    const { options } = capture.pendingBegin;
    if (beginTextEdit(capture.nodeId, options) && active === capture) {
      capture.pendingBegin = null;
      if (!capture.intercepting) capture.deliveryPosted = true;
    }
  }
  return () => {
    if (owners.get(identity) !== entry) return;
    owners.delete(identity);
    const capture = active;
    if (capture?.owner !== identity) return;
    // A delivery posted into this instance dies with its bridge queue; the
    // text is still here, so the next owner has to be asked again.
    if (capture.deliveryPosted) {
      capture.deliveryPosted = false;
      capture.pendingBegin = { options: owedOptions(capture) };
    }
    // A keyed remount registers its replacement within this same commit, before
    // any microtask runs. An owner still missing after that is not mounted, so
    // stop holding keys for it; what was typed stays owed to the next owner, or
    // to the host-side commit. A macrotask here raced React's next render.
    if (!capture.intercepting) return;
    queueMicrotask(() => {
      if (active === capture && capture.intercepting && !owners.has(identity)) {
        endInterception(capture);
      }
    });
  };
}

/** Registers the one writer that commits owed text into a node's source when
 *  no owner ever took it. */
export function registerPendingTextHostCommit(
  commit: PendingTextHostCommitFn,
): () => void {
  hostCommit = commit;
  return () => {
    if (hostCommit === commit) hostCommit = null;
    // The editor that owned these writes is gone. A retry timer that outlived
    // it would fire into a torn-down editor, or worse, into whatever writer
    // registers next — one design's text written through another's.
    for (const record of [...hostCommitQueue]) {
      if (record.commitFn !== commit) continue;
      settleHostCommit(record);
      reportUnwrittenText(record, null, "writer-unregistered");
    }
  };
}

/** Opens the edit session for a just-created node on the canvas that owns it,
 *  synchronously when that canvas is mounted. Otherwise the armed capture holds
 *  the request until the owner registers. */
export function beginTextEditForOwner(
  owner: OwnerIdentity,
  nodeId: string,
  options?: BeginTextEditOptions,
): void {
  const beginTextEdit = owners.get(owner)?.begin;
  if (beginTextEdit?.(nodeId, options)) return;
  const capture = liveCapture();
  if (matches(capture, owner, nodeId)) {
    capture.pendingBegin = { options };
  }
}

/** Hands the buffered keystrokes to the owning canvas as it opens the session
 *  for that exact node; that canvas's own pending buffer intercepts from here
 *  on. Returns null for any other canvas/node, so a foreign canvas can never
 *  drain the buffer, and once interception has ended, because owed text is
 *  delivered from here and never moved into a canvas that would intercept
 *  again. */
export function takePendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
): string | null {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId) || !capture.intercepting) return null;
  const { buffer } = capture;
  capture.buffer = "";
  capture.handedOff = true;
  capture.pendingBegin = null;
  return buffer;
}

/** Reads the buffered keystrokes WITHOUT consuming them. */
export function peekPendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
): string | null {
  const capture = liveCapture();
  return matches(capture, owner, nodeId) ? capture.buffer : null;
}

/** The owning canvas is sending the text out now — Escape's commit, or an owed
 *  delivery. Folds in what that canvas buffered, ends interception for good,
 *  and returns the whole text for the command. The text stays owned here until
 *  the frame acknowledges it: a copy living only in one canvas instance's
 *  bridge queue dies with an iframe swap or an unmount, and nothing would know
 *  it had. */
export function owePendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
  canvasBuffer: string,
  options: { commit: boolean },
): string | null {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId)) return null;
  capture.buffer += canvasBuffer;
  capture.intercepting = false;
  capture.handedOff = false;
  if (options.commit) capture.commitOnBegin = true;
  capture.pendingBegin = null;
  capture.deliveryPosted = true;
  armDeliveryFallback(capture);
  return capture.buffer;
}

/** The frame opened a session on this node: hand it everything still held for
 *  that session, and KEEP the record until the frame says the text landed.
 *  Releasing here lost the keystrokes whenever the editable was replaced before
 *  the insert arrived — the frame drops an insert it cannot place, and no one
 *  else held a copy. `alreadyPosted` marks an owed delivery that carried the
 *  text in its own begin command, which must not be sent a second copy.
 *  Returns null when there is nothing to deliver, including a commit still
 *  waiting for its own acknowledgement. Never runs the teardown. */
export function beginPendingTextDelivery(
  owner: OwnerIdentity,
  nodeId: string,
  canvasBuffer: string,
): { text: string; alreadyPosted: boolean } | null {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId) || capture.commitOnBegin) return null;
  if (capture.deliveryPosted) return { text: "", alreadyPosted: true };
  capture.buffer += canvasBuffer;
  capture.intercepting = false;
  capture.handedOff = false;
  capture.pendingBegin = null;
  capture.deliveryPosted = true;
  armDeliveryFallback(capture);
  return { text: capture.buffer, alreadyPosted: false };
}

/** The frame reports whether text it was handed actually landed in the session.
 *  Landed completes the request; dropped keeps the obligation and asks the
 *  owner again, with the host-side commit fallback still armed behind it. */
export function acknowledgePendingTextInsert(
  owner: OwnerIdentity,
  nodeId: string,
  inserted: boolean,
): void {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId) || !capture.deliveryPosted) return;
  if (inserted) {
    clearRecord();
    return;
  }
  capture.deliveryPosted = false;
  oweDelivery(capture);
}

/** The request completed — the frame took the text. Drops the record WITHOUT
 *  running the stand-down teardown, which exists for abandonment. */
export function releasePendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
): void {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId)) return;
  clearRecord();
}

/** An explicit failure on the save or mount path: a rolled-back save of the
 *  owner's file, or a ready owner reporting the node missing. Interception
 *  ends now, and typed text is committed host-side or reported loudly. Omit
 *  `nodeId` to fail whichever creation `owner` holds.
 *
 *  Reports what happened to the payload, because the caller's next act depends
 *  on it: `write-queued` means a detached host write now owes this node its
 *  text and is inside its backoff, so the node must outlive that write —
 *  deleting it here landed an accepted write in a node that no longer existed.
 *  `nothing-owed` is the terminal empty case the creation cleans up. */
/** Is a detached host write still owing this exact node its text? A rolled-back
 *  save hands the payload to the writer and clears `active`, so anything that
 *  judges the node from `active` alone sees "nothing owed" while the write is
 *  mid-backoff — and deletes the node out from under it. */
export function isPendingTextWriteInFlight(
  owner: OwnerIdentity,
  nodeId?: string,
): boolean {
  for (const record of hostCommitQueue) {
    if (record.owner !== owner) continue;
    if (nodeId !== undefined && record.nodeId !== nodeId) continue;
    if (record.buffer) return true;
  }
  return false;
}

export function failPendingTextCapture(
  owner: OwnerIdentity,
  nodeId?: string,
): "write-queued" | "nothing-owed" {
  const capture = liveCapture();
  const ownsActive =
    capture?.owner === owner &&
    (nodeId === undefined || capture.nodeId === nodeId);
  if (!ownsActive) {
    // Not active does NOT mean nothing is owed: the rollback path already
    // detached this payload into the write queue.
    return isPendingTextWriteInFlight(owner, nodeId)
      ? "write-queued"
      : "nothing-owed";
  }
  stopIntercepting(capture);
  if (!capture.buffer) {
    cancelActive();
    return "nothing-owed";
  }
  commitOwedHostSide(capture);
  return "write-queued";
}

/** Stands this exact request down from a path that cannot reach the capture's
 *  own listeners — the mounted canvas swallows Escape before they run, and the
 *  bridge reports its own abandonment through the canvas. Identity-scoped: a
 *  cancel naming any other creation is a no-op. */
export function cancelPendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
): void {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId)) return;
  cancelActive();
}

/** Gives the buffer back when the owning canvas goes away before the session
 *  started — an unmount between handoff and activation otherwise destroys the
 *  only copy of the gesture's keystrokes. The begin INTENT comes back with
 *  them: the bytes alone leave the next owner registration with nothing to
 *  flush them into. Identity-scoped, so a canvas that already lost the request
 *  to a newer creation cannot resurrect it. */
export function returnPendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
  buffer: string,
): void {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId)) return;
  capture.buffer = buffer + capture.buffer;
  capture.handedOff = false;
  if (capture.intercepting) {
    // The creating pointer gesture is long over by the time an owner remounts,
    // so the replacement begins immediately rather than waiting out a trailing
    // click that already happened.
    capture.pendingBegin = { options: undefined };
    return;
  }
  if (!capture.buffer) {
    cancelActive();
    return;
  }
  oweDelivery(capture);
}

/** True while this exact creation's request is still open — intercepting,
 *  handed off, or owed. A bridge reply that arrives for a request that has
 *  already been stood down must not re-arm anything. */
export function isPendingTextRequestLive(
  owner: OwnerIdentity,
  nodeId: string,
): boolean {
  return matches(liveCapture(), owner, nodeId);
}

/** True while keystrokes for this exact creation are still being held back
 *  from the host. A canvas intercepts only inside this window. */
export function isPendingTextInterceptionOpen(
  owner: OwnerIdentity,
  nodeId: string,
): boolean {
  const capture = liveCapture();
  return matches(capture, owner, nodeId) && capture.intercepting;
}

/** True while the capture itself holds this creation's keys — bound to exactly
 *  this node and not handed to a canvas. */
export function isPendingTextCaptureBound(
  owner: OwnerIdentity,
  nodeId: string,
): boolean {
  const capture = liveCapture();
  return matches(capture, owner, nodeId) && !capture.handedOff;
}
