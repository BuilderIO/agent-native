import { resolveAttachment } from "@agent-native/core/private-blob";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { createError, defineEventHandler, getQuery } from "h3";

import { readNativeLocalExportState } from "../../../actions/_native-local-export-server.js";
import { nativeRenderContextSchema } from "../../../shared/native-local-export.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email)
    throw createError({ statusCode: 401, statusMessage: "Session required" });
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const query = getQuery(event);
      const { designId, requestId, tabId } = query;
      if (
        typeof designId !== "string" ||
        typeof requestId !== "string" ||
        typeof tabId !== "string"
      )
        throw createError({
          statusCode: 400,
          statusMessage: "Native PNG reference is invalid",
        });
      if (
        designId.length < 1 ||
        designId.length > 128 ||
        !/^[0-9a-f-]{36}$/i.test(requestId) ||
        !nativeRenderContextSchema.shape.tabId.safeParse(tabId).success
      )
        throw createError({
          statusCode: 400,
          statusMessage: "Native PNG reference is invalid",
        });
      await assertAccess("design", designId, "viewer");
      const state = await readNativeLocalExportState(designId, tabId);
      if (
        !state ||
        state.requestId !== requestId ||
        state.status !== "completed" ||
        !state.attachmentRef
      )
        throw createError({
          statusCode: 404,
          statusMessage: "Completed native PNG was not found",
        });
      const opened = await resolveAttachment(state.attachmentRef, {
        ownerEmail: session.email,
        orgId: null,
      });
      if (opened.status !== "ok")
        throw createError({
          statusCode: opened.status === "forbiddenScope" ? 403 : 503,
          statusMessage: "Native PNG attachment is unavailable",
        });
      if (
        opened.file.filename !== `native-export-${requestId}.png` ||
        opened.file.mimeType !== "image/png"
      )
        throw createError({
          statusCode: 422,
          statusMessage: "Native PNG attachment is invalid",
        });
      return new Response(new Blob([new Uint8Array(opened.file.data)]), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="native-export-${requestId}.png"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
});
