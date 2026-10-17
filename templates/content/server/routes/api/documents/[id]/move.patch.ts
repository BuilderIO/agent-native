import { ActionInputValidationError } from "@agent-native/core/action";
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
  try {
    return await runWithRequestContext(
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
  } catch (error) {
    // h3 sends a thrown error that isn't its own as a bare status, with no
    // message, so a refusal keeps its message and errorCode only this way.
    // The status is move-document's: 409 for a parent with another owner,
    // space or section, as duplicate-page and moves between spaces return.
    if (error instanceof ActionInputValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message });
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode !== "number" || statusCode < 400 || statusCode >= 500)
      throw error;
    const errorCode = (error as { errorCode?: unknown }).errorCode;
    throw createError({
      statusCode,
      statusMessage: (error as Error).message,
      ...(typeof errorCode === "string" ? { data: { errorCode } } : {}),
    });
  }
});
