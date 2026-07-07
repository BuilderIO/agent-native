import { createEventStream, defineEventHandler, setResponseStatus } from "h3";

import {
  getAwarenessEmitter,
  AWARENESS_CHANGE_EVENT,
  type AwarenessChangeEvent,
} from "../collab/awareness.js";
import { getSession } from "./auth.js";
import {
  canSeeChangeForUser,
  getPollEmitter,
  POLL_CHANGE_EVENT,
  type ChangeEvent,
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

/**
 * Stream in-process poll events over SSE.
 *
 * This is the fast path for agent/tool/action writes that happen in the same
 * server process. The regular /poll endpoint remains the cross-process and
 * serverless cold-start fallback because it can detect DB timestamp changes
 * even when the write happened somewhere this EventEmitter could not see.
 *
 * Also forwards awareness change events (cursor/presence updates) so
 * connected peers receive cursor moves push-style instead of waiting for
 * the next poll cycle. Polling fallback keeps working — cursors degrade
 * gracefully to poll cadence without SSE.
 */
export function createPollEventsHandler() {
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
        stream.push(data);
      } catch {
        // EventSource will reconnect; /poll catches anything missed.
      }
    };

    const push = (change: ChangeEvent) => {
      if (closed) return;
      if (!canSeeChangeForUser(change, session.email, session.orgId)) return;
      safePush(JSON.stringify(change));
    };

    // Awareness fast-path: forward cursor/presence events immediately.
    // No ring-buffer needed — clients reconcile on the next poll if SSE is down.
    const pushAwareness = (change: AwarenessChangeEvent) => {
      if (closed) return;
      if (!canSeeAwarenessChangeForUser(change, session.email, session.orgId)) {
        return;
      }
      safePush(JSON.stringify(change));
    };

    getPollEmitter().on(POLL_CHANGE_EVENT, push);
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, pushAwareness);

    stream.onClosed(() => {
      closed = true;
      getPollEmitter().off(POLL_CHANGE_EVENT, push);
      getAwarenessEmitter().off(AWARENESS_CHANGE_EVENT, pushAwareness);
    });

    return stream.send();
  });
}
