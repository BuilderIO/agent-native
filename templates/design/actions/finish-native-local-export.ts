import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { resolveAttachment } from "@agent-native/core/private-blob";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { pngDimensions } from "../server/lib/png-dimensions.js";
import { planNativeExportRegion } from "../shared/native-export-region.js";
import {
  nativeLocalExportFailureCodeSchema,
  nativeLocalExportStateKey,
  type NativeLocalExportState,
} from "../shared/native-local-export.js";
import {
  assertNativeLocalExportEditor,
  expireNativeLocalExportState,
  readNativeLocalExportState,
  readNativeLocalExportVersion,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";

export default defineAction({
  agentTool: false,
  description:
    "Complete a claimed native PNG with a validated owner-scoped attachment reference, or report a typed failure. A pending or locally initiated download is not an agent artifact.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    documentId: z.string().uuid(),
    result: z.discriminatedUnion("status", [
      z.object({ status: z.literal("download-initiated") }).strict(),
      z
        .object({
          status: z.literal("completed"),
          attachmentRef: z.string().min(1).max(4096),
        })
        .strict(),
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
    await assertNativeLocalExportEditor(designId);
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
    let verifiedBytes: number | undefined;
    if (result.status === "completed") {
      if (current.status !== "running")
        fail("A canceled export cannot publish an attachment.", {
          errorCode: "native_export_request_not_running",
          statusCode: 409,
        });
      if (current.attachmentRef !== result.attachmentRef)
        fail("This PNG attachment was not uploaded for the claimed request.", {
          errorCode: "native_export_attachment_mismatch",
          statusCode: 409,
        });
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail)
        fail("The PNG attachment owner is unavailable.", {
          errorCode: "native_export_owner_unavailable",
          statusCode: 401,
        });
      const resolved = await resolveAttachment(result.attachmentRef, {
        ownerEmail,
        orgId: null,
      });
      if (resolved.status !== "ok")
        fail("The PNG attachment could not be verified for this owner.", {
          errorCode: "native_export_attachment_unavailable",
          statusCode: 422,
        });
      if (
        resolved.file.filename !== `native-export-${requestId}.png` ||
        resolved.file.mimeType !== "image/png" ||
        resolved.file.size > 40 * 1024 * 1024
      )
        fail("The PNG attachment does not match this export request.", {
          errorCode: "native_export_attachment_mismatch",
          statusCode: 422,
        });
      const dimensions = pngDimensions(resolved.file.data, {
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      const output = planNativeExportRegion(current.export);
      if (
        !output.ok ||
        !dimensions ||
        dimensions.width !== output.width ||
        dimensions.height !== output.height
      )
        fail(
          "The PNG attachment dimensions do not match this export request.",
          { errorCode: "native_export_attachment_mismatch", statusCode: 422 },
        );
      const live = await readNativeLocalExportVersion(designId, current.fileId);
      if (live.versionHash !== current.expectedVersionHash)
        fail("Design source changed before the PNG attachment was committed.", {
          errorCode: "native_export_source_stale",
          statusCode: 409,
        });
      verifiedBytes = resolved.file.size;
    }
    const completed: NativeLocalExportState = {
      ...current,
      status:
        result.status === "failed" && result.code === "canceled"
          ? "canceled"
          : result.status,
      ...(result.status === "completed"
        ? {
            attachmentRef: result.attachmentRef,
            attachmentBytes: verifiedBytes,
          }
        : {}),
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
      ...(completed.attachmentRef
        ? {
            attachmentRef: completed.attachmentRef,
            bytes: completed.attachmentBytes,
          }
        : {}),
      localOnly: true,
    };
  },
});
