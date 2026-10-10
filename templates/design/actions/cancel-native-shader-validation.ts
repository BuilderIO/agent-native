import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { nativeRenderContextSchema } from "../shared/native-local-export.js";
import {
  nativeShaderValidationStateKey,
  type NativeShaderValidationState,
} from "../shared/native-shader-validation.js";
import { requireNativeLocalExportTabId } from "./_native-local-export-server.js";
import {
  expireNativeShaderValidationState,
  readNativeShaderValidationState,
} from "./_native-shader-validation-server.js";

export default defineAction({
  description:
    "Cancel a pending or running foreground native shader GPU validation run.",
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
    const current = await expireNativeShaderValidationState(raw);
    if (current.status !== "pending" && current.status !== "running")
      return { requestId, status: current.status };
    const next: NativeShaderValidationState =
      current.status === "pending"
        ? {
            ...current,
            status: "canceled",
            failure: {
              code: "canceled",
              message: "GPU validation was canceled.",
            },
          }
        : { ...current, status: "cancel-requested" };
    if (
      !(await compareAndSetAppState(
        nativeShaderValidationStateKey(designId, tabId),
        current,
        next,
      ))
    )
      fail("Native shader validation changed while canceling.", {
        errorCode: "native_validation_state_conflict",
        statusCode: 409,
      });
    return { requestId, status: next.status };
  },
});
