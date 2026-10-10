import { defineAction, fail } from "@agent-native/core/action";
import { compareAndSetAppState } from "@agent-native/core/application-state";
import { resolveDeployEnvironment } from "@agent-native/core/server/deploy-environment";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  nativeShaderValidationCaseResultSchema,
  nativeShaderValidationFailureSchema,
  nativeShaderValidationStateKey,
  type NativeShaderValidationState,
} from "../shared/native-shader-validation.js";
import { NATIVE_SHADER_RUNTIME_SOURCE } from "../shared/shader-fills.js";
import {
  assertNativeLocalExportEditor,
  requireNativeLocalExportTabId,
} from "./_native-local-export-server.js";
import {
  requireFaultResult,
  requireReviewedLiveFault,
  REVIEWED_LOCAL_FAULT_PIN,
} from "./_native-presentation-fault-local.js";
import {
  readNativeShaderValidationSource,
  verifyNativeShaderValidationCases,
} from "./_native-shader-validation-server.js";
import {
  expireNativeShaderValidationState,
  readNativeShaderValidationState,
} from "./_native-shader-validation-server.js";

const resultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("validation-complete"),
      results: z.array(nativeShaderValidationCaseResultSchema).min(1).max(4),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      failure: nativeShaderValidationFailureSchema,
    })
    .strict(),
  z.object({ status: z.literal("canceled") }).strict(),
]);

