import { createEventStream, defineEventHandler, setResponseStatus } from "h3";

import {
  getAwarenessEmitter,
  AWARENESS_CHANGE_EVENT,
  type AwarenessChangeEvent,
} from "../collab/awareness.js";
import type { ChangeVisibilityDelivery } from "../observability/metrics.js";
import { getSession } from "./auth.js";
import {
  type AppSyncState,
  type ChangeEvent,
  type ChangeViewer,
  type ChangeVisibilityDecision,
  getDefaultAppSyncState,
  POLL_CHANGE_EVENT,
} from "./poll.js";

type AwarenessScope = Pick<
  AwarenessChangeEvent,
  "owner" | "orgId" | "resourceType" | "resourceId"
>;

/**
 * Awareness is presence, never deployment-wide: an event with no owner, org,
 * or resource reaches nobody.
 */
export async function resolveAwarenessVisibilityForUser(
  change: AwarenessScope,
  viewer: ChangeViewer,
  state: AppSyncState = getDefaultAppSyncState(),
  timeoutMs?: number,
): Promise<ChangeVisibilityDecision> {
  if (!change.owner && !change.orgId && !change.resourceType) return "hidden";
  return state.resolveChangeVisibilityForUser(change, viewer, {
    delivery: "awareness",
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

export interface PollEventsHandlerOptions {
  maxDurationMs?: number;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const ACCESS_CHECK_WAIT_MS = 10_000;
// Every collaborator on a resource whose check stalls is handed back to
// polling at once; spread their reconnects instead of letting them arrive
// together.
const UNDETERMINED_RECONNECT_BASE_MS = 1_000;
const UNDETERMINED_RECONNECT_SPREAD_MS = 4_000;

export function validateSseMaxDurationMs(
  value: unknown,
  name = "maxDurationMs",
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `${name} must be a positive finite number of milliseconds no greater than ${MAX_TIMER_DELAY_MS}; received ${typeof value === "number" ? value : JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Delivers events in arrival order, each only once its visibility is decided.
 * An event whose access check is still running is held, and every later event
 * queues behind it: the client's cursor only moves forward, so an event
 * delivered after a newer one is discarded as already seen, and a presence
 * update delivered late would overwrite a newer one.
 */
function createOrderedVisibilityGate<
  T extends ChangeEvent | AwarenessChangeEvent,
>({
  decide,
  peek,
  onVisible,
  onUndetermined,
  isClosed,
}: {
  decide: (change: T) => Promise<ChangeVisibilityDecision>;
  peek: (change: T) => ChangeVisibilityDecision | "pending";
  onVisible: (change: T) => void;
  onUndetermined: (change: T) => void;
  isClosed: () => boolean;
}): (change: T) => void {
  let held: Promise<void> | null = null;

  const apply = (change: T, decision: ChangeVisibilityDecision) => {
    if (isClosed()) return;
    if (decision === "visible") onVisible(change);
    else if (decision === "undetermined") onUndetermined(change);
  };

  return (change: T) => {
    if (isClosed()) return;
    if (!held) {
      const known = peek(change);
      if (known !== "pending") {
        apply(change, known);
        return;
      }
    }
    const tail: Promise<void> = (held ?? Promise.resolve())
      .then(async () => {
        if (isClosed()) return;
        apply(change, await decide(change));
      })
      // A resolver that throws is already cached as a denial by AppSyncState;
      // this only keeps one failed event from wedging the queue behind it.
      .catch(() => {})
      .finally(() => {
        if (held === tail) held = null;
      });
    held = tail;
  };
}

export function createPollEventsHandler(
  state: AppSyncState = getDefaultAppSyncState(),
  options: PollEventsHandlerOptions = {},
) {
  const maxDurationMs = validateSseMaxDurationMs(options.maxDurationMs);

  return defineEventHandler(async (event) => {
    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Unauthenticated" };
    }
    const viewer: ChangeViewer = {
      email: session.email,
      orgId: session.orgId,
    };

    const stream = createEventStream(event);
    let closed = false;
    const isClosed = () => closed;

    const safePush = (data: string) => {
      if (closed) return;
      try {
        void stream.push(data);
      } catch {
        // EventSource will reconnect; /poll catches anything missed.
      }
    };

    const peek = (change: ChangeEvent | AwarenessScope) =>
      state.getChangeVisibilityForUser(change, viewer.email, viewer.orgId);

    const decideChange = (
      change: ChangeEvent | AwarenessScope,
      delivery: ChangeVisibilityDelivery,
    ) =>
      state.resolveChangeVisibilityForUser(change, viewer, {
        timeoutMs: ACCESS_CHECK_WAIT_MS,
        delivery,
      });

    const handBackToPolling = () => {
      if (closed) return;
      closed = true;
      try {
        void stream.push({
          event: "reconnect",
          data: "",
          retry:
            UNDETERMINED_RECONNECT_BASE_MS +
            Math.round(Math.random() * UNDETERMINED_RECONNECT_SPREAD_MS),
        });
        // coercion-ok: a lost hint only means the browser's default retry; the close still hands the client back to its cursor read
      } catch {}
      void stream.close();
    };

    const push = createOrderedVisibilityGate<ChangeEvent>({
      peek,
      decide: (change) => decideChange(change, "sse"),
      onVisible: (change) => safePush(JSON.stringify(change)),
      // The reconnecting client polls from its last delivered cursor, which
      // stops before this event.
      onUndetermined: handBackToPolling,
      isClosed,
    });

    const pushAwareness = createOrderedVisibilityGate<AwarenessChangeEvent>({
      peek: (change) =>
        !change.owner && !change.orgId && !change.resourceType
          ? "hidden"
          : peek(change),
      decide: (change) =>
        resolveAwarenessVisibilityForUser(
          change,
          viewer,
          state,
          ACCESS_CHECK_WAIT_MS,
        ),
      onVisible: (change) => safePush(JSON.stringify(change)),
      // Presence is ephemeral and has no cursor to resume from; the next
      // heartbeat from that peer replaces this one.
      onUndetermined: () => {},
      isClosed,
    });

    const pushHeartbeat = () => {
      if (closed) return;
      void stream.push({ event: "heartbeat", data: "" });
    };

    state.getPollEmitter().on(POLL_CHANGE_EVENT, push);
    const forwardAwareness = state === getDefaultAppSyncState();
    if (forwardAwareness) {
      getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, pushAwareness);
    }

    pushHeartbeat();
    const heartbeatTimer = setInterval(pushHeartbeat, 10_000);
    const lifespanTimer = maxDurationMs
      ? setTimeout(() => {
          closed = true;
          void stream.close();
        }, maxDurationMs)
      : undefined;

    stream.onClosed(() => {
      closed = true;
      clearInterval(heartbeatTimer);
      if (lifespanTimer) clearTimeout(lifespanTimer);
      state.getPollEmitter().off(POLL_CHANGE_EVENT, push);
      if (forwardAwareness) {
        getAwarenessEmitter().off(AWARENESS_CHANGE_EVENT, pushAwareness);
      }
    });

    return stream.send();
  });
}
