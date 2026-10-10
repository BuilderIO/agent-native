import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { resolveDeployEnvironment } from "@agent-native/core/server/deploy-environment";
import { assertAccess } from "@agent-native/core/sharing";

import { nativeRenderContextSchema } from "../shared/native-local-export.js";
import {
  NATIVE_SHADER_VALIDATION_PENDING_MS,
  nativeShaderValidationRequestSchema,
  nativeShaderValidationStateKey,
  type NativeShaderValidationState,
} from "../shared/native-shader-validation.js";
import { NATIVE_SHADER_RUNTIME_SOURCE } from "../shared/shader-fills.js";
import {
  assertNativeLocalExportEditor,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";
import {
  requireReviewedLiveFault,
  REVIEWED_LOCAL_FAULT_PIN,
} from "./_native-presentation-fault-local.js";
import { resolveNativeRenderContextTarget } from "./_native-render-contexts.js";
import {
  expireNativeShaderValidationState,
  prepareNativeShaderValidationFixtures,
  readNativeShaderValidationSource,
  readNativeShaderValidationState,
  verifyNativeShaderValidationCases,
} from "./_native-shader-validation-server.js";

export default defineAction({
  description:
    "Queue source-pinned native WebGPU cases in an open Design editor: mounted status, bounded held-frame golden, clean fixture, or one live mounted-scene measurement (120 warmup and 840 measured RAF intervals). Discover targetTabId with get-native-render-contexts, then poll get-native-shader-validation. Pixels stay in the editor; results contain bounded hashes and metrics.",
  schema: nativeShaderValidationRequestSchema.safeExtend({
    targetTabId: nativeRenderContextSchema.shape.tabId.optional(),
  }),
  http: { method: "POST" },
  run: async ({ targetTabId, ...request }) => {
    const tabId = targetTabId
      ? await resolveNativeRenderContextTarget(request.designId, targetTabId)
      : requireNativeLocalExportTabId();
    if (!targetTabId) await assertNativeLocalExportEditor(request.designId);
    const source = await readNativeShaderValidationSource(
      request.designId,
      request.fileId,
    );
    if (source.versionHash !== request.expectedVersionHash)
      fail("Design source changed before GPU validation was requested.", {
        errorCode: "native_validation_source_stale",
        statusCode: 409,
      });
    if (request.cases.some((item) => item.fixture))
      await prepareNativeShaderValidationFixtures(source.content, request);
    else await verifyNativeShaderValidationCases(source.content, request);
    if (request.cases.some((item) => item.presentationFault)) {
      const faultDocument = await verifyNativeShaderValidationCases(
        source.content,
        request,
      );
      await assertAccess("design", request.designId, "editor");
      try {
        requireReviewedLiveFault({
          environment: resolveDeployEnvironment(),
          reviewedPin: REVIEWED_LOCAL_FAULT_PIN,
          context: {
            designId: request.designId,
            fileId: request.fileId,
            ownerTabId: tabId,
            sourceVersionHash: source.versionHash,
            sourceContent: source.content,
            generatedRuntimeIife: NATIVE_SHADER_RUNTIME_SOURCE,
            cases: request.cases,
            enabledInstanceCount: faultDocument.instances.filter(
              (instance) => instance.enabled,
            ).length,
            targetPlacement:
              faultDocument.instances.find(
                (instance) => instance.id === request.cases[0]?.instanceId,
              )?.placement ?? "missing",
          },
        });
      } catch (error) {
        fail("The local presentation fault fixture is not authorized.", {
          errorCode:
            error instanceof Error
              ? error.message
              : "presentation-fault-unreadable",
          statusCode: 422,
        });
      }
    }
    const key = nativeShaderValidationStateKey(request.designId, tabId);
    const raw = await readNativeShaderValidationState(request.designId, tabId);
    const current = raw ? await expireNativeShaderValidationState(raw) : null;
    if (
      current &&
      ["pending", "running", "cancel-requested"].includes(current.status)
    )
      fail("A GPU validation run is already active in this editor tab.", {
        errorCode: "native_validation_busy",
        statusCode: 409,
      });
    const now = Date.now();
    const next: NativeShaderValidationState = {
      ...request,
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      tabId,
      status: "pending",
      issuedAt: now,
      expiresAt: now + NATIVE_SHADER_VALIDATION_PENDING_MS,
    };
    if (!(await compareAndSetAppState(key, current, next)))
      fail("The GPU validation request changed concurrently. Retry.", {
        errorCode: "native_validation_state_conflict",
        statusCode: 409,
      });
    return {
      requestId: next.requestId,
      designId: next.designId,
      fileId: next.fileId,
      status: next.status,
      caseCount: next.cases.length,
      expiresAt: next.expiresAt,
    };
  },
});
