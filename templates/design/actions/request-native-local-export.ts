import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";

import { parseEffectsFromHtml } from "../shared/native-effects.js";
import {
  NATIVE_LOCAL_EXPORT_PENDING_MS,
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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Request a PNG of the current native Design frame in a live editor tab, with an optional bounded world-coordinate crop. Requires an exact source version. External callers first discover a live targetTabId with get-native-render-contexts. Poll get-native-local-export for a typed status. Completed returns a protected owner-scoped PNG artifact; pending or download initiation does not.",
  schema: nativeLocalExportRequestSchema.extend({
    targetTabId: nativeRenderContextSchema.shape.tabId
      .optional()
      .describe(
        "Live tab ID returned by get-native-render-contexts for an external caller; omit inside the editor tab.",
      ),
  }),
  http: { method: "POST" },
  run: async ({ targetTabId, ...args }) => {
    const tabId = targetTabId
      ? await resolveNativeRenderContextTarget(args.designId, targetTabId)
      : requireNativeLocalExportTabId();
    if (!targetTabId) await assertNativeLocalExportEditor(args.designId);
    const liveSource = await readNativeLocalExportVersion(
      args.designId,
      args.fileId,
    );
    const parsed = parseEffectsFromHtml(liveSource.content);
    if (
      parsed.errors.length ||
      !parsed.document?.instances.some((instance) => instance.enabled)
    )
      fail("The selected scene has no readable enabled native effects.", {
        errorCode: "native_export_manifest_unreadable",
        statusCode: 422,
      });
    if (liveSource.versionHash !== args.expectedVersionHash)
      fail("Design source changed before the local export request.", {
        errorCode: "native_export_source_stale",
        statusCode: 409,
      });
    const key = nativeLocalExportStateKey(args.designId, tabId);
    const rawCurrent = await readNativeLocalExportState(args.designId, tabId);
    const current = rawCurrent
      ? await expireNativeLocalExportState(rawCurrent)
      : null;
    if (
      current?.status === "pending" ||
      current?.status === "running" ||
      current?.status === "uploading" ||
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
