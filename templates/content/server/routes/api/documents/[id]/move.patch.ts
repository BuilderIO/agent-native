import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import { createError, defineEventHandler, getRouterParam } from "h3";

import moveDocument from "../../../../../actions/move-document.js";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "id required" });
  }
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const body = (await readBody(event)) as {
    parentId?: string | null;
    position?: number;
  };
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    () =>
      moveDocument.run(
        { id, parentId: body.parentId, position: body.position },
        {
          caller: "http",
          actionName: "move-document",
          userEmail: session.email,
          orgId: session.orgId,
        },
      ),
  );
});
