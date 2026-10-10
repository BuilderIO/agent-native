import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { nativeRenderContextSchema } from "../shared/native-local-export.js";
import { requireNativeLocalExportTabId } from "./_native-local-export-server.js";
import {
  expireNativeShaderValidationState,
  markNativeShaderValidationEditorLeft,
  readNativeShaderValidationState,
} from "./_native-shader-validation-server.js";

export default defineAction({
  description:
    "Read one foreground native shader GPU validation run. Ready, failed, unsupported, last-good, canceled, and expired cases remain distinct; timing is wall time, not GPU time. No shader source or pixel bytes are returned.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    targetTabId: nativeRenderContextSchema.shape.tabId.optional(),
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId, targetTabId }) => {
    const tabId = targetTabId ?? requireNativeLocalExportTabId();
    await assertAccess("design", designId, "viewer");
    const raw = await readNativeShaderValidationState(designId, tabId);
    if (!raw || raw.requestId !== requestId)
      fail("Native shader validation was not found.", {
        errorCode: "native_validation_not_found",
        statusCode: 404,
      });
    const state = await expireNativeShaderValidationState(
      await markNativeShaderValidationEditorLeft(raw),
    );
    return {
      requestId,
      designId,
      fileId: state.fileId,
      status: state.status,
      expiresAt: state.expiresAt,
      cases: state.cases.map(
        ({ caseId, definitionId, definitionVersion, executionHash }) => ({
          caseId,
          definitionId,
          definitionVersion,
          executionHash,
        }),
      ),
      results: state.results ?? [],
      ...(state.failure ? { failure: state.failure } : {}),
    };
  },
});
