import { beforeEach, describe, expect, it, vi } from "vitest";

import { NativeMountedBenchmarkWindowCollector } from "../app/components/design/bridge/native-mounted-benchmark.js";
import { NATIVE_BENCHMARK_SOURCE_READ_SCOPE } from "../shared/native-benchmark-contract.js";
import { editNativeEffectHtml } from "../shared/native-effect-edits.js";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "../shared/native-effect-owned-test-fixtures.js";
import { PARTICLE_FLOW_EFFECT } from "../shared/native-effect-particle-flow.js";
import {
  FROSTED_REFRACTION_EFFECT,
  GRAIN_GRADIENT_EFFECT,
} from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import { parseEffectsFromHtml } from "../shared/native-effects.js";
import { nativeShaderMountedMeasurementSchema } from "../shared/native-shader-validation.js";

const mocks = vi.hoisted(() => ({
  state: null as Record<string, unknown> | null,
  content: "",
  versionHash: "v1",
  compareAndSetAppState: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  getCurrentRequestBrowserTabId: () => "tab-1",
  readAppState: async (key: string) =>
    key.startsWith("navigation:")
      ? { view: "editor", designId: "design-1" }
      : key.startsWith("design-native-effect-approvals:")
        ? null
        : mocks.state,
  compareAndSetAppState: mocks.compareAndSetAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: async () => ({
    sourceType: "inline",
    files: [{ id: "screen-1", filename: "index.html", fileType: "html" }],
  }),
  loadSelectedSourceWorkspaceFile: async (file: unknown) => file,
  readLiveSourceFile: async () => ({
    content: mocks.content,
    versionHash: mocks.versionHash,
  }),
}));

import cancel from "./cancel-native-shader-validation.js";
import claim from "./claim-native-shader-validation.js";
import finish from "./finish-native-shader-validation.js";
import get from "./get-native-shader-validation.js";
import prepare from "./prepare-native-shader-validation.js";
import request from "./request-native-shader-validation.js";

