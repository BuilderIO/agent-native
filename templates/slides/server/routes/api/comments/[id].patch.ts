import { readBody } from "@agent-native/core/server";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { ForbiddenError } from "@agent-native/core/sharing";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import updateSlideCommentAction from "../../../../actions/update-slide-comment.js";

/**
 * PATCH /api/comments/:id
 * Update a slide comment (resolve, reopen, edit content). Delegates to the
 * update-slide-comment action so the human UI and the agent share one
 * implementation and one permission rule.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }

  const body = await readBody(event);
  const { resolved, content } = body as {
    resolved?: boolean;
    content?: string;
  };

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  try {
    return await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      () => updateSlideCommentAction.run({ id, resolved, content }),
    );
  } catch (err) {
    // Not-found and forbidden both surface as 404 so callers can't probe for
    // the existence of comments on decks they can't access. Any other error
    // (e.g. a DB failure) propagates as a real 500.
    const isNotFound =
      err instanceof Error && err.message.startsWith("Comment not found");
    if (err instanceof ForbiddenError || isNotFound) {
      setResponseStatus(event, 404);
      return { error: "Comment not found" };
    }
    throw err;
  }
});
