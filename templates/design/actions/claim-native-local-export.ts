import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  NATIVE_LOCAL_EXPORT_RUNNING_MS,
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
    "Claim one pending native local export in the already-open editor after checking its live source version.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    documentId: z.string().uuid(),
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId, documentId }) => {
    const tabId = requireNativeLocalExportTabId();
    await assertNativeLocalExportEditor(designId);
    const currentRaw = await readNativeLocalExportState(designId, tabId);
    if (!currentRaw || currentRaw.requestId !== requestId)
      fail("The local export request was not found in this editor tab.", {
        errorCode: "native_export_request_not_found",
        statusCode: 404,
      });
    const current = await expireNativeLocalExportState(currentRaw);
    if (current.status !== "pending")
      fail("The local export request is no longer pending.", {
        errorCode: "native_export_request_not_pending",
        statusCode: 409,
      });
    const liveSource = await readNativeLocalExportVersion(
      designId,
      current.fileId,
      current.crop,
    );
    const key = nativeLocalExportStateKey(designId, tabId);
    if (liveSource.versionHash !== current.expectedVersionHash) {
      const stale: NativeLocalExportState = {
        ...current,
        status: "failed",
        failure: {
          code: "source-stale",
          message: "Design source changed before local export could start.",
        },
      };
      if (!(await compareAndSetAppState(key, current, stale)))
        fail("The local export request changed concurrently.", {
          errorCode: "native_export_request_conflict",
          statusCode: 409,
        });
      fail(stale.failure!.message, {
        errorCode: "native_export_source_stale",
        statusCode: 409,
      });
    }
    if (current.crop && liveSource.cropNodeCount !== 1)
      fail(
        "The selected native crop node is missing or ambiguous in the live source.",
        {
          errorCode: "native_export_crop_node_unavailable",
          statusCode: 422,
        },
      );
    const claimed: NativeLocalExportState = {
      ...current,
      status: "running",
      ownerDocumentId: documentId,
      expiresAt: Date.now() + NATIVE_LOCAL_EXPORT_RUNNING_MS,
    };
    if (!(await compareAndSetAppState(key, current, claimed)))
      fail("The local export request was claimed by another editor.", {
        errorCode: "native_export_request_conflict",
        statusCode: 409,
      });
    return claimed;
  },
});
