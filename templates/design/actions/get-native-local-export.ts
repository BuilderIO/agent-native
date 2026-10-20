import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { nativeRenderContextSchema } from "../shared/native-local-export.js";
import {
  expireNativeLocalExportState,
  markNativeLocalExportEditorLeft,
  readNativeLocalExportState,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Read a local native Design PNG request status. An editor tab may omit requestId to discover its pending request; external callers must provide requestId and targetTabId. Pending, running, uploading, failed, expired, download-initiated, and completed are distinct. Completed returns a protected same-origin PNG URL; pending or download initiation is not an agent artifact.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid().optional(),
    targetTabId: nativeRenderContextSchema.shape.tabId
      .optional()
      .describe(
        "Tab ID used for the request; omit when calling from that browser tab.",
      ),
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId, targetTabId }) => {
    const tabId = targetTabId ?? requireNativeLocalExportTabId();
    if (targetTabId && !requestId)
      fail("External status reads require the exact request ID.", {
        errorCode: "native_export_request_id_required",
        statusCode: 422,
      });
    await assertAccess("design", designId, "viewer");
    const raw = await readNativeLocalExportState(designId, tabId);
    if (!raw || (requestId !== undefined && raw.requestId !== requestId))
      fail("The local export request was not found in this browser tab.", {
        errorCode: "native_export_request_not_found",
        statusCode: 404,
      });
    const current = await expireNativeLocalExportState(
      await markNativeLocalExportEditorLeft(raw),
    );
    return {
      requestId: current.requestId,
      designId: current.designId,
      fileId: current.fileId,
      status: current.status,
      expiresAt: current.expiresAt,
      ...(current.failure ? { failure: current.failure } : {}),
      ...(current.status === "completed" && current.attachmentRef
        ? {
            attachmentRef: current.attachmentRef,
            bytes: current.attachmentBytes,
            mimeType: "image/png" as const,
            url: `/api/native-png-attachment?designId=${encodeURIComponent(designId)}&requestId=${encodeURIComponent(current.requestId)}&tabId=${encodeURIComponent(tabId)}`,
          }
        : {}),
      localOnly: true,
    };
  },
});
