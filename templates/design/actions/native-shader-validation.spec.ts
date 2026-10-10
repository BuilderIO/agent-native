import { beforeEach, describe, expect, it, vi } from "vitest";

import { editNativeEffectHtml } from "../shared/native-effect-edits.js";
import { PARTICLE_FLOW_EFFECT } from "../shared/native-effect-particle-flow.js";
import {
  FROSTED_REFRACTION_EFFECT,
  GRAIN_GRADIENT_EFFECT,
} from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
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
