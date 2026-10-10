import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { resolveDeployEnvironment } from "@agent-native/core/server/deploy-environment";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { nativeShaderValidationStateKey } from "../shared/native-shader-validation.js";
import { NATIVE_SHADER_RUNTIME_SOURCE } from "../shared/shader-fills.js";
import {
  assertNativeLocalExportEditor,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";
import {
  issueFaultGrant,
  REVIEWED_LOCAL_FAULT_PIN,
} from "./_native-presentation-fault-local.js";
import { verifyNativeShaderValidationCases } from "./_native-shader-validation-server.js";
import {
  prepareNativeShaderValidationFixtures,
  readNativeShaderValidationSource,
  readNativeShaderValidationState,
} from "./_native-shader-validation-server.js";

export default defineAction({
  agentTool: false,
  description:
    "Prepare exact clean GPU fixture definitions for a claimed native validation request in the selected editor tab. This returns executable source only to the foreground caller and does not persist it in application state.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId }) => {
    const tabId = requireNativeLocalExportTabId();
    await assertNativeLocalExportEditor(designId);
    const current = await readNativeShaderValidationState(designId, tabId);
    if (!current || current.requestId !== requestId)
      fail("Native validation request was not found in this editor tab.", {
        errorCode: "native_validation_not_found",
        statusCode: 404,
      });
    if (current.status !== "running" || current.expiresAt <= Date.now())
      fail("Native validation request is no longer running.", {
        errorCode: "native_validation_not_running",
        statusCode: 409,
      });
    const source = await readNativeShaderValidationSource(
      designId,
      current.fileId,
    );
    if (source.versionHash !== current.expectedVersionHash)
      fail("Native validation source changed before fixture preparation.", {
        errorCode: "native_validation_source_stale",
        statusCode: 409,
      });
    if (current.cases.some((item) => item.presentationFault)) {
      await assertAccess("design", designId, "editor");
      const faultDocument = await verifyNativeShaderValidationCases(
        source.content,
        current,
      );
      let grant;
      try {
        grant = issueFaultGrant({
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
          requestId,
          requestStatus: current.status,
          existing: current.faultGrantState,
          now: Date.now(),
        });
      } catch (error) {
        fail("The local presentation fault grant is unavailable.", {
          errorCode:
            error instanceof Error
              ? error.message
              : "presentation-fault-unreadable",
          statusCode: 409,
        });
      }
      const { grantId, issuedAt, expiresAt } = grant;
      if (
        !(await compareAndSetAppState(
          nativeShaderValidationStateKey(designId, tabId),
          current,
          {
            ...current,
            faultGrantState: { grantId, issuedAt, expiresAt },
          },
        ))
      )
        fail("The presentation fault grant changed concurrently.", {
          errorCode: "presentation-fault-state-conflict",
          statusCode: 409,
        });
      return { approvedExecutionHashes: [], items: [], faultGrant: grant };
    }
    return prepareNativeShaderValidationFixtures(source.content, current);
  },
});
