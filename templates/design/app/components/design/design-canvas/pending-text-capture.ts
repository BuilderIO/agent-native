import {
  PENDING_TEXT_INTERCEPT_CAP_MS,
  routePendingTextEditKey,
} from "./pending-text-edit";

export interface BeginTextEditOptions {
  afterPointerGesture?: boolean;
  commitImmediately?: boolean;
  deliverOwed?: boolean;
}

export type BeginTextEditFn = (
  nodeId: string,
  options?: BeginTextEditOptions,
) => boolean;

export type ReclaimTextEditBufferFn = (nodeId: string) => string;

export type PendingTextHostCommitFn = (
  owner: string,
  nodeId: string,
  text: string,
) => boolean;

type OwnerIdentity = string;

type TeardownKind = "revoke" | "cleanup";

export interface PendingTextCaptureHandle {
  readonly token: number;
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
  buffer: string;
  intercepting: boolean;
  handedOff: boolean;
  interceptUntil: number;
  pendingBegin: { options?: BeginTextEditOptions } | null;
  commitOnBegin: boolean;
  deliveryPosted: boolean;
  deliveryFallbackArmed: boolean;
  committing: boolean;
  commitAttempts: number;
  teardownRun: boolean;
  timers: number[];
  commitFn: PendingTextHostCommitFn | null;
  retryTimer: number | null;
  teardown: Array<{ run: () => void; kind: TeardownKind; done: boolean }>;
}

let active: ActiveCapture | null = null;
let nextToken = 1;
const owners = new Map<OwnerIdentity, TextEditOwner>();
let hostCommit: PendingTextHostCommitFn | null = null;
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

function runTeardown(capture: ActiveCapture, kind?: TeardownKind): void {
  for (const entry of capture.teardown) {
    if (entry.done || (kind && entry.kind !== kind)) continue;
    entry.done = true;
    entry.run();
  }
}

function cancelActive(): void {
  const canceled = clearRecord();
  if (!canceled) return;
  runTeardown(canceled);
}

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

export const HOST_COMMIT_RETRY_DELAYS_MS = [250, 1_000, 3_000];

function commitOwedHostSide(capture: ActiveCapture): void {
  runTeardown(capture, "revoke");
  const detached = (active === capture ? clearRecord() : null) ?? capture;
  detached.committing = true;
  detached.intercepting = false;
  detached.handedOff = false;
  detached.pendingBegin = null;
  detached.deliveryPosted = false;
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

function reportUnwrittenText(
  record: ActiveCapture,
  error: unknown,
  reason: string,
): void {
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
    cancelActive();
    return;
  }
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
  cancelActive();
}

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
      if (active?.token === token) cancelActive();
    },
  };
}

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
    if (capture.deliveryPosted) {
      capture.deliveryPosted = false;
      capture.pendingBegin = { options: owedOptions(capture) };
    }
    if (!capture.intercepting) return;
    queueMicrotask(() => {
      if (active === capture && capture.intercepting && !owners.has(identity)) {
        endInterception(capture);
      }
    });
  };
}

export function registerPendingTextHostCommit(
  commit: PendingTextHostCommitFn,
): () => void {
  hostCommit = commit;
  return () => {
    if (hostCommit === commit) hostCommit = null;
    for (const record of [...hostCommitQueue]) {
      if (record.commitFn !== commit) continue;
      settleHostCommit(record);
      reportUnwrittenText(record, null, "writer-unregistered");
    }
  };
}

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

export function peekPendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
): string | null {
  const capture = liveCapture();
  return matches(capture, owner, nodeId) ? capture.buffer : null;
}

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

export function releasePendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
): void {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId)) return;
  clearRecord();
}

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

export function cancelPendingTextCapture(
  owner: OwnerIdentity,
  nodeId: string,
): void {
  const capture = liveCapture();
  if (!matches(capture, owner, nodeId)) return;
  cancelActive();
}

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
    capture.pendingBegin = { options: undefined };
    return;
  }
  if (!capture.buffer) {
    cancelActive();
    return;
  }
  oweDelivery(capture);
}

export function isPendingTextRequestLive(
  owner: OwnerIdentity,
  nodeId: string,
): boolean {
  return matches(liveCapture(), owner, nodeId);
}

export function isPendingTextInterceptionOpen(
  owner: OwnerIdentity,
  nodeId: string,
): boolean {
  const capture = liveCapture();
  return matches(capture, owner, nodeId) && capture.intercepting;
}

export function isPendingTextCaptureBound(
  owner: OwnerIdentity,
  nodeId: string,
): boolean {
  const capture = liveCapture();
  return matches(capture, owner, nodeId) && !capture.handedOff;
}
