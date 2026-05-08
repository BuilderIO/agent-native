import { createEventStream, defineEventHandler, setResponseStatus } from "h3";
import { getSession } from "./auth.js";
import {
  canSeeChangeForUser,
  getPollEmitter,
  POLL_CHANGE_EVENT,
  type ChangeEvent,
} from "./poll.js";

/**
 * Stream in-process poll events over SSE.
 *
 * This is the fast path for agent/tool/action writes that happen in the same
 * server process. The regular /poll endpoint remains the cross-process and
 * serverless cold-start fallback because it can detect DB timestamp changes
 * even when the write happened somewhere this EventEmitter could not see.
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

    const push = (change: ChangeEvent) => {
      if (closed) return;
      if (!canSeeChangeForUser(change, session.email, session.orgId)) return;
      try {
        stream.push(JSON.stringify(change));
      } catch {
        // EventSource will reconnect; /poll catches anything missed.
      }
    };

    getPollEmitter().on(POLL_CHANGE_EVENT, push);

    stream.onClosed(() => {
      closed = true;
      getPollEmitter().off(POLL_CHANGE_EVENT, push);
    });

    return stream.send();
  });
}
