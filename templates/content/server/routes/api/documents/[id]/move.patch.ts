import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { createError, defineEventHandler, readBody } from "h3";

import moveDocument from "../../../../../actions/move-document.js";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const body = await readBody<{ parentId?: unknown; position?: unknown }>(
    event,
  );
  if (!body || (body.parentId === undefined && body.position === undefined)) {
    throw createError({
      statusCode: 400,
      statusMessage: "parentId or position is required",
    });
  }

  // A reparent has to hold move-document's page-tree and row locks, or a
  // concurrent move can close a cycle with it. `position` is move-document's
  // index among the page's siblings, which it renumbers, not a stored value.
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    () =>
      moveDocument.run(
        {
          id,
          parentId: body.parentId as string | null | undefined,
          position: body.position as number | undefined,
        },
        {
          caller: "http",
          userEmail: session.email,
          orgId: session.orgId,
          actionName: "move-document",
        },
      ),
  );
});
