import path from "path";

import { isActionContractError } from "@agent-native/core";
import { readBody, runWithRequestContext } from "@agent-native/core/server";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";

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

    if ("error" in result) {
      setResponseStatus(event, 400);
      return { error: result.error };
    }

    setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
    setResponseHeader(event, "Cache-Control", "no-store");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    setResponseHeader(
      event,
      "Content-Disposition",
      `attachment; filename="${path.basename(result.filename)}"`,
    );

    return result.html;
  } catch (error) {
    if (isActionContractError(error)) {
      setResponseStatus(event, error.statusCode);
      return {
        error: error.message,
        errorCode: error.errorCode,
      };
    }
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
