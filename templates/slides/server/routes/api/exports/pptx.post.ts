import path from "path";
import { Readable } from "node:stream";
import { defineEventHandler, setResponseStatus } from "h3";
import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import exportPptxAction from "../../../../actions/export-pptx.js";

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
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

    event.node.res.setHeader("Content-Type", PPTX_CONTENT_TYPE);
    event.node.res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(result.filename)}"`,
    );

    // Stream directly from the in-memory buffer. Going through disk used to
    // break on serverless: the action wrote into a per-invocation /tmp that a
    // separate download request couldn't reach. Skipping the disk hop also
    // halves the I/O.
    return Readable.toWeb(
      Readable.from(result.buffer),
    ) as unknown as ReadableStream;
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
