import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetManyAppState } from "@agent-native/core/application-state";

import { parseEffectsFromHtml } from "../shared/native-effects.js";
import {
  NATIVE_LOCAL_EXPORT_PENDING_MS,
  NATIVE_RENDER_CONTEXT_LEDGER_KEY,
  nativeLocalExportRevisionKey,
  nativeLocalExportRequestSchema,
  nativeRenderContextSchema,
  nativeLocalExportStateKey,
  type NativeLocalExportState,
} from "../shared/native-local-export.js";
import {
  assertNativeLocalExportEditor,
  expireNativeLocalExportState,
  readNativeLocalExportState,
  readNativeLocalExportRevision,
  readNativeLocalExportVersion,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";
import { readNativeRenderContextSnapshot } from "./_native-render-contexts.js";

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
    const tabId = targetTabId ?? requireNativeLocalExportTabId();
    if (!targetTabId) await assertNativeLocalExportEditor(args.designId);
    const snapshot = await readNativeRenderContextSnapshot(
      args.designId,
      tabId,
    );
    const context = snapshot.contexts.find((entry) => entry.tabId === tabId);
    if (targetTabId && !context)
      fail("No live matching Design editor context was found.", {
        errorCode: "native_export_context_not_found",
        statusCode: 404,
      });
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
    const revision = await readNativeLocalExportRevision(args.designId, tabId);
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
      ...(context?.documentId ? { targetDocumentId: context.documentId } : {}),
      status: "pending",
      issuedAt: now,
      expiresAt: now + NATIVE_LOCAL_EXPORT_PENDING_MS,
    };
    const committed = await compareAndSetManyAppState([
      {
        key: NATIVE_RENDER_CONTEXT_LEDGER_KEY,
        expectedValue: snapshot.rawLedger,
        nextValue: snapshot.rawLedger ?? { schemaVersion: 1, contexts: [] },
      },
      {
        key: nativeLocalExportRevisionKey(args.designId, tabId),
        expectedValue: revision,
        nextValue: { schemaVersion: 1, revision: crypto.randomUUID() },
      },
      { key, expectedValue: current, nextValue: request },
    ]);
    if (!committed)
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
