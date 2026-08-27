import { readBody, runWithRequestContext } from "@agent-native/core/server";
import { defineEventHandler, setResponseStatus } from "h3";

import exportHtmlAction from "../../../../actions/export-html.js";
import { resolveSlidesRequestAuth } from "../../../handlers/request-auth-context.js";

export default defineEventHandler(async (event) => {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  const session = auth.context;
  if (!session.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const body = (await readBody(event)) as { deckId?: string };

  if (!body?.deckId) {
    setResponseStatus(event, 400);
    return { error: "deckId required" };
  }

  try {
    const result = await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      () => exportHtmlAction.run({ deckId: body.deckId! }),
    );

    return Response.redirect(result.downloadUrl, 302);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong exporting as HTML.";
    setResponseStatus(event, message.startsWith("Deck not found") ? 404 : 500);
    return {
      error: message,
    };
  }
});
