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
  description:
    "Read a local native Design PNG or MP4 export status by request ID. Pass the discovered targetTabId for an external request; in-tab callers default to their current tab. Pending, running, failed, expired, and download-initiated are distinct. No image/video bytes or cloud URL are returned.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    targetTabId: nativeRenderContextSchema.shape.tabId
      .optional()
      .describe(
        "Tab ID used for the request; omit when calling from that browser tab.",
      ),
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId, targetTabId }) => {
    const tabId = targetTabId ?? requireNativeLocalExportTabId();
    await assertAccess("design", designId, "viewer");
    const raw = await readNativeLocalExportState(designId, tabId);
    if (!raw || raw.requestId !== requestId)
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
      localOnly: true,
    };
  },
});
