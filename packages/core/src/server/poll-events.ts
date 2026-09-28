import { createEventStream, defineEventHandler, setResponseStatus } from "h3";

import {
  getAwarenessEmitter,
  AWARENESS_CHANGE_EVENT,
  type AwarenessChangeEvent,
} from "../collab/awareness.js";
import { getSession } from "./auth.js";
import {
  type AppSyncState,
  canSeeChangeForUser,
  type ChangeEvent,
  getDefaultAppSyncState,
  POLL_CHANGE_EVENT,
} from "./poll.js";

export function canSeeAwarenessChangeForUser(
  change: Pick<
    AwarenessChangeEvent,
    "owner" | "orgId" | "resourceType" | "resourceId"
  >,
  userEmail: string,
  orgId: string | undefined,
): boolean {
  if (!change.owner && !change.orgId && !change.resourceType) return false;
  return canSeeChangeForUser(change, userEmail, orgId);
}

export interface PollEventsHandlerOptions {
  maxDurationMs?: number;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

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

    const stream = createEventStream(event);
    let closed = false;

    const safePush = (data: string) => {
      if (closed) return;
      try {
        void stream.push(data);
      } catch {
        // EventSource will reconnect; /poll catches anything missed.
      }
    };

    const push = (change: ChangeEvent) => {
      if (closed) return;
      if (!state.canSeeChangeForUser(change, session.email, session.orgId)) {
        return;
      }
      safePush(JSON.stringify(change));
    };

    const pushHeartbeat = () => {
      if (closed) return;
      void stream.push({ event: "heartbeat", data: "" });
    };

    const pushAwareness = (change: AwarenessChangeEvent) => {
      if (closed) return;
      if (!canSeeAwarenessChangeForUser(change, session.email, session.orgId)) {
        return;
      }
      safePush(JSON.stringify(change));
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
