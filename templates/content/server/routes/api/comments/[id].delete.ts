import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { ForbiddenError } from "@agent-native/core/sharing";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import deleteComment from "../../../../actions/delete-comment.js";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthenticated" };
  }
  try {
    return await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      () =>
        deleteComment.run(
          { id },
          {
            caller: "http",
            actionName: "delete-comment",
            userEmail: session.email,
            orgId: session.orgId,
          },
        ),
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      setResponseStatus(event, 404);
      return { error: "Comment not found" };
    }
    throw error;
  }
});
