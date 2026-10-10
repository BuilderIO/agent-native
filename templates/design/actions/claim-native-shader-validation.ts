import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { resolveDeployEnvironment } from "@agent-native/core/server/deploy-environment";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  NATIVE_SHADER_VALIDATION_RUNNING_MS,
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
import {
  expireNativeShaderValidationState,
  prepareNativeShaderValidationFixtures,
  readNativeShaderValidationSource,
  readNativeShaderValidationState,
  verifyNativeShaderValidationCases,
} from "./_native-shader-validation-server.js";

export default defineAction({
  agentTool: false,
  description:
    "Claim an exact pending native shader GPU validation run in its selected editor tab.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId }) => {
    const tabId = requireNativeLocalExportTabId();
    await assertNativeLocalExportEditor(designId);
    const raw = await readNativeShaderValidationState(designId, tabId);
    if (!raw || raw.requestId !== requestId)
      fail("Native shader validation was not found in this editor tab.", {
        errorCode: "native_validation_not_found",
        statusCode: 404,
      });
    const current = await expireNativeShaderValidationState(raw);
    if (current.status !== "pending")
      fail("Native shader validation is no longer pending.", {
        errorCode: "native_validation_not_pending",
        statusCode: 409,
      });
    const source = await readNativeShaderValidationSource(
      designId,
      current.fileId,
    );
    if (source.versionHash !== current.expectedVersionHash)
      fail("Design source changed before GPU validation could start.", {
        errorCode: "native_validation_source_stale",
        statusCode: 409,
      });
    if (current.cases.some((item) => item.fixture))
      await prepareNativeShaderValidationFixtures(source.content, current);
    else await verifyNativeShaderValidationCases(source.content, current);
    if (current.cases.some((item) => item.presentationFault)) {
      const faultDocument = await verifyNativeShaderValidationCases(
        source.content,
        current,
      );
      await assertAccess("design", designId, "editor");
      try {
        requireReviewedLiveFault({
          environment: resolveDeployEnvironment(),
          reviewedPin: REVIEWED_LOCAL_FAULT_PIN,
          context: {
            designId,
            fileId: current.fileId,
            ownerTabId: tabId,
            sourceVersionHash: source.versionHash,
            sourceContent: source.content,
            generatedRuntimeIife: NATIVE_SHADER_RUNTIME_SOURCE,
            cases: current.cases,
            enabledInstanceCount: faultDocument.instances.filter(
              (instance) => instance.enabled,
            ).length,
            targetPlacement:
              faultDocument.instances.find(
                (instance) => instance.id === current.cases[0]?.instanceId,
              )?.placement ?? "missing",
          },
        });
      } catch (error) {
        fail("The local presentation fault fixture changed before claim.", {
          errorCode:
            error instanceof Error
              ? error.message
              : "presentation-fault-unreadable",
          statusCode: 409,
        });
      }
    }
    const claimed: NativeShaderValidationState = {
      ...current,
      status: "running",
      expiresAt: Date.now() + NATIVE_SHADER_VALIDATION_RUNNING_MS,
    };
    if (
      !(await compareAndSetAppState(
        nativeShaderValidationStateKey(designId, tabId),
        current,
        claimed,
      ))
    )
      fail("Native shader validation was claimed concurrently.", {
        errorCode: "native_validation_state_conflict",
        statusCode: 409,
      });
    return claimed;
  },
});
