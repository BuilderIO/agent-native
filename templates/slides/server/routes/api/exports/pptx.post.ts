import path from "path";

import { readBody, runWithRequestContext } from "@agent-native/core/server";
import { defineEventHandler, setResponseStatus } from "h3";

import exportPptxAction from "../../../../actions/export-pptx.js";
import { resolveSlidesRequestAuth } from "../../../handlers/request-auth-context.js";

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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

  const body = (await readBody(event)) as {
    deckId?: string;
    includeNotes?: boolean;
  };

  if (!body?.deckId) {
    setResponseStatus(event, 400);
    return { error: "deckId required" };
  }

  const deckId = body.deckId;
  const includeNotes = body.includeNotes ?? true;

  try {
    const result = await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      () =>
        exportPptxAction.run({
          deckId,
          includeNotes,
        }),
    );

    const bytes = new Uint8Array(result.buffer);
    const responseBody = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );

    return new Response(responseBody, {
      headers: {
        "Content-Type": PPTX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${path.basename(
          result.filename,
        )}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong exporting as PPTX.";
    setResponseStatus(event, message.startsWith("Deck not found") ? 404 : 500);
    return {
      error: message,
    };
  }
});
