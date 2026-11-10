import { createError, type H3Event } from "h3";

import {
  type CallProvenance,
  isAgentTextLockRefusal,
} from "../../actions/_document-agent-lock.js";

/**
 * A plain route has no action context. As on an action's route, the browser
 * signs in with a cookie, so a token on the request means an outside caller.
 * h3 sends a thrown error that isn't its own as a bare 500, so the lock's
 * refusal keeps its status, message and errorCode only this way.
 */
export async function runAsRouteCaller<T>(
  event: Pick<H3Event, "headers">,
  run: (ctx: CallProvenance) => Promise<T>,
): Promise<T> {
  try {
    return await run({ caller: "frontend", requestHeaders: event.headers });
  } catch (error) {
    if (!isAgentTextLockRefusal(error)) throw error;
    throw createError({
      statusCode: 403,
      statusMessage: error.message,
      data: { errorCode: error.errorCode },
    });
  }
}
