import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  nativeLocalExportStateKey,
  nativeRenderContextSchema,
  type NativeLocalExportState,
} from "../shared/native-local-export.js";
import {
  expireNativeLocalExportState,
  readNativeLocalExportState,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";

export default defineAction({
  description:
    "Cancel a pending local native Design PNG or MP4 export, or request cancellation of an active foreground export. Pass the discovered targetTabId for an external request; in-tab callers default to their current tab. A download already initiated remains reported as download-initiated.",
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
    const current = await expireNativeLocalExportState(raw);
    if (current.status !== "pending" && current.status !== "running")
      return {
        requestId,
        status: current.status,
        cancelRequested: current.status === "cancel-requested",
        localOnly: true,
      };
    const canceled: NativeLocalExportState =
      current.status === "pending"
        ? {
            ...current,
            status: "canceled",
            failure: {
              code: "canceled",
              message: "Local export was canceled.",
            },
          }
        : { ...current, status: "cancel-requested" };
    if (
      !(await compareAndSetAppState(
        nativeLocalExportStateKey(designId, tabId),
        current,
        canceled,
      ))
    )
      fail("The local export request changed concurrently. Check its status.", {
        errorCode: "native_export_request_conflict",
        statusCode: 409,
      });
    return {
      requestId,
      status: canceled.status,
      cancelRequested: canceled.status === "cancel-requested",
      localOnly: true,
    };
  },
});