describe("foreground native shader GPU validation actions", () => {
  beforeEach(() => {
    const source =
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>';
    mocks.content = editNativeEffectHtml(source, {
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
    }).html;
    mocks.versionHash = "v1";
    mocks.state = null;
    mocks.assertAccess.mockReset();
    mocks.compareAndSetAppState.mockReset();
    mocks.compareAndSetAppState.mockImplementation(
      async (_key, expected, next) => {
        if (JSON.stringify(mocks.state) !== JSON.stringify(expected))
          return false;
        mocks.state = next;
        return true;
      },
    );
  });

  async function queuedCase() {
    const instance = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content).document!.instances[0];
    const item = {
      caseId: "grain-square",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 0,
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [item],
    });
    return { queued, item };
  }

  it("pins the live source, claims in the same editor, and stores only bounded GPU results", async () => {
    const { queued, item } = await queuedCase();
    expect(queued).toMatchObject({ status: "pending", caseCount: 1 });
    const claimed = await claim.run({
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(claimed.status).toBe("running");
    await finish.run({
      designId: "design-1",
      requestId: queued.requestId,
      result: {
        status: "validation-complete",
        results: [
          {
            caseId: item.caseId,
            definitionId: item.definitionId,
            definitionVersion: item.definitionVersion,
            executionHash: item.executionHash,
            backend: "webgpu",
            status: "ready",
            renderWallMs: 2.5,
            frames: 1,
            sourceCaptures: 0,
            estimatedResourceBytes: 4096,
          },
        ],
      },
    });
    expect(
      await get.run({ designId: "design-1", requestId: queued.requestId }),
    ).toMatchObject({
      status: "validation-complete",
      results: [{ caseId: "grain-square", status: "ready" }],
    });
    expect(mocks.state).not.toHaveProperty("source");
    expect(mocks.state).not.toHaveProperty("pixels");
  });

  it("queues same-session feedback sequences only for declared bounded numeric properties", async () => {
    const feedbackDefinition = {
      ...OWNED_FEEDBACK_TEST_DEFINITION,
      resources: OWNED_FEEDBACK_TEST_DEFINITION.resources?.map((resource) =>
        resource.name === "feedbackState" || resource.name === "feedbackDisplay"
          ? { ...resource, width: 16, height: 2 }
          : resource,
      ),
      feedback: {
        ...OWNED_FEEDBACK_TEST_DEFINITION.feedback!,
        grid: {
          ...OWNED_FEEDBACK_TEST_DEFINITION.feedback!.grid,
          width: 16,
          height: 2,
        },
      },
    };
    const editedFeedback = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "layer",
        definition: feedbackDefinition,
        params: { phase: 12 },
      },
    );
    if (editedFeedback.errors.length)
      throw new Error(editedFeedback.errors.join("; "));
    mocks.content = editedFeedback.html;
    const parsedFeedback = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content);
    if (!parsedFeedback.document)
      throw new Error(
        parsedFeedback.errors.join("; ") || "no feedback manifest",
      );
    const instance = parsedFeedback.document.instances[0];
    const sequence = [
      { kind: "advance" as const, stepId: "start" },
      {
        kind: "set-params" as const,
        stepId: "seed",
        params: { phase: 30 },
      },
      {
        kind: "capture" as const,
        stepId: "seeded",
        compare: {
          referenceStepId: "start",
          feedbackState: "different" as const,
        },
      },
    ];
    const item = {
      caseId: "feedback_sequence",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: feedbackDefinition.id,
      definitionVersion: feedbackDefinition.version,
      executionHash: await hashEffectDefinition(feedbackDefinition),
      timeSeconds: 0,
      mountedFrame: { viewport: { width: 64, height: 64 }, pixelRatio: 1 },
      captureFeedbackState: true as const,
      statefulSequence: sequence,
    };
    const valid = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [item],
    });
    expect(valid.caseCount).toBe(1);
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        cases: [
          {
            ...item,
            statefulSequence: [
              sequence[0],
              {
                kind: "set-params",
                stepId: "bad_property",
                params: { unknown: 1 },
              },
              sequence[2],
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_sequence_property_invalid",
    });
    const editedGrain = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definition: GRAIN_GRADIENT_EFFECT,
      },
    );
    if (editedGrain.errors.length)
      throw new Error(editedGrain.errors.join("; "));
    mocks.content = editedGrain.html;
    mocks.state = null;
    const parsedGrain = parseEffectsFromHtml(mocks.content);
    const grainInstance = parsedGrain.document!.instances[0];
    const numeric = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [
        {
          caseId: "grain_control_samples",
          instanceId: grainInstance.id,
          nodeId: grainInstance.nodeId,
          definitionId: GRAIN_GRADIENT_EFFECT.id,
          definitionVersion: GRAIN_GRADIENT_EFFECT.version,
          executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
          timeSeconds: 0,
          mountedFrame: {
            viewport: { width: 64, height: 64 },
            pixelRatio: 1,
          },
          statefulSequence: [
            { kind: "advance", stepId: "initial" },
            {
              kind: "set-params",
              stepId: "scale_up",
              params: { scale: 2 },
            },
            {
              kind: "capture",
              stepId: "scale_capture",
              expectedLinearSamples: [
                {
                  x: 8,
                  y: 8,
                  expected: [0, 0, 0, 1],
                  tolerance: 0.01,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(numeric.caseCount).toBe(1);
    await claim.run({ designId: "design-1", requestId: numeric.requestId });
    const mountOutput = {
      scope: "exact-mount-output-linear-premultiplied" as const,
      instanceId: grainInstance.id,
      nodeId: grainInstance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      width: 64,
      height: 64,
      pixelSha256: "b".repeat(64),
      nonTransparentPixels: 64 * 64,
      partialAlphaPixels: 0,
      nonZeroRgbaPixels: 64 * 64,
    };
    await expect(
      finish.run({
        designId: "design-1",
        requestId: numeric.requestId,
        result: {
          status: "validation-complete",
          results: [
            {
              caseId: "grain_control_samples",
              definitionId: GRAIN_GRADIENT_EFFECT.id,
              definitionVersion: GRAIN_GRADIENT_EFFECT.version,
              executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
              backend: "webgpu",
              status: "ready",
              frames: 1,
              sourceCaptures: 0,
              estimatedResourceBytes: 16_384,
              pixelSha256: "c".repeat(64),
              pixelWidth: 64,
              pixelHeight: 64,
              nonTransparentPixels: 64 * 64,
              partialAlphaPixels: 0,
              mountOutput,
              statefulRenderMode: "same-held-session-sequence",
              statefulSequence: [
                {
                  kind: "advance",
                  stepId: "initial",
                  frameIndex: 0,
                  timeSeconds: 0,
                  pixelSha256: "d".repeat(64),
                  pixelWidth: 64,
                  pixelHeight: 64,
                  mountOutput,
                  comparisons: [],
                },
                {
                  kind: "set-params",
                  stepId: "scale_up",
                  updatedProperties: ["scale"],
                },
                {
                  kind: "capture",
                  stepId: "scale_capture",
                  frameIndex: 0,
                  timeSeconds: 0,
                  pixelSha256: "e".repeat(64),
                  pixelWidth: 64,
                  pixelHeight: 64,
                  mountOutput,
                  comparisons: [],
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
  });

  it("binds requested sequence comparisons to the returned receipts", async () => {
    const edited = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definition: GRAIN_GRADIENT_EFFECT,
      },
    );
    if (edited.errors.length) throw new Error(edited.errors.join("; "));
    mocks.content = edited.html;
    const instance = parseEffectsFromHtml(mocks.content).document!.instances[0];
    const executionHash = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
    const oneSample = {
      x: 0,
      y: 0,
      expected: [0, 0, 0, 1] as [number, number, number, number],
      tolerance: 0.01,
    };
    const common = {
      caseId: "comparison_sequence",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash,
      timeSeconds: 0,
      mountedFrame: { viewport: { width: 16, height: 16 }, pixelRatio: 1 },
    };
    const comparisonSequence = [
      { kind: "advance" as const, stepId: "first" },
      {
        kind: "capture" as const,
        stepId: "compare",
        expectedLinearSamples: [oneSample],
        compare: { referenceStepId: "first", pixels: "different" as const },
      },
    ];
    const comparisonRequest = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [{ ...common, statefulSequence: comparisonSequence }],
    });
    await claim.run({
      designId: "design-1",
      requestId: comparisonRequest.requestId,
    });
    const output = {
      scope: "exact-mount-output-linear-premultiplied" as const,
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash,
      width: 16,
      height: 16,
      pixelSha256: "a".repeat(64),
      nonTransparentPixels: 256,
      partialAlphaPixels: 0,
      nonZeroRgbaPixels: 256,
    };
    const advanceReceipt = {
      kind: "advance" as const,
      stepId: "first",
      frameIndex: 0,
      timeSeconds: 0,
      pixelSha256: "b".repeat(64),
      pixelWidth: 16,
      pixelHeight: 16,
      mountOutput: output,
      comparisons: [],
    };
    const captureReceipt = {
      kind: "capture" as const,
      stepId: "compare",
      frameIndex: 0,
      timeSeconds: 0,
      pixelSha256: "c".repeat(64),
      pixelWidth: 16,
      pixelHeight: 16,
      mountOutput: output,
      linearGolden: { sampleCount: 1, maxAbsError: 0, passed: true },
      comparisons: [] as Array<{
        referenceStepId: string;
        subject: "feedback-state" | "pixels";
        expected: "same" | "different";
        observed: "same" | "different" | "unavailable";
        passed: boolean;
      }>,
    };
    const finishComparison = (requestId = comparisonRequest.requestId) =>
      finish.run({
        designId: "design-1",
        requestId,
        result: {
          status: "validation-complete",
          results: [
            {
              caseId: common.caseId,
              definitionId: common.definitionId,
              definitionVersion: common.definitionVersion,
              executionHash,
              backend: "webgpu",
              status: "ready",
              frames: 1,
              sourceCaptures: 0,
              estimatedResourceBytes: 1024,
              pixelSha256: captureReceipt.pixelSha256,
              pixelWidth: 16,
              pixelHeight: 16,
              nonTransparentPixels: 256,
              partialAlphaPixels: 0,
              mountOutput: captureReceipt.mountOutput,
              statefulRenderMode: "same-held-session-sequence",
              statefulSequence: [advanceReceipt, captureReceipt],
            },
          ],
        },
      });
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.comparisons = [
      {
        referenceStepId: "wrong_reference",
        subject: "pixels",
        expected: "different",
        observed: "different",
        passed: true,
      },
    ];
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.comparisons = [
      {
        referenceStepId: "first",
        subject: "pixels",
        expected: "same",
        observed: "same",
        passed: true,
      },
    ];
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.comparisons = [
      {
        referenceStepId: "first",
        subject: "pixels",
        expected: "different",
        observed: "different",
        passed: true,
      },
      {
        referenceStepId: "first",
        subject: "feedback-state",
        expected: "same",
        observed: "same",
        passed: true,
      },
    ];
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.comparisons = [
      {
        referenceStepId: "first",
        subject: "pixels",
        expected: "different",
        observed: "different",
        passed: true,
      },
    ];
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.mountOutput = { ...output, pixelSha256: "b".repeat(64) };
    captureReceipt.linearGolden = {
      sampleCount: 1,
      maxAbsError: 0.5,
      passed: true,
    };
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.linearGolden = {
      sampleCount: 1,
      maxAbsError: 0,
      passed: true,
    };
    captureReceipt.mountOutput = {
      ...output,
      nodeId: "wrong_node",
      pixelSha256: "b".repeat(64),
    };
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.mountOutput = { ...output, pixelSha256: "b".repeat(64) };
    advanceReceipt.frameIndex = 1;
    advanceReceipt.timeSeconds = 1 / 60;
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    advanceReceipt.frameIndex = 0;
    advanceReceipt.timeSeconds = 0;
    captureReceipt.frameIndex = 1;
    captureReceipt.timeSeconds = 1 / 60;
    await expect(finishComparison()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    captureReceipt.frameIndex = 0;
    captureReceipt.timeSeconds = 0;
    await finishComparison();

    mocks.state = null;
    const sameRequest = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [
        {
          ...common,
          statefulSequence: [
            comparisonSequence[0],
            {
              kind: "capture" as const,
              stepId: "compare",
              expectedLinearSamples: [oneSample],
              compare: { referenceStepId: "first", pixels: "same" as const },
            },
          ],
        },
      ],
    });
    await claim.run({ designId: "design-1", requestId: sameRequest.requestId });
    captureReceipt.comparisons = [
      {
        referenceStepId: "first",
        subject: "pixels",
        expected: "same",
        observed: "same",
        passed: true,
      },
    ];
    await expect(finishComparison(sameRequest.requestId)).rejects.toMatchObject(
      {
        errorCode: "native_validation_results_mismatch",
      },
    );
  });

  it("derives feedback comparisons from the held state receipts and rejects missing state", async () => {
    const feedbackDefinition = {
      ...OWNED_FEEDBACK_TEST_DEFINITION,
      resources: OWNED_FEEDBACK_TEST_DEFINITION.resources?.map((resource) =>
        resource.name === "feedbackState" || resource.name === "feedbackDisplay"
          ? { ...resource, width: 16, height: 2 }
          : resource,
      ),
      feedback: {
        ...OWNED_FEEDBACK_TEST_DEFINITION.feedback!,
        grid: {
          ...OWNED_FEEDBACK_TEST_DEFINITION.feedback!.grid,
          width: 16,
          height: 2,
        },
      },
    };
    const edited = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "layer",
        definition: feedbackDefinition,
      },
    );
    if (edited.errors.length) throw new Error(edited.errors.join("; "));
    mocks.content = edited.html;
    mocks.state = null;
    const instance = parseEffectsFromHtml(mocks.content).document!.instances[0];
    const executionHash = await hashEffectDefinition(feedbackDefinition);
    const requestCase = {
      caseId: "feedback_receipts",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: feedbackDefinition.id,
      definitionVersion: feedbackDefinition.version,
      executionHash,
      timeSeconds: 0,
      mountedFrame: { viewport: { width: 64, height: 64 }, pixelRatio: 1 },
      captureFeedbackState: true as const,
      statefulSequence: [
        { kind: "advance" as const, stepId: "first" },
        {
          kind: "capture" as const,
          stepId: "compare",
          compare: {
            referenceStepId: "first",
            feedbackState: "different" as const,
          },
        },
      ],
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [requestCase],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    const followups = {
      sourceTransition: {
        availability: "unavailable" as const,
        code: "second-source-fixture-required" as const,
      },
      lifecycleReplay: {
        availability: "unavailable" as const,
        code: "multi-action-editor-sequence-required" as const,
      },
    };
    const state = {
      availability: "available" as const,
      scope: "exact-feedback-state-linear-rgba16f" as const,
      width: 16,
      height: 2,
      completedStep: 0,
      byteLength: 256,
      sha256: "a".repeat(64),
      followups,
    };
    const output = {
      scope: "exact-mount-output-linear-premultiplied" as const,
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: feedbackDefinition.id,
      definitionVersion: feedbackDefinition.version,
      executionHash,
      width: 16,
      height: 2,
      pixelSha256: "b".repeat(64),
      nonTransparentPixels: 32,
      partialAlphaPixels: 0,
      nonZeroRgbaPixels: 32,
      feedbackState: state,
    };
    const capture = {
      kind: "capture" as const,
      stepId: "compare",
      frameIndex: 0,
      timeSeconds: 0,
      pixelSha256: "c".repeat(64),
      pixelWidth: 64,
      pixelHeight: 64,
      mountOutput: output,
      comparisons: [
        {
          referenceStepId: "first",
          subject: "feedback-state" as const,
          expected: "different" as const,
          observed: "different" as const,
          passed: true,
        },
      ],
    };
    const finishFeedback = (requestId = queued.requestId) =>
      finish.run({
        designId: "design-1",
        requestId,
        result: {
          status: "validation-complete",
          results: [
            {
              caseId: "feedback_receipts",
              definitionId: feedbackDefinition.id,
              definitionVersion: feedbackDefinition.version,
              executionHash,
              backend: "webgpu",
              status: "ready",
              frames: 1,
              sourceCaptures: 0,
              estimatedResourceBytes: 1024,
              pixelSha256: capture.pixelSha256,
              pixelWidth: 64,
              pixelHeight: 64,
              nonTransparentPixels: 32,
              partialAlphaPixels: 0,
              mountOutput: capture.mountOutput,
              statefulRenderMode: "same-held-session-sequence",
              statefulSequence: [
                {
                  kind: "advance" as const,
                  stepId: "first",
                  frameIndex: 0,
                  timeSeconds: 0,
                  pixelSha256: "d".repeat(64),
                  pixelWidth: 64,
                  pixelHeight: 64,
                  mountOutput: output,
                  comparisons: [],
                },
                capture,
              ],
            },
          ],
        },
      });
    await expect(finishFeedback()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    capture.mountOutput = {
      ...output,
      feedbackState: undefined,
    } as typeof output;
    await expect(finishFeedback()).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    capture.mountOutput = {
      ...output,
      feedbackState: { ...state, width: 8, byteLength: 128 },
    };
    await finishFeedback();
    mocks.state = null;
    const hashRequest = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [requestCase],
    });
    await claim.run({ designId: "design-1", requestId: hashRequest.requestId });
    capture.mountOutput = {
      ...output,
      feedbackState: { ...state, sha256: "e".repeat(64) },
    };
    await finishFeedback(hashRequest.requestId);
  });

  it("accepts mixed per-capture golden outcomes when one requested sample fails", async () => {
    const edited = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definition: GRAIN_GRADIENT_EFFECT,
      },
    );
    if (edited.errors.length) throw new Error(edited.errors.join("; "));
    mocks.content = edited.html;
    const instance = parseEffectsFromHtml(mocks.content).document!.instances[0];
    const executionHash = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
    const common = {
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash,
      timeSeconds: 0,
      mountedFrame: { viewport: { width: 16, height: 16 }, pixelRatio: 1 },
    };
    const output = {
      scope: "exact-mount-output-linear-premultiplied" as const,
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash,
      width: 16,
      height: 16,
      pixelSha256: "a".repeat(64),
      nonTransparentPixels: 256,
      partialAlphaPixels: 0,
      nonZeroRgbaPixels: 256,
    };
    mocks.state = null;
    const sample = (x: number) => ({
      x,
      y: 0,
      expected: [0, 0, 0, 1] as [number, number, number, number],
      tolerance: 0.01,
    });
    const mixedRequest = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [
        {
          ...common,
          caseId: "mixed_goldens",
          statefulSequence: [
            { kind: "advance", stepId: "initial" },
            {
              kind: "capture",
              stepId: "first_sample",
              expectedLinearSamples: [sample(0)],
            },
            {
              kind: "capture",
              stepId: "second_sample",
              expectedLinearSamples: [sample(1)],
            },
          ],
        },
      ],
    });
    await claim.run({
      designId: "design-1",
      requestId: mixedRequest.requestId,
    });
    await finish.run({
      designId: "design-1",
      requestId: mixedRequest.requestId,
      result: {
        status: "validation-complete",
        results: [
          {
            caseId: "mixed_goldens",
            definitionId: GRAIN_GRADIENT_EFFECT.id,
            definitionVersion: GRAIN_GRADIENT_EFFECT.version,
            executionHash,
            backend: "webgpu",
            status: "error",
            code: "linear-golden-failed",
            frames: 1,
            sourceCaptures: 0,
            estimatedResourceBytes: 1024,
            pixelSha256: "f".repeat(64),
            pixelWidth: 16,
            pixelHeight: 16,
            nonTransparentPixels: 256,
            partialAlphaPixels: 0,
            mountOutput: output,
            statefulRenderMode: "same-held-session-sequence",
            statefulSequence: [
              {
                kind: "advance",
                stepId: "initial",
                frameIndex: 0,
                timeSeconds: 0,
                pixelSha256: "d".repeat(64),
                pixelWidth: 16,
                pixelHeight: 16,
                mountOutput: output,
                comparisons: [],
              },
              {
                kind: "capture",
                stepId: "first_sample",
                frameIndex: 0,
                timeSeconds: 0,
                pixelSha256: "e".repeat(64),
                pixelWidth: 16,
                pixelHeight: 16,
                mountOutput: output,
                linearGolden: { sampleCount: 1, maxAbsError: 0, passed: true },
                comparisons: [],
              },
              {
                kind: "capture",
                stepId: "second_sample",
                frameIndex: 0,
                timeSeconds: 0,
                pixelSha256: "f".repeat(64),
                pixelWidth: 16,
                pixelHeight: 16,
                mountOutput: output,
                linearGolden: {
                  sampleCount: 1,
                  maxAbsError: 0.5,
                  passed: false,
                },
                comparisons: [],
              },
            ],
          },
        ],
      },
    });
  });

  it("rejects held-sequence results after the pinned source revision changes", async () => {
    const instance = parseEffectsFromHtml(mocks.content).document!.instances[0];
    const item = {
      caseId: "stale_sequence",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 0,
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [
        {
          ...item,
          mountedFrame: { viewport: { width: 16, height: 16 }, pixelRatio: 1 },
          statefulSequence: [
            { kind: "advance", stepId: "initial" },
            {
              kind: "capture",
              stepId: "final",
              expectedLinearSamples: [
                {
                  x: 0,
                  y: 0,
                  expected: [0, 0, 0, 1],
                  tolerance: 0.01,
                },
              ],
            },
          ],
        },
      ],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    mocks.versionHash = "v2";
    await expect(
      finish.run({
        designId: "design-1",
        requestId: queued.requestId,
        result: {
          status: "validation-complete",
          results: [
            {
              caseId: item.caseId,
              definitionId: item.definitionId,
              definitionVersion: item.definitionVersion,
              executionHash: item.executionHash,
              backend: "unavailable",
              status: "unavailable",
              code: "mounted-output-target-unready",
              sourceCaptures: 0,
              frames: 0,
              estimatedResourceBytes: 0,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ errorCode: "native_validation_source_stale" });
  });

  it("cannot finish a requested live measurement as ordinary mounted status", async () => {
    const { item } = await queuedCase();
    mocks.state = null;
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [
        {
          ...item,
          mountedMeasurement: {
            warmupRafIntervals: 120,
            measuredRafIntervals: 840,
          },
        },
      ],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    await expect(
      finish.run({
        designId: "design-1",
        requestId: queued.requestId,
        result: {
          status: "validation-complete",
          results: [
            {
              caseId: item.caseId,
              definitionId: item.definitionId,
              definitionVersion: item.definitionVersion,
              executionHash: item.executionHash,
              backend: "webgpu",
              status: "ready",
              frames: 1,
              sourceCaptures: 0,
              estimatedResourceBytes: 4096,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
  });

  it("requires current measurement windows to acknowledge the requested GPU target and keeps historical records read-only", async () => {
    const { item } = await queuedCase();
    mocks.state = null;
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [
        {
          ...item,
          mountedMeasurement: {
            warmupRafIntervals: 120,
            measuredRafIntervals: 840,
          },
        },
      ],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    const stats = (count: number) => ({
      count,
      p50: 1,
      p95: 1,
      p99: 1,
      max: 1,
    });
    const sourceCountStats = {
      count: 840,
      p50: 2,
      p95: 4,
      p99: 4,
      max: 4,
    };
    const sourceCallsStats = {
      count: 840,
      p50: 6,
      p95: 6,
      p99: 6,
      max: 6,
    };
    const sourceReadDetail = {
      scope: NATIVE_BENCHMARK_SOURCE_READ_SCOPE,
      stats: {
        calls: sourceCallsStats,
        scenePresentationCalls: sourceCountStats,
        mountSourceCalls: sourceCountStats,
        dependencyRefreshCalls: sourceCountStats,
        otherCalls: sourceCountStats,
        wallMs: stats(840),
        walkWallMs: stats(840),
        validationWallMs: stats(840),
        leafWaitWallMs: stats(840),
        walkNodeVisits: sourceCountStats,
        walkDirectStyleReads: sourceCountStats,
        walkDirectLayoutSizeReads: sourceCountStats,
        walkDirectAffineReads: sourceCountStats,
        recordDirectStyleReads: sourceCountStats,
        recordDirectLayoutSizeReads: sourceCountStats,
        recordDirectAffineReads: sourceCountStats,
        recordDirectRectReads: sourceCountStats,
      },
    };
    const fullFrameWallPhases = {
      scope: "full-render-internal-wall-intervals-not-CPU-or-GPU-time",
      stats: {
        renderInternalWallMs: stats(840),
        deviceWallMs: stats(840),
        mountAwaitWallMs: stats(840),
        scenePresentationWallMs: stats(840),
        retirementWallMs: stats(840),
      },
      scenePresentation: {
        scope:
          "nested-in-scene-presentation-wall-intervals-not-CPU-or-GPU-time",
        stats: {
          sourceReadWallMs: stats(840),
          composeWallMs: stats(840),
          encodeWallMs: stats(840),
          submitWallMs: stats(840),
          errorScopeWallMs: stats(840),
          publicationWallMs: stats(840),
        },
      },
    };
    const measured = (target: string) =>
      nativeShaderMountedMeasurementSchema.parse({
        scope: "live-mounted-scene",
        warmupRafIntervals: 120,
        measuredRafIntervals: 840,
        measuredRenderFrames: 840,
        rafIntervalMs: stats(840),
        renderWallMs: stats(840),
        sourceWallMs: stats(840),
        composeWallMs: stats(840),
        fullFrameWallPhases,
        sourceReadDetail,
        deadlines: { over60Hz: 0, over120Hz: 0 },
        sourceCaptureDelta: 1,
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpuTargetInstanceId: target,
        gpuAfterFrameIndex: 10,
        gpuThroughFrameIndex: 11,
        gpuWindow: {
          scope: "sparse-target-mount-command-encoder",
          targetInstanceId: target,
          sampleEveryFrames: 60,
          maxSamples: 128,
          warmupAfterFrameIndex: 9,
          afterFrameIndex: 10,
          throughFrameIndex: 11,
          kind: "unavailable",
          code: "timestamp-query-unavailable",
          samples: [],
          skippedCapacity: { warmup: 0, measurement: 0 },
          omittedSamples: 0,
          gpuPassSumMs: null,
        },
        profileAtEnd: {
          state: "available",
          scope: "mounted-scene",
          capturedAt: 1,
          sampleWindow: "rolling-120-render/raf",
          renderWallMs: stats(120),
          rafIntervalMs: stats(120),
          preview: {
            requestedQuality: "auto",
            frameRateTarget: 60,
            effectivePixelRatio: 1,
          },
          textures: {
            allocatedBytes: 0,
            mountedBytes: 0,
            queuedRetirementBytes: 0,
            inFlightRetirementBytes: 0,
            sharedBytes: 0,
            unattributedBytes: 0,
            omittedMounts: 0,
          },
          gpuTargetInstanceId: target,
          gpuScope: "target-mount-command-encoder-not-full-scene",
          gpu: { kind: "unavailable", code: "timestamp-query-unavailable" },
        },
      });
    const valid = measured(item.instanceId);
    const collector = new NativeMountedBenchmarkWindowCollector({
      warmupRafIntervals: 120,
      measuredRafIntervals: 840,
    });
    const sourceReadSample = {
      calls: 6,
      scenePresentationCalls: 2,
      mountSourceCalls: 2,
      dependencyRefreshCalls: 1,
      otherCalls: 1,
      wallMs: 3,
      walkWallMs: 2,
      validationWallMs: 1,
      leafWaitWallMs: 1,
      walkNodeVisits: 5,
      walkDirectStyleReads: 2,
      walkDirectLayoutSizeReads: 1,
      walkDirectAffineReads: 1,
      recordDirectStyleReads: 2,
      recordDirectLayoutSizeReads: 1,
      recordDirectAffineReads: 1,
      recordDirectRectReads: 1,
    };
    const fullFrameSample = {
      frame: {
        renderInternalWallMs: 8,
        deviceWallMs: 1,
        mountAwaitWallMs: 1,
        scenePresentationWallMs: 5,
        retirementWallMs: 1,
      },
      scene: {
        sourceReadWallMs: 3,
        composeWallMs: 1,
        encodeWallMs: 0.25,
        submitWallMs: 0.25,
        errorScopeWallMs: 0.25,
        publicationWallMs: 0.25,
      },
    };
    for (let frame = 0; frame <= 960; frame += 1) {
      collector.onRaf(frame * 10, "visible");
      if (collector.isMeasuring)
        collector.onRender({
          renderWallMs: 8,
          sourceWallMs: 3,
          composeWallMs: 1,
          fullFrameWallPhases: fullFrameSample,
          sourceReadDetail: sourceReadSample,
          failureCount: 0,
        });
    }
    const collectedMeasurement = nativeShaderMountedMeasurementSchema.parse({
      ...valid,
      ...collector.result(),
    });
    expect(collectedMeasurement.sourceReadDetail).toMatchObject({
      scope: NATIVE_BENCHMARK_SOURCE_READ_SCOPE,
      stats: { calls: { count: 840 } },
    });
    const historical = nativeShaderMountedMeasurementSchema.parse({
      ...valid,
      gpuThroughFrameIndex: undefined,
      gpuWindow: undefined,
    });
    const result = (measurement: typeof valid) => ({
      caseId: item.caseId,
      definitionId: item.definitionId,
      definitionVersion: item.definitionVersion,
      executionHash: item.executionHash,
      backend: "webgpu" as const,
      status: "ready" as const,
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 1,
      mountedMeasurement: measurement,
    });
    for (const invalid of [historical, measured("different-target")])
      await expect(
        finish.run({
          designId: "design-1",
          requestId: queued.requestId,
          result: { status: "validation-complete", results: [result(invalid)] },
        }),
      ).rejects.toMatchObject({
        errorCode: "native_validation_results_mismatch",
      });
    await finish.run({
      designId: "design-1",
      requestId: queued.requestId,
      result: { status: "validation-complete", results: [result(valid)] },
    });
    expect(mocks.state).toMatchObject({
      status: "validation-complete",
      results: [
        {
          mountedMeasurement: {
            gpuTargetInstanceId: item.instanceId,
            gpuThroughFrameIndex: 11,
            sourceReadDetail: {
              scope: NATIVE_BENCHMARK_SOURCE_READ_SCOPE,
              stats: {
                walkDirectLayoutSizeReads: sourceCountStats,
              },
            },
          },
        },
      ],
    });
  });

  it("rejects mismatched results and supports cancellation without a false success", async () => {
    const { queued, item } = await queuedCase();
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    await expect(
      finish.run({
        designId: "design-1",
        requestId: queued.requestId,
        result: {
          status: "validation-complete",
          results: [
            {
              caseId: item.caseId,
              definitionId: item.definitionId,
              definitionVersion: item.definitionVersion,
              executionHash: "0".repeat(64),
              backend: "webgpu",
              status: "ready",
              frames: 1,
              sourceCaptures: 0,
              estimatedResourceBytes: 0,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    expect(
      (await cancel.run({ designId: "design-1", requestId: queued.requestId }))
        .status,
    ).toBe("cancel-requested");
    expect(
      (
        await finish.run({
          designId: "design-1",
          requestId: queued.requestId,
          result: { status: "canceled" },
        })
      ).status,
    ).toBe("canceled");
  });

  it("rejects stale source and a false executable hash before enqueuing", async () => {
    const { item } = await queuedCase();
    mocks.state = null;
    mocks.versionHash = "v2";
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        cases: [item],
      }),
    ).rejects.toMatchObject({ errorCode: "native_validation_source_stale" });
    mocks.versionHash = "v1";
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        cases: [{ ...item, executionHash: "0".repeat(64) }],
      }),
    ).rejects.toMatchObject({ errorCode: "native_validation_source_stale" });
  });

  it("resolves a clean generator fixture from the exact live definition without persisting WGSL or pixels", async () => {
    const instance = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content).document!.instances[0];
    const item = {
      caseId: "grainLandscape",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 0,
      fixture: {
        sourceKind: "generated" as const,
        aspect: "landscape" as const,
        alpha: "transparent" as const,
        rounded: true,
        seed: 19,
        params: { scale: 1.7 },
      },
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [item],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    const prepared = await prepare.run({
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(prepared.items).toMatchObject([
      {
        id: "grainLandscape",
        params: { scale: 1.7 },
        seed: 19,
        fixture: { rounded: true },
      },
    ]);
    expect(prepared.items[0].definition.passes[0].wgsl).toContain("@fragment");
    expect(JSON.stringify(mocks.state)).not.toContain("@fragment");
    expect(mocks.state).not.toHaveProperty("pixels");
    await expect(
      finish.run({
        designId: "design-1",
        requestId: queued.requestId,
        result: {
          status: "validation-complete",
          results: [
            {
              caseId: item.caseId,
              definitionId: item.definitionId,
              definitionVersion: item.definitionVersion,
              executionHash: item.executionHash,
              backend: "webgpu",
              status: "ready",
              frames: 1,
              sourceCaptures: 0,
              estimatedResourceBytes: 64_000,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
  });

  it("rejects malformed clean fixture property overrides before queuing", async () => {
    const instance = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content).document!.instances[0];
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        cases: [
          {
            caseId: "grainBad",
            instanceId: instance.id,
            nodeId: instance.nodeId,
            definitionId: GRAIN_GRADIENT_EFFECT.id,
            definitionVersion: GRAIN_GRADIENT_EFFECT.version,
            executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
            timeSeconds: 0,
            fixture: {
              sourceKind: "generated",
              aspect: "square",
              alpha: "opaque",
              rounded: false,
              seed: 2,
              params: { missingProperty: 1 },
            },
          },
        ],
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_fixture_invalid",
    });
    expect(mocks.state).toBeNull();
  });

  it("accepts generator text-mask and zero-alpha source fixtures while rejecting an image-only generator source", async () => {
    const instance = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content).document!.instances[0];
    const item = {
      caseId: "grainTextZero",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 0,
      fixture: {
        sourceKind: "editable-text" as const,
        aspect: "portrait" as const,
        alpha: "zero" as const,
        rounded: false,
        seed: 5,
      },
    };
    const requestInput = {
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [item],
    };
    const queued = await request.run(requestInput);
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    expect(
      (
        await prepare.run({
          designId: "design-1",
          requestId: queued.requestId,
        })
      ).items[0].fixture,
    ).toMatchObject({ sourceKind: "editable-text", alpha: "zero" });
    expect(
      (
        await finish.run({
          designId: "design-1",
          requestId: queued.requestId,
          result: {
            status: "validation-complete",
            results: [
              {
                caseId: item.caseId,
                definitionId: item.definitionId,
                definitionVersion: item.definitionVersion,
                executionHash: item.executionHash,
                backend: "webgpu",
                status: "ready",
                frames: 1,
                sourceCaptures: 0,
                estimatedResourceBytes: 64_000,
                pixelSha256: "b".repeat(64),
                pixelWidth: 160,
                pixelHeight: 100,
                nonTransparentPixels: 0,
              },
            ],
          },
        })
      ).status,
    ).toBe("validation-complete");
    mocks.state = null;
    await expect(
      request.run({
        ...requestInput,
        cases: [
          {
            ...item,
            fixture: { ...item.fixture, sourceKind: "owned-image" },
          },
        ],
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_fixture_unsupported",
    });
  });

  it("requires a bounded float summary for a ready clean fixture and stores no sampled GPU channels", async () => {
    const instance = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content).document!.instances[0];
    const item = {
      caseId: "linearGold",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 0,
      fixture: {
        sourceKind: "editable-text" as const,
        aspect: "square" as const,
        alpha: "transparent" as const,
        rounded: false,
        seed: 3,
      },
      expectedLinearSamples: [
        {
          x: 10,
          y: 12,
          expected: [0.4, -0.1, 2, 0.5] as [number, number, number, number],
          tolerance: 0.002,
        },
      ],
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [item],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    const prepared = await prepare.run({
      designId: "design-1",
      requestId: queued.requestId,
    });
    expect(prepared.items[0]).toHaveProperty(
      "expectedLinearSamples",
      item.expectedLinearSamples,
    );
    const result = {
      caseId: item.caseId,
      definitionId: item.definitionId,
      definitionVersion: item.definitionVersion,
      executionHash: item.executionHash,
      backend: "webgpu" as const,
      status: "ready" as const,
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 4096,
      pixelSha256: "b".repeat(64),
      pixelWidth: 160,
      pixelHeight: 100,
      nonTransparentPixels: 100,
    };
    await expect(
      finish.run({
        designId: "design-1",
        requestId: queued.requestId,
        result: { status: "validation-complete", results: [result] },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_validation_results_mismatch",
    });
    await finish.run({
      designId: "design-1",
      requestId: queued.requestId,
      result: {
        status: "validation-complete",
        results: [
          {
            ...result,
            linearGolden: { sampleCount: 1, maxAbsError: 0.001, passed: true },
          },
        ],
      },
    });
    expect(mocks.state).toMatchObject({
      results: [{ linearGolden: { sampleCount: 1, passed: true } }],
    });
    expect(mocks.state).not.toHaveProperty("rgba");
  });

  it("pins a mounted golden to exact source and physical dimensions before retaining a summary", async () => {
    const instance = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content).document!.instances[0];
    const item = {
      caseId: "mountedOriginal",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: instance.definitionId,
      definitionVersion: instance.definitionVersion,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 1.5,
      mountedFrame: {
        viewport: { width: 200, height: 180 },
        pixelRatio: 2,
      },
      expectedLinearSamples: [
        {
          x: 399,
          y: 359,
          expected: [0.3, 0.4, 0.5, 1] as [number, number, number, number],
          tolerance: 0.005,
        },
      ],
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [item],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    const baseResult = {
      caseId: item.caseId,
      definitionId: item.definitionId,
      definitionVersion: item.definitionVersion,
      executionHash: item.executionHash,
      backend: "webgpu" as const,
      status: "ready" as const,
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 4096,
      linearGolden: { sampleCount: 1, maxAbsError: 0.001, passed: true },
      pixelWidth: 400,
      pixelHeight: 360,
      pixelSha256: "b".repeat(64),
      nonTransparentPixels: 100,
      partialAlphaPixels: 10,
      mountOutput: {
        scope: "exact-mount-output-linear-premultiplied" as const,
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        width: 128,
        height: 128,
        pixelSha256: "c".repeat(64),
        nonTransparentPixels: 0,
        partialAlphaPixels: 0,
        nonZeroRgbaPixels: 0,
      },
    };
    for (const invalid of [
      { ...baseResult, mountOutput: undefined },
      {
        ...baseResult,
        mountOutput: {
          ...baseResult.mountOutput,
          instanceId: "other-instance",
        },
      },
      { ...baseResult, mountOutput: { ...baseResult.mountOutput, width: 401 } },

      { ...baseResult, pixelSha256: undefined },
      {
        ...baseResult,
        nonTransparentPixels: undefined,
        partialAlphaPixels: undefined,
      },
      { ...baseResult, pixelHeight: 200 },
      { ...baseResult, linearGolden: undefined },
      {
        ...baseResult,
        linearGolden: { ...baseResult.linearGolden, passed: false },
      },
    ])
      await expect(
        finish.run({
          designId: "design-1",
          requestId: queued.requestId,
          result: { status: "validation-complete", results: [invalid] },
        }),
      ).rejects.toMatchObject({
        errorCode: "native_validation_results_mismatch",
      });
    await finish.run({
      designId: "design-1",
      requestId: queued.requestId,
      result: { status: "validation-complete", results: [baseResult] },
    });
    expect(mocks.state).toMatchObject({
      results: [
        {
          caseId: "mountedOriginal",
          pixelWidth: 400,
          pixelHeight: 360,
          linearGolden: { sampleCount: 1, passed: true },
          mountOutput: { width: 128, height: 128, nonTransparentPixels: 0 },
        },
      ],
    });
    expect(JSON.stringify(mocks.state)).not.toContain("rgba");
  });

  it("binds full-scene sample receipts to the requested source, frame, request, and coordinates", async () => {
    const instance = parseEffectsFromHtml(mocks.content).document!.instances[0];
    const coordinates = [
      { x: 7, y: 8 },
      { x: 12, y: 9 },
    ];
    const item = {
      caseId: "sceneSamples",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 0.5,
      mountedFrame: { viewport: { width: 20, height: 10 }, pixelRatio: 1 },
      scenePixelSampleCoordinates: coordinates,
    };
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [item],
    });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    const result = {
      caseId: item.caseId,
      definitionId: item.definitionId,
      definitionVersion: item.definitionVersion,
      executionHash: item.executionHash,
      backend: "webgpu" as const,
      status: "ready" as const,
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 4096,
      pixelSha256: "b".repeat(64),
      pixelWidth: 20,
      pixelHeight: 10,
      nonTransparentPixels: 100,
      partialAlphaPixels: 10,
      mountOutput: {
        scope: "exact-mount-output-linear-premultiplied" as const,
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        width: 2,
        height: 2,
        pixelSha256: "c".repeat(64),
        nonTransparentPixels: 4,
        partialAlphaPixels: 0,
        nonZeroRgbaPixels: 4,
      },
      fullScenePixelSamples: {
        scope: "full-scene-composition-srgb-straight-u8" as const,
        requestId: queued.requestId,
        sourceVersionHash: "v1",
        frameIndex: 30,
        timeSeconds: 0.5,
        width: 20,
        height: 10,
        pixelRatio: 1,
        colorSpace: "srgb" as const,
        alpha: "straight" as const,
        samples: [
          {
            x: 7,
            y: 8,
            rgba8: [12, 34, 56, 255] as [number, number, number, number],
          },
          {
            x: 12,
            y: 9,
            rgba8: [1, 2, 3, 0] as [number, number, number, number],
          },
        ],
      },
    };
    for (const invalid of [
      {
        ...result,
        fullScenePixelSamples: {
          ...result.fullScenePixelSamples,
          requestId: "00000000-0000-4000-8000-000000000002",
        },
      },
      {
        ...result,
        fullScenePixelSamples: {
          ...result.fullScenePixelSamples,
          sourceVersionHash: "stale",
        },
      },
      {
        ...result,
        fullScenePixelSamples: {
          ...result.fullScenePixelSamples,
          frameIndex: 29,
        },
      },
      {
        ...result,
        fullScenePixelSamples: {
          ...result.fullScenePixelSamples,
          samples: [...result.fullScenePixelSamples.samples].reverse(),
        },
      },
      { ...result, fullScenePixelSamples: undefined },
    ])
      await expect(
        finish.run({
          designId: "design-1",
          requestId: queued.requestId,
          result: { status: "validation-complete", results: [invalid] },
        }),
      ).rejects.toMatchObject({
        errorCode: "native_validation_results_mismatch",
      });
    await finish.run({
      designId: "design-1",
      requestId: queued.requestId,
      result: { status: "validation-complete", results: [result] },
    });
    expect(mocks.state).toMatchObject({
      results: [
        {
          fullScenePixelSamples: {
            requestId: queued.requestId,
            samples: coordinates.map((point, index) => ({
              ...point,
              rgba8: result.fullScenePixelSamples.samples[index].rgba8,
            })),
          },
        },
      ],
    });
    expect(JSON.stringify(mocks.state)).not.toContain('"rgba":');
  });

  it("requires a bounded held frame for a persistent mounted effect", async () => {
    mocks.content = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definition: PARTICLE_FLOW_EFFECT,
      },
    ).html;
    const instance = (
      await import("../shared/native-effects.js")
    ).parseEffectsFromHtml(mocks.content).document!.instances[0];
    const item = {
      caseId: "particleMounted",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: instance.definitionId,
      definitionVersion: instance.definitionVersion,
      executionHash: await hashEffectDefinition(PARTICLE_FLOW_EFFECT),
      timeSeconds: 0,
    };
    await expect(
      request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        cases: [item],
      }),
    ).rejects.toMatchObject({ errorCode: "native_validation_frame_required" });
    const queued = await request.run({
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      cases: [
        {
          ...item,
          mountedFrame: {
            viewport: { width: 1160, height: 450 },
            pixelRatio: 1,
          },
        },
      ],
    });
    expect(queued).toMatchObject({ status: "pending", caseCount: 1 });
    await claim.run({ designId: "design-1", requestId: queued.requestId });
    await finish.run({
      designId: "design-1",
      requestId: queued.requestId,
      result: {
        status: "validation-complete",
        results: [
          {
            caseId: item.caseId,
            definitionId: item.definitionId,
            definitionVersion: item.definitionVersion,
            executionHash: item.executionHash,
            backend: "webgpu",
            status: "ready",
            frames: 1,
            sourceCaptures: 0,
            estimatedResourceBytes: 2048,
            pixelSha256: "b".repeat(64),
            pixelWidth: 1160,
            pixelHeight: 450,
            nonTransparentPixels: 0,
            partialAlphaPixels: 0,
            mountOutput: {
              scope: "exact-mount-output-linear-premultiplied",
              instanceId: item.instanceId,
              nodeId: item.nodeId,
              definitionId: item.definitionId,
              definitionVersion: item.definitionVersion,
              executionHash: item.executionHash,
              width: 1160,
              height: 450,
              pixelSha256: "c".repeat(64),
              nonTransparentPixels: 0,
              partialAlphaPixels: 0,
              nonZeroRgbaPixels: 0,
            },
          },
        ],
      },
    });
    expect(mocks.state).toMatchObject({
      status: "validation-complete",
      results: [{ caseId: "particleMounted", status: "ready" }],
    });
  });

  it("prepares the saved backdrop placement and a simulation text fill without changing the source", async () => {
    const source =
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>';
    for (const [definition, placement, sourceKind] of [
      [FROSTED_REFRACTION_EFFECT, "backdrop", "owned-image"],
      [PARTICLE_FLOW_EFFECT, "fill", "editable-text"],
    ] as const) {
      mocks.content = editNativeEffectHtml(source, {
        kind: "apply",
        nodeId: "hero",
        placement,
        definition,
      }).html;
      mocks.state = null;
      const instance = (
        await import("../shared/native-effects.js")
      ).parseEffectsFromHtml(mocks.content).document!.instances[0];
      const caseId = placement === "fill" ? "particleText" : "frostBackdrop";
      const queued = await request.run({
        designId: "design-1",
        fileId: "screen-1",
        expectedVersionHash: "v1",
        cases: [
          {
            caseId,
            instanceId: instance.id,
            nodeId: instance.nodeId,
            definitionId: definition.id,
            definitionVersion: definition.version,
            executionHash: await hashEffectDefinition(definition),
            timeSeconds: 1,
            fixture: {
              sourceKind,
              aspect: "landscape",
              alpha: "opaque",
              rounded: true,
              seed: 77,
            },
          },
        ],
      });
      await claim.run({ designId: "design-1", requestId: queued.requestId });
      const prepared = await prepare.run({
        designId: "design-1",
        requestId: queued.requestId,
      });
      expect(prepared.items).toMatchObject([
        { id: caseId, placement, fixture: { sourceKind } },
      ]);
      expect(
        (await import("../shared/native-effects.js")).parseEffectsFromHtml(
          mocks.content,
        ).document!.instances[0].placement,
      ).toBe(placement);
    }
  });
});
