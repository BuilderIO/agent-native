import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  nativeLocalExportFailureCodeSchema,
  nativeLocalExportStateKey,
  type NativeLocalExportState,
} from "../shared/native-local-export.js";
import {
  expireNativeLocalExportState,
  readNativeLocalExportState,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";

export default defineAction({
  agentTool: false,
  description:
    "Report whether a claimed native local export initiated a browser download or failed. This never claims that the browser saved a file.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    documentId: z.string().uuid(),
    result: z.discriminatedUnion("status", [
      z.object({ status: z.literal("download-initiated") }).strict(),
      z
        .object({
          status: z.literal("failed"),
          code: nativeLocalExportFailureCodeSchema,
          message: z.string().min(1).max(300),
        })
        .strict(),
    ]),
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId, documentId, result }) => {
    const tabId = requireNativeLocalExportTabId();
    await assertAccess("design", designId, "viewer");
    const currentRaw = await readNativeLocalExportState(designId, tabId);
    if (!currentRaw || currentRaw.requestId !== requestId)
      fail("The local export request was not found in this editor tab.", {
        errorCode: "native_export_request_not_found",
        statusCode: 404,
      });
    const current = await expireNativeLocalExportState(currentRaw);
    if (current.ownerDocumentId !== documentId)
      fail("This editor document no longer owns the local export.", {
        errorCode: "native_export_document_replaced",
        statusCode: 409,
      });
    if (current.status !== "running" && current.status !== "cancel-requested")
      fail("The local export request is not running.", {
        errorCode: "native_export_request_not_running",
        statusCode: 409,
      });
    const completed: NativeLocalExportState = {
      ...current,
      status:
        result.status === "failed" && result.code === "canceled"
          ? "canceled"
          : result.status,
      ...(result.status === "failed"
        ? { failure: { code: result.code, message: result.message } }
        : {}),
    };
    if (
      !(await compareAndSetAppState(
        nativeLocalExportStateKey(designId, tabId),
        current,
        completed,
      ))
    )
      fail("The local export request changed before its result was recorded.", {
        errorCode: "native_export_request_conflict",
        statusCode: 409,
      });
    return {
      requestId,
      designId,
      fileId: completed.fileId,
      status: completed.status,
      ...(completed.failure ? { failure: completed.failure } : {}),
      localOnly: true,
    };
  },
});
