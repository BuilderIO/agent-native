import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import { ForbiddenError } from "@agent-native/core/sharing";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import updateComment from "../../../../actions/update-comment.js";

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
  const body = (await readBody(event)) as {
    content?: string;
    resolved?: boolean;
  };
  try {
    return await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      () =>
        updateComment.run(
          { id, content: body.content, resolved: body.resolved },
          {
            caller: "http",
            actionName: "update-comment",
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