export default defineAction({
  agentTool: false,
  description:
    "Report bounded per-case WebGPU validation outcomes from the claimed editor tab; this does not publish a shader or save pixels.",
  schema: z.object({
    designId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    result: resultSchema,
  }),
  http: { method: "POST" },
  run: async ({ designId, requestId, result }) => {
    const tabId = requireNativeLocalExportTabId();
    await assertNativeLocalExportEditor(designId);
    const raw = await readNativeShaderValidationState(designId, tabId);
    if (!raw || raw.requestId !== requestId)
      fail("Native shader validation was not found in this editor tab.", {
        errorCode: "native_validation_not_found",
        statusCode: 404,
      });
    const current = await expireNativeShaderValidationState(raw);
    if (current.status !== "running" && current.status !== "cancel-requested")
      fail("Native shader validation is no longer running.", {
        errorCode: "native_validation_not_running",
        statusCode: 409,
      });
    if (
      current.status === "cancel-requested" &&
      result.status === "validation-complete"
    )
      fail("Canceled GPU validation cannot report success.", {
        errorCode: "native_validation_canceled",
        statusCode: 409,
      });
    if (
      result.status === "validation-complete" &&
      current.cases.some((item) => item.presentationFault)
    ) {
      await assertAccess("design", designId, "editor");
      const source = await readNativeShaderValidationSource(
        designId,
        current.fileId,
      );
      if (source.versionHash !== current.expectedVersionHash)
        fail(
          "The reviewed local source changed before fault validation finished.",
          {
            errorCode: "presentation-fault-source-stale",
            statusCode: 409,
          },
        );
      const faultDocument = await verifyNativeShaderValidationCases(
        source.content,
        current,
      );
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
        fail("The reviewed local fault fixture changed before completion.", {
          errorCode:
            error instanceof Error
              ? error.message
              : "presentation-fault-unreadable",
          statusCode: 409,
        });
      }
    }
    if (
      result.status === "failed" &&
      result.failure.code.startsWith("presentation-fault-") &&
      !current.cases.some((item) => item.presentationFault)
    )
      fail(
        "An ordinary GPU validation cannot report a local presentation fault.",
        {
          errorCode: "presentation-fault-result-mismatch",
          statusCode: 422,
        },
      );
    if (result.status === "validation-complete") {
      const expected = new Map(
        current.cases.map((item) => [item.caseId, item]),
      );
      if (result.results.length !== expected.size)
        fail("GPU validation omitted a requested case.", {
          errorCode: "native_validation_results_incomplete",
          statusCode: 422,
        });
      const seen = new Set<string>();
      for (const item of result.results) {
        const requested = expected.get(item.caseId);
        if (
          !requested ||
          seen.has(item.caseId) ||
          requested.definitionId !== item.definitionId ||
          requested.definitionVersion !== item.definitionVersion ||
          requested.executionHash !== item.executionHash ||
          (!!item.mountOutput !== !!requested.mountedFrame &&
            (item.status === "ready" || !!item.mountOutput)) ||
          (item.mountOutput &&
            (item.mountOutput.instanceId !== requested.instanceId ||
              item.mountOutput.nodeId !== requested.nodeId ||
              item.mountOutput.definitionId !== requested.definitionId ||
              item.mountOutput.definitionVersion !==
                requested.definitionVersion ||
              item.mountOutput.executionHash !== requested.executionHash ||
              !requested.mountedFrame ||
              item.mountOutput.width >
                Math.ceil(
                  requested.mountedFrame.viewport.width *
                    requested.mountedFrame.pixelRatio,
                ) ||
              item.mountOutput.height >
                Math.ceil(
                  requested.mountedFrame.viewport.height *
                    requested.mountedFrame.pixelRatio,
                ))) ||
          (!!item.linearGolden !== !!requested.expectedLinearSamples &&
            (item.status === "ready" || !!item.linearGolden)) ||
          (!!item.mountedMeasurement !== !!requested.mountedMeasurement &&
            (item.status === "ready" || !!item.mountedMeasurement)) ||
          (item.mountedMeasurement &&
            (item.mountedMeasurement.gpuTargetInstanceId !==
              requested.instanceId ||
              item.mountedMeasurement.gpuThroughFrameIndex === undefined ||
              item.mountedMeasurement.gpuWindow === undefined ||
              item.mountedMeasurement.gpuWindow.targetInstanceId !==
                requested.instanceId)) ||
          (item.linearGolden &&
            (item.linearGolden.sampleCount !==
              requested.expectedLinearSamples?.length ||
              (item.status === "ready" && !item.linearGolden.passed) ||
              (item.status !== "ready" && item.linearGolden.passed))) ||
          (requested.fixture &&
            item.status === "ready" &&
            (!item.pixelSha256 ||
              item.pixelWidth !== 160 ||
              item.pixelHeight !== 100 ||
              item.nonTransparentPixels === undefined ||
              (requested.fixture.coverageExpectation === "nonzero" &&
                item.nonTransparentPixels === 0) ||
              (requested.fixture.coverageExpectation === "zero" &&
                item.nonTransparentPixels !== 0))) ||
          (requested.mountedFrame &&
            item.status === "ready" &&
            (!item.pixelSha256 ||
              item.nonTransparentPixels === undefined ||
              item.pixelWidth !==
                Math.ceil(
                  requested.mountedFrame.viewport.width *
                    requested.mountedFrame.pixelRatio,
                ) ||
              item.pixelHeight !==
                Math.ceil(
                  requested.mountedFrame.viewport.height *
                    requested.mountedFrame.pixelRatio,
                )))
        )
          fail("GPU validation result does not match the claimed cases.", {
            errorCode: "native_validation_results_mismatch",
            statusCode: 422,
          });
        if (requested.presentationFault) {
          if (
            !item.presentationFault ||
            item.presentationFault.kind !== requested.presentationFault ||
            item.presentationFault.grantId !==
              current.faultGrantState?.grantId ||
            item.presentationFault.pixelSource !==
              "last-published-gpu-presentation" ||
            item.presentationFault.beforePixelSha256 !==
              item.presentationFault.afterPixelSha256 ||
            item.presentationFault.preparedFrameCount !== 1 ||
            item.presentationFault.priorFrameCount !==
              item.presentationFault.beforePreparedFrameCount + 1 ||
            item.presentationFault.afterFrameCount !==
              item.presentationFault.priorFrameCount ||
            item.frames !== item.presentationFault.afterFrameCount ||
            item.presentationFault.pixelWidth *
              item.presentationFault.pixelHeight >
              1_048_576 ||
            item.presentationFault.nonTransparentPixels >
              item.presentationFault.pixelWidth *
                item.presentationFault.pixelHeight ||
            !current.faultGrantState
          )
            fail("The local fault result does not match the issued grant.", {
              errorCode: "presentation-fault-result-mismatch",
              statusCode: 422,
            });
          try {
            requireFaultResult({
              kind: requested.presentationFault,
              result: {
                status: item.status,
                code: item.code,
                simulated: item.presentationFault.simulated,
                submitted: item.presentationFault.submitted,
                scopeDrained: item.presentationFault.scopeDrained,
              },
            });
          } catch {
            fail(
              "The local fault result did not preserve last-good presentation.",
              {
                errorCode: "presentation-fault-result-mismatch",
                statusCode: 422,
              },
            );
          }
        } else if (item.presentationFault)
          fail("An ordinary GPU result cannot report a simulated fault.", {
            errorCode: "presentation-fault-result-mismatch",
            statusCode: 422,
          });
        seen.add(item.caseId);
      }
    }
    const next: NativeShaderValidationState = {
      ...current,
      status: result.status,
      ...(result.status === "validation-complete"
        ? { results: result.results, failure: undefined }
        : result.status === "failed"
          ? { failure: result.failure, results: undefined }
          : {
              failure: {
                code: "canceled" as const,
                message: "GPU validation was canceled.",
              },
              results: undefined,
            }),
    };
    if (
      !(await compareAndSetAppState(
        nativeShaderValidationStateKey(designId, tabId),
        current,
        next,
      ))
    )
      fail("GPU validation changed before its results were recorded.", {
        errorCode: "native_validation_state_conflict",
        statusCode: 409,
      });
    return { requestId, status: next.status, results: next.results ?? [] };
  },
});
