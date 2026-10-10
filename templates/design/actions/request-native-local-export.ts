import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";

import {
  NATIVE_LOCAL_EXPORT_PENDING_MS,
  nativeLocalExportCropMatchesOptions,
  nativeLocalExportRequestSchema,
  nativeRenderContextSchema,
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
import { resolveNativeRenderContextTarget } from "./_native-render-contexts.js";

export default defineAction({
  description:
    "Request a local PNG, JPEG, WebP, AVIF, MP4, hybrid SVG/PDF, captured standalone HTML, or React code ZIP download of one selected native Design HTML scene. Optional crop selects one unique authored node by exact source-space bounds and requires a matching export viewport; cropped raster/MP4 additionally require the full authored sourceViewport, omitted for SVG/PDF/HTML/ZIP; selected HTML/ZIP retain only that subtree and reject effects depending on content outside it. Raster formats require browser encoder support. For an external caller, first use get-native-render-contexts and pass its live targetTabId; an in-tab caller uses its current tab by default. Requires the exact live source version. Use get-native-local-export for status; no rendered bytes or cloud URL are returned.",
  schema: nativeLocalExportRequestSchema.extend({
    targetTabId: nativeRenderContextSchema.shape.tabId
      .optional()
      .describe(
        "Live tab ID returned by get-native-render-contexts for an external caller; omit inside the editor tab.",
      ),
  }),
  http: { method: "POST" },
  run: async ({ targetTabId, ...args }) => {
    if (
      !nativeLocalExportCropMatchesOptions(
        args.crop,
        args.export,
        args.sourceViewport,
      )
    )
      fail(
        "The local export crop is unsupported for this format or viewport.",
        {
          errorCode: "native_export_crop_unsupported",
          statusCode: 422,
        },
      );
    const tabId = targetTabId
      ? await resolveNativeRenderContextTarget(args.designId, targetTabId)
      : requireNativeLocalExportTabId();
    if (!targetTabId) await assertNativeLocalExportEditor(args.designId);
    const liveSource = await readNativeLocalExportVersion(
      args.designId,
      args.fileId,
      args.crop,
    );
    if (liveSource.versionHash !== args.expectedVersionHash)
      fail("Design source changed before the local export request.", {
        errorCode: "native_export_source_stale",
        statusCode: 409,
      });
    if (args.crop && liveSource.cropNodeCount !== 1)
      fail(
        "The selected native crop node is missing or ambiguous in the live source.",
        {
          errorCode: "native_export_crop_node_unavailable",
          statusCode: 422,
        },
      );
    const key = nativeLocalExportStateKey(args.designId, tabId);
    const rawCurrent = await readNativeLocalExportState(args.designId, tabId);
    const current = rawCurrent
      ? await expireNativeLocalExportState(rawCurrent)
      : null;
    if (
      current?.status === "pending" ||
      current?.status === "running" ||
      current?.status === "cancel-requested"
    )
      fail("A local Design export is already active in this browser tab.", {
        errorCode: "native_export_busy",
        statusCode: 409,
      });
    const now = Date.now();
    const request: NativeLocalExportState = {
      ...args,
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      tabId,
      status: "pending",
      issuedAt: now,
      expiresAt: now + NATIVE_LOCAL_EXPORT_PENDING_MS,
    };
    if (!(await compareAndSetAppState(key, current, request)))
      fail("The local export request changed concurrently. Retry.", {
        errorCode: "native_export_request_conflict",
        statusCode: 409,
      });
    return {
      requestId: request.requestId,
      designId: args.designId,
      fileId: args.fileId,
      status: request.status,
      expiresAt: request.expiresAt,
      localOnly: true,
    };
  },
});
