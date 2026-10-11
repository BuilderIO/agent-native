import { createHash } from "node:crypto";

import { isBenignAbort } from "@agent-native/core/shared/error-noise";

import {
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "../../shared/session-replay-diagnostics.js";
import { isStalledRequest } from "../../shared/stalled-requests.js";

/**
 * Replay friction detectors. They run once per ingested chunk batch over the
 * new chunks' rrweb events, in order, and carry their state to the next batch
 * so a click near the end of one batch can still resolve in the next. State
 * holds timestamps, rrweb node ids, and hashed request keys only, never page
 * text or URLs.
 */

const RRWEB_FULL_SNAPSHOT = 2;
const RRWEB_INCREMENTAL_SNAPSHOT = 3;
const RRWEB_META = 4;
const RRWEB_CUSTOM = 5;
const SOURCE_MUTATION = 0;
const SOURCE_MOUSE_INTERACTION = 2;
const SOURCE_SCROLL = 3;
const SOURCE_INPUT = 5;
const SOURCE_MEDIA_INTERACTION = 7;
const SOURCE_SELECTION = 14;
const MOUSE_CLICK = 2;
const MOUSE_FOCUS = 5;

/** A click with no visible response within this long is a dead click. */
export const DEAD_CLICK_WINDOW_MS = 1_000;
/** A focus this close before a click on the same node answers the click. */
const FOCUS_ANSWERS_CLICK_MS = 1_000;
/** This many failures in a row to one endpoint is a retry loop. */
export const RETRY_LOOP_MIN_FAILURES = 3;
export const RETRY_LOOP_WINDOW_MS = 60_000;
/** An error this close to the recording's last event reads as leaving. */
export const ERROR_THEN_LEAVE_WINDOW_MS = 30_000;
/** The recorder's message for `xhr.abort()`, which `isBenignAbort` does not know. */
const XHR_ABORTED = "XMLHttpRequest aborted";
const MAX_TRACKED_REQUEST_KEYS = 50;
const MAX_TRACKED_TOAST_IDS = 50;
const RAGE_CLICK_MIN_CLICKS = 3;
const RAGE_CLICK_WINDOW_MS = 1_000;
const RAGE_CLICK_RADIUS_PX = 30;

interface ReplayClickPoint {
  at: number;
  x: number;
  y: number;
  target: number | null;
}

interface ReplayRageClickCluster extends ReplayClickPoint {
  size: number;
  counted: boolean;
}

export interface ReplayFrictionDetectorState {
  v: 2;
  /**
   * Never counted when the recording ends with it still pending: the click
   * that ends a recording is usually the one that left the page.
   */
  pendingClickAt: number | null;
  lastFocus: { id: number; at: number } | null;
  lastEventAt: number | null;
  lastErrorAt: number | null;
  failures: Record<string, { n: number; at: number; counted: boolean }>;
  toastIds: number[];
  rageClickCluster: ReplayRageClickCluster | null;
  /** Null only when migrating state written before rage-click progress existed. */
  rageClickCount: number | null;
  /** Persisted separately from detector progress for out-of-order chunk checks. */
  lastSeq?: number;
}

export interface ReplayFrictionDelta {
  deadClicks: number;
  rageClicks: number;
  errorToasts: number;
  retryLoops: number;
  stalledRequests: number;
  http4xx: number;
  http5xx: number;
  /**
   * Errors Monitoring could have turned into an issue: uncaught errors,
   * unhandled rejections, and captured exceptions, never a plain
   * `console.error`. An older recorder's console error could be either, so
   * it counts.
   */
  issueErrors: number;
}

export function emptyReplayFrictionDetectorState(): ReplayFrictionDetectorState {
  return {
    v: 2,
    pendingClickAt: null,
    lastFocus: null,
    lastEventAt: null,
    lastErrorAt: null,
    failures: {},
    toastIds: [],
    rageClickCluster: null,
    rageClickCount: 0,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Cancelled by the page or by the page leaving, not failed by the network. */
function isAbortedRequest(payload: Record<string, unknown>): boolean {
  if (payload.pageLeaving === true) return true;
  const error = payload.error;
  if (typeof error !== "string") return false;
  return error === XHR_ABORTED || isBenignAbort("", error);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || finiteNumber(value) !== null;
}

/**
 * Stored state that does not match this shape cannot be continued, and a
 * fresh state would miscount, so the caller stops measuring the recording.
 */
export function parseReplayFrictionDetectorState(
  raw: string,
): ReplayFrictionDetectorState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // coercion-ok: null is "unreadable"; the caller stops measuring the recording.
    return null;
  }
  const state = record(parsed);
  if (state.v !== 1 && state.v !== 2) return null;
  if (
    state.lastSeq !== undefined &&
    (typeof state.lastSeq !== "number" ||
      !Number.isSafeInteger(state.lastSeq) ||
      state.lastSeq < 0)
  ) {
    return null;
  }
  if (
    !nullableNumber(state.pendingClickAt) ||
    !nullableNumber(state.lastEventAt) ||
    !nullableNumber(state.lastErrorAt)
  ) {
    return null;
  }
  const focus = state.lastFocus === null ? null : record(state.lastFocus);
  if (
    focus !== null &&
    (finiteNumber(focus.id) === null || finiteNumber(focus.at) === null)
  ) {
    return null;
  }
  if (!Array.isArray(state.toastIds) || !state.toastIds.every(Number.isFinite))
    return null;
  const failures = record(state.failures);
  for (const entry of Object.values(failures)) {
    const failure = record(entry);
    if (
      finiteNumber(failure.n) === null ||
      finiteNumber(failure.at) === null ||
      typeof failure.counted !== "boolean"
    ) {
      return null;
    }
  }
  let rageClickCluster: ReplayRageClickCluster | null = null;
  let rageClickCount: number | null = null;
  if (state.v === 2) {
    const rawCluster = state.rageClickCluster;
    if (rawCluster !== null) {
      const cluster = record(rawCluster);
      if (
        finiteNumber(cluster.at) === null ||
        finiteNumber(cluster.x) === null ||
        finiteNumber(cluster.y) === null ||
        !(cluster.target === null || finiteNumber(cluster.target) !== null) ||
        !Number.isInteger(cluster.size) ||
        Number(cluster.size) < 1 ||
        Number(cluster.size) > RAGE_CLICK_MIN_CLICKS ||
        typeof cluster.counted !== "boolean"
      ) {
        return null;
      }
      rageClickCluster = {
        at: Number(cluster.at),
        x: Number(cluster.x),
        y: Number(cluster.y),
        target: cluster.target as number | null,
        size: Number(cluster.size),
        counted: cluster.counted,
      };
    }
    if (
      finiteNumber(state.rageClickCount) === null ||
      Number(state.rageClickCount) < 0 ||
      !Number.isInteger(state.rageClickCount)
    ) {
      return null;
    }
    rageClickCount = Number(state.rageClickCount);
  }
  return {
    v: 2,
    pendingClickAt: state.pendingClickAt as number | null,
    lastFocus: focus as { id: number; at: number } | null,
    lastEventAt: state.lastEventAt as number | null,
    lastErrorAt: state.lastErrorAt as number | null,
    failures: failures as Record<
      string,
      { n: number; at: number; counted: boolean }
    >,
    toastIds: state.toastIds as number[],
    rageClickCluster,
    rageClickCount,
    ...(state.lastSeq === undefined ? {} : { lastSeq: state.lastSeq }),
  };
}

function replayClickPoint(
  event: Record<string, unknown>,
): ReplayClickPoint | null {
  if (finiteNumber(event.type) !== RRWEB_INCREMENTAL_SNAPSHOT) return null;
  const data = record(event.data);
  if (!isClick(data)) return null;
  const at = finiteNumber(event.timestamp);
  if (at === null) return null;
  return {
    at,
    x: finiteNumber(data.x) ?? 0,
    y: finiteNumber(data.y) ?? 0,
    target: finiteNumber(data.id),
  };
}

function sameRageClickTarget(
  cluster: ReplayClickPoint,
  click: ReplayClickPoint,
): boolean {
  if (cluster.target !== null && click.target !== null) {
    return cluster.target === click.target;
  }
  return (
    Math.abs(cluster.x - click.x) <= RAGE_CLICK_RADIUS_PX &&
    Math.abs(cluster.y - click.y) <= RAGE_CLICK_RADIUS_PX
  );
}

function countRageClick(
  state: ReplayFrictionDetectorState,
  event: Record<string, unknown>,
): boolean {
  const click = replayClickPoint(event);
  if (!click) return false;
  const cluster = state.rageClickCluster;
  if (
    cluster &&
    click.at - cluster.at <= RAGE_CLICK_WINDOW_MS &&
    click.at >= cluster.at &&
    sameRageClickTarget(cluster, click)
  ) {
    cluster.at = click.at;
    if (!cluster.counted) cluster.size += 1;
    if (!cluster.counted && cluster.size === RAGE_CLICK_MIN_CLICKS) {
      cluster.counted = true;
      state.rageClickCount = (state.rageClickCount ?? 0) + 1;
      return true;
    }
    return false;
  }
  state.rageClickCluster = { ...click, size: 1, counted: false };
  return false;
}

/** Counts completed rage-click clusters in one batch without prior state. */
export function countReplayRageClicks(events: readonly unknown[]): number {
  const state = emptyReplayFrictionDetectorState();
  let count = 0;
  for (const raw of events) {
    if (countRageClick(state, record(raw))) count += 1;
  }
  return count;
}

function requestKey(method: unknown, url: unknown): string {
  let path = typeof url === "string" ? url : "";
  try {
    path = new URL(path, "http://replay.invalid").pathname;
  } catch {
    path = path.split(/[?#]/)[0] ?? "";
  }
  const verb = typeof method === "string" ? method.toUpperCase() : "GET";
  return createHash("sha256")
    .update(`${verb} ${path}`)
    .digest("hex")
    .slice(0, 16);
}

function isClick(data: Record<string, unknown>): boolean {
  return data.source === SOURCE_MOUSE_INTERACTION && data.type === MOUSE_CLICK;
}

/** Anything the page did that a person could see after a click. */
function answersClick(type: number, data: Record<string, unknown>): boolean {
  if (type === RRWEB_FULL_SNAPSHOT || type === RRWEB_META) return true;
  if (type !== RRWEB_INCREMENTAL_SNAPSHOT) return false;
  return (
    data.source === SOURCE_MUTATION ||
    data.source === SOURCE_SCROLL ||
    data.source === SOURCE_INPUT ||
    data.source === SOURCE_MEDIA_INTERACTION ||
    data.source === SOURCE_SELECTION
  );
}

function isSonnerToast(attributes: Record<string, unknown>): boolean {
  return "data-sonner-toast" in attributes;
}

function rememberToast(state: ReplayFrictionDetectorState, id: number): void {
  if (state.toastIds.includes(id)) return;
  state.toastIds.push(id);
  if (state.toastIds.length > MAX_TRACKED_TOAST_IDS) state.toastIds.shift();
}

/** Error toasts this mutation shows, by Sonner's `data-type` attribute. */
function countErrorToasts(
  state: ReplayFrictionDetectorState,
  data: Record<string, unknown>,
): number {
  let count = 0;
  if (Array.isArray(data.adds)) {
    for (const add of data.adds) {
      const node = record(record(add).node);
      const attributes = record(node.attributes);
      if (!isSonnerToast(attributes)) continue;
      const id = finiteNumber(node.id);
      if (id !== null) rememberToast(state, id);
      if (attributes["data-type"] === "error") count += 1;
    }
  }
  if (Array.isArray(data.attributes)) {
    for (const change of data.attributes) {
      const entry = record(change);
      const id = finiteNumber(entry.id);
      if (id === null || !state.toastIds.includes(id)) continue;
      if (record(entry.attributes)["data-type"] === "error") count += 1;
    }
  }
  return count;
}

function trimFailures(state: ReplayFrictionDetectorState): void {
  const keys = Object.keys(state.failures);
  if (keys.length <= MAX_TRACKED_REQUEST_KEYS) return;
  keys
    .sort((a, b) => state.failures[a]!.at - state.failures[b]!.at)
    .slice(0, keys.length - MAX_TRACKED_REQUEST_KEYS)
    .forEach((key) => delete state.failures[key]);
}

export function detectReplayFriction(
  events: readonly unknown[],
  previous: ReplayFrictionDetectorState | null,
): {
  state: ReplayFrictionDetectorState;
  delta: ReplayFrictionDelta;
  errorThenLeave: boolean;
} {
  const state: ReplayFrictionDetectorState = previous
    ? structuredClone(previous)
    : emptyReplayFrictionDetectorState();
  const delta: ReplayFrictionDelta = {
    deadClicks: 0,
    rageClicks: 0,
    errorToasts: 0,
    retryLoops: 0,
    stalledRequests: 0,
    http4xx: 0,
    http5xx: 0,
    issueErrors: 0,
  };

  for (const raw of events) {
    const event = record(raw);
    const type = finiteNumber(event.type);
    const at = finiteNumber(event.timestamp);
    if (type === null || at === null) continue;
    const data = record(event.data);
    state.lastEventAt = Math.max(state.lastEventAt ?? at, at);
    if (countRageClick(state, event)) delta.rageClicks += 1;

    if (
      state.pendingClickAt !== null &&
      at - state.pendingClickAt > DEAD_CLICK_WINDOW_MS
    ) {
      delta.deadClicks += 1;
      state.pendingClickAt = null;
    }
    if (state.pendingClickAt !== null && answersClick(type, data)) {
      state.pendingClickAt = null;
    }

    if (type === RRWEB_INCREMENTAL_SNAPSHOT) {
      if (
        data.source === SOURCE_MOUSE_INTERACTION &&
        data.type === MOUSE_FOCUS
      ) {
        const id = finiteNumber(data.id);
        state.lastFocus = id === null ? null : { id, at };
      } else if (isClick(data)) {
        const id = finiteNumber(data.id);
        const focused =
          id !== null &&
          state.lastFocus?.id === id &&
          at - state.lastFocus.at <= FOCUS_ANSWERS_CLICK_MS;
        if (!focused && state.pendingClickAt === null) {
          state.pendingClickAt = at;
        }
      } else if (data.source === SOURCE_MUTATION) {
        const toasts = countErrorToasts(state, data);
        if (toasts > 0) {
          delta.errorToasts += toasts;
          state.lastErrorAt = at;
        }
      }
      continue;
    }

    if (type !== RRWEB_CUSTOM) continue;
    const payload = record(data.payload);
    if (data.tag === SESSION_REPLAY_CONSOLE_EVENT_TAG) {
      if (payload.level !== "error") continue;
      state.lastErrorAt = at;
      if (payload.source !== "console" || payload.exception !== false) {
        const repeat = finiteNumber(payload.repeat);
        delta.issueErrors +=
          repeat !== null && repeat >= 1 ? Math.floor(repeat) : 1;
      }
      continue;
    }
    if (data.tag !== SESSION_REPLAY_NETWORK_EVENT_TAG) continue;
    const status = finiteNumber(payload.status);
    if (isStalledRequest(payload.durationMs)) delta.stalledRequests += 1;
    if (status === null) continue;
    if (status >= 400 && status < 500) delta.http4xx += 1;
    if (status >= 500) delta.http5xx += 1;
    // Status 0 is also a real network failure, which still counts.
    if (status === 0 && isAbortedRequest(payload)) continue;
    if (status === 0 || status >= 500) state.lastErrorAt = at;

    const key = requestKey(payload.method, payload.url);
    if (status !== 0 && status < 400) {
      delete state.failures[key];
      continue;
    }
    const failure = state.failures[key];
    if (failure && at - failure.at <= RETRY_LOOP_WINDOW_MS) {
      failure.n += 1;
      failure.at = at;
    } else {
      state.failures[key] = { n: 1, at, counted: false };
    }
    const current = state.failures[key]!;
    if (current.n >= RETRY_LOOP_MIN_FAILURES && !current.counted) {
      current.counted = true;
      delta.retryLoops += 1;
    }
    trimFailures(state);
  }

  state.rageClickCount = (previous?.rageClickCount ?? 0) + delta.rageClicks;

  // The last event so far came soon after an error. That means the person
  // left only once the recording has ended; before that, it is just the
  // latest upload.
  const errorThenLeave =
    state.lastErrorAt !== null &&
    state.lastEventAt !== null &&
    state.lastEventAt - state.lastErrorAt <= ERROR_THEN_LEAVE_WINDOW_MS;
  return { state, delta, errorThenLeave };
}
