import path from "path";
import { defineEventHandler, setResponseStatus } from "h3";
import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import exportHtmlAction from "../../../../actions/export-html.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
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

    event.node.res.setHeader("Content-Type", "text/html; charset=utf-8");
    event.node.res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(result.filename)}"`,
    );

    // Return the in-memory HTML string directly. Writing to disk first
    // would break on serverless: a separate /api/exports/:filename GET
    // would hit a different Lambda's empty filesystem and 404 with
    // "file doesn't exist on site".
    return result.html;
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
