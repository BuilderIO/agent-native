import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

import { editNativeEffectHtml } from "@shared/native-effect-edits";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "@shared/native-effect-owned-test-fixtures";
import { PARTICLE_FLOW_EFFECT } from "@shared/native-effect-particle-flow";
import { GRAIN_GRADIENT_EFFECT } from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { parseEffectsFromHtml } from "@shared/native-effects";
import { nativeShaderValidationCaseResultSchema } from "@shared/native-shader-validation";
import type { NativeShaderValidationStatefulSequence } from "@shared/native-shader-validation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const frameMock = vi.hoisted(() => ({
  current: null as HTMLIFrameElement | null,
}));
vi.mock("@/components/design/inspector/native-shader-draft-client", () => ({
  findNativeDraftFrame: () => frameMock.current,
}));

afterEach(() => vi.unstubAllGlobals());

import { validateNativeShaderCaseInEditor as validateCaseInEditor } from "./native-shader-validation-client";

describe("foreground native shader GPU result", () => {
  const validateNativeShaderCaseInEditor = (
    args: Parameters<typeof validateCaseInEditor>[0],
  ) =>
    validateCaseInEditor({
      ...args,
      ...(!args.item.mountedMeasurement && !args.preparedScene
        ? {
            preparedScene: {
              html: frameMock.current!.contentDocument!.documentElement
                .outerHTML,
              approvedDefinitionHashes: [item.executionHash],
              viewport: args.item.mountedFrame?.viewport ?? {
                width: 200,
                height: 180,
              },
              initialPixelRatio: args.item.mountedFrame?.pixelRatio ?? 1,
            },
          }
        : {}),
    });
  let item: {
    caseId: string;
    instanceId: string;
    nodeId: string;
    definitionId: string;
    definitionVersion: number;
    executionHash: string;
    timeSeconds: number;
  };
  let listener: ((event: unknown) => void) | null;
  let renderAt: ReturnType<typeof vi.fn>;
  let liveRenderAtWithPixelRatio: ReturnType<typeof vi.fn>;
  let dedicatedRenderAtWithPixelRatio: ReturnType<typeof vi.fn>;
  let primeHeldViewport: ReturnType<typeof vi.fn>;
  let dedicatedReady: boolean;
  let asyncApproval: boolean;
  let approvalProcessed: boolean;
  let approvalFailure: "approvals-unreadable" | "definition-untrusted" | null;
  let approvedScanCompleted: boolean;
  let renderGolden: ReturnType<typeof vi.fn>;
  let renderValidated: ReturnType<typeof vi.fn>;
  let renderPixels: ReturnType<typeof vi.fn>;
  let beginSession: ReturnType<typeof vi.fn>;
  let endSession: ReturnType<typeof vi.fn>;
  let setSessionParams: ReturnType<typeof vi.fn>;
  let dedicatedFrame: {
    srcdoc: string;
    contentWindow: Window & { __anNativeShaders: Record<string, unknown> };
    remove: ReturnType<typeof vi.fn>;
  };
  let dedicatedWidth: number;
  let changeSourceDuringClone: boolean;
  let detachLiveFrameOnStatus: boolean;
  let liveStatusOverride: {
    backend: "webgpu" | "unavailable";
    status: "error" | "last-good" | "unavailable";
    frames: number;
    code: string;
    message: string;
  } | null;

  beforeEach(async () => {
    const applied = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      },
    );
    const instance = parseEffectsFromHtml(applied.html).document!.instances[0];
    item = {
      caseId: "grain-square",
      instanceId: instance.id,
      nodeId: instance.nodeId,
      definitionId: instance.definitionId,
      definitionVersion: instance.definitionVersion,
      executionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
      timeSeconds: 0,
    };
    listener = null;
    dedicatedWidth = 200;
    changeSourceDuringClone = false;
    detachLiveFrameOnStatus = false;
    liveStatusOverride = null;
    dedicatedReady = true;
    asyncApproval = false;
    approvalProcessed = false;
    approvalFailure = null;
    approvedScanCompleted = false;
    primeHeldViewport = vi.fn().mockImplementation(async () => {
      dedicatedReady = true;
      return { time: 0, rendered: 1, failures: [], renderWallMs: 2 };
    });
    renderAt = vi.fn().mockResolvedValue({
      time: 0,
      rendered: 1,
      failures: [],
      renderWallMs: 2,
    });
    liveRenderAtWithPixelRatio = vi.fn().mockResolvedValue({
      time: 0,
      rendered: 1,
      failures: [],
      renderWallMs: 2,
    });
    dedicatedRenderAtWithPixelRatio = vi
      .fn()
      .mockImplementation(async (time: number) => ({
        time,
        rendered: 1,
        failures: [],
        renderWallMs: 2,
      }));
    renderGolden = vi.fn().mockImplementation(async () => {
      dedicatedReady = true;
      return {
        pixels: {
          width: 400,
          height: 360,
          colorSpace: "srgb",
          alpha: "straight",
          rgba: new Uint8Array(400 * 360 * 4),
        },
        linearGolden: { sampleCount: 1, maxAbsError: 0.001, passed: true },
        mountOutput: {
          scope: "exact-mount-output-linear-premultiplied",
          instanceId: item.instanceId,
          nodeId: item.nodeId,
          definitionId: item.definitionId,
          definitionVersion: item.definitionVersion,
          executionHash: item.executionHash,
          width: 2,
          height: 2,
          pixelSha256: item.executionHash,
          nonTransparentPixels: 0,
          partialAlphaPixels: 0,
          nonZeroRgbaPixels: 0,
        },
      };
    });
    renderPixels = vi.fn().mockImplementation(async () => {
      dedicatedReady = true;
      return {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: new Uint8Array(400 * 360 * 4),
      };
    });
    renderValidated = vi.fn().mockImplementation(async (options, target) => {
      const held = target.expectedLinearSamples
        ? await Reflect.apply(renderGolden, undefined, [options, target])
        : { pixels: await Reflect.apply(renderPixels, undefined, [options]) };
      return {
        ...held,
        ...(!Object.prototype.hasOwnProperty.call(held, "mountOutput")
          ? {
              mountOutput: {
                scope: "exact-mount-output-linear-premultiplied",
                instanceId: item.instanceId,
                nodeId: item.nodeId,
                definitionId: item.definitionId,
                definitionVersion: item.definitionVersion,
                executionHash: item.executionHash,
                width: 2,
                height: 2,
                pixelSha256: item.executionHash,
                nonTransparentPixels: 0,
                partialAlphaPixels: 0,
                nonZeroRgbaPixels: 0,
              },
            }
          : {}),
        ...(target.captureFeedbackState
          ? {
              mountOutput: {
                scope: "exact-mount-output-linear-premultiplied",
                instanceId: item.instanceId,
                nodeId: item.nodeId,
                definitionId: item.definitionId,
                definitionVersion: item.definitionVersion,
                executionHash: item.executionHash,
                width: 2,
                height: 2,
                pixelSha256: item.executionHash,
                nonTransparentPixels: 0,
                partialAlphaPixels: 0,
                nonZeroRgbaPixels: 0,
                feedbackState: {
                  availability: "unavailable",
                  code: "state-uninitialized",
                  followups: {
                    sourceTransition: {
                      availability: "unavailable",
                      code: "second-source-fixture-required",
                    },
                    lifecycleReplay: {
                      availability: "unavailable",
                      code: "multi-action-editor-sequence-required",
                    },
                  },
                },
              },
            }
          : {}),
      };
    });
    beginSession = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    endSession = vi.fn().mockResolvedValue(undefined);
    setSessionParams = vi.fn().mockImplementation(({ params }) => ({
      instanceId: item.instanceId,
      updatedProperties: Object.keys(params),
    }));
    const target = {
      innerWidth: 200,
      innerHeight: 180,
      __anNativeShaders: {
        renderAt,
        renderAtWithPixelRatio: liveRenderAtWithPixelRatio,
        renderCompositionFrameGolden: renderGolden,
        renderCompositionFrameValidated: renderValidated,
        renderCompositionFramePixels: renderPixels,
        beginSimulationExportSession: beginSession,
        endSimulationExportSession: endSession,
        setSimulationExportParameters: setSessionParams,
        profile: (options?: { instanceId: string }) => ({
          ...(options
            ? {
                gpuTargetInstanceId: options.instanceId,
                gpuScope: "target-mount-command-encoder-not-full-scene",
              }
            : {}),
          renderWallMs: { count: 1, p50: 2, p95: 2, p99: 2, max: 2 },
          rafIntervalMs: { count: 0, p50: 0, p95: 0, p99: 0, max: 0 },
          gpu: { kind: "unavailable", code: "timestamp-query-unavailable" },
          textures: {
            allocatedBytes: 4096,
            mountedBytes: 4096,
            queuedRetirementBytes: 0,
            inFlightRetirementBytes: 0,
            sharedBytes: 0,
            unattributedBytes: 0,
            omittedMounts: 0,
          },
        }),
        previewStatus: () => ({
          requestedQuality: "auto",
          frameRateTarget: 60,
          effectivePixelRatio: 1,
        }),
      },
      postMessage: (request: { requestId: string }) => {
        if (detachLiveFrameOnStatus)
          Object.assign(frameMock.current!, { isConnected: false });
        listener?.({
          source: target,
          origin: "http://localhost",
          data: {
            type: "native-shader-status",
            schemaVersion: 1,
            runtimeEpoch: "epoch-1",
            requestId: request.requestId,
            instanceId: instance.id,
            nodeId: "hero",
            backend: liveStatusOverride?.backend ?? "webgpu",
            status: liveStatusOverride?.status ?? "ready",
            frames: liveStatusOverride?.frames ?? 1,
            ...(liveStatusOverride
              ? {
                  code: liveStatusOverride.code,
                  message: liveStatusOverride.message,
                }
              : {}),
            sourceCaptures: 0,
            estimatedResourceBytes: 4096,
            renderWallMs: 2,
          },
        });
      },
    };
    frameMock.current = {
      isConnected: true,
      srcdoc: applied.html,
      getAttribute: (name: string) => (name === "srcdoc" ? applied.html : null),
      contentDocument: { documentElement: { outerHTML: applied.html } },
      contentWindow: target,
    } as unknown as HTMLIFrameElement;
    vi.stubGlobal("document", {
      createElement: () => {
        const listeners = new Map<string, () => void>();
        const cloneTarget = {
          ...target,
          innerWidth: dedicatedWidth,
          innerHeight: 180,
          __anNativeShaders: {
            ...target.__anNativeShaders,
            scan: vi.fn().mockImplementation(async () => {
              if (asyncApproval) {
                if (!approvalProcessed)
                  throw Object.assign(new Error("approvals-pending"), {
                    code: "approvals-pending",
                  });
                approvedScanCompleted = true;
              }
            }),
            renderAt: primeHeldViewport,
            renderAtWithPixelRatio: dedicatedRenderAtWithPixelRatio,
            dispose: vi.fn(),
          },
          postMessage: vi.fn(
            (request: { type: string; requestId?: string }) => {
              if (request.type === "native-shader-approvals") {
                if (asyncApproval)
                  queueMicrotask(() => (approvalProcessed = true));
                return;
              }
              const reply = () => {
                const pending = asyncApproval && !approvedScanCompleted;
                const code = asyncApproval
                  ? !approvalProcessed
                    ? "approvals-pending"
                    : (approvalFailure ??
                      (pending ? "approvals-pending" : undefined))
                  : undefined;
                listener?.({
                  source: cloneTarget,
                  origin: "http://localhost",
                  data: {
                    type: "native-shader-status",
                    schemaVersion: 1,
                    runtimeEpoch: "epoch-dedicated",
                    requestId: request.requestId,
                    instanceId: item.instanceId,
                    nodeId: item.nodeId,
                    backend: code ? "unavailable" : "webgpu",
                    status: code
                      ? "error"
                      : dedicatedReady
                        ? "ready"
                        : "unavailable",
                    ...(code ? { code, message: code } : {}),
                    frames: dedicatedReady && !code ? 1 : 0,
                    sourceCaptures: 0,
                    estimatedResourceBytes: 4096,
                    renderWallMs: 2,
                  },
                });
              };
              if (asyncApproval) queueMicrotask(reply);
              else reply();
            },
          ),
        };
        dedicatedFrame = {
          srcdoc: "",
          style: { cssText: "" },
          setAttribute: vi.fn(),
          addEventListener: (name: string, callback: () => void) =>
            listeners.set(name, callback),
          removeEventListener: (name: string) => listeners.delete(name),
          contentDocument: frameMock.current!.contentDocument,
          contentWindow: cloneTarget,
          remove: vi.fn(),
        } as unknown as typeof dedicatedFrame;
        Object.assign(dedicatedFrame, { listeners });
        return dedicatedFrame;
      },
      body: {
        append: (frame: { listeners: Map<string, () => void> }) => {
          if (changeSourceDuringClone)
            Object.assign(frameMock.current!, { srcdoc: "changed-source" });
          queueMicrotask(() => frame.listeners.get("load")?.());
        },
      },
    });
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      setTimeout,
      clearTimeout,
      addEventListener: (_name: string, handler: (event: unknown) => void) => {
        listener = handler;
      },
      removeEventListener: () => {
        listener = null;
      },
    });
  });

  it("reports ready only after exact source hash, strict render, and same-window status", async () => {
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      status: "ready",
      backend: "webgpu",
      frames: 1,
      estimatedResourceBytes: 4096,
      sceneProfile: {
        state: "available",
        scope: "mounted-scene",
        gpu: { kind: "unavailable", code: "timestamp-query-unavailable" },
      },
    });
    expect(dedicatedRenderAtWithPixelRatio).toHaveBeenCalledWith(0, 1);
    expect(liveRenderAtWithPixelRatio).not.toHaveBeenCalled();
    expect(renderAt).not.toHaveBeenCalled();
    expect(
      dedicatedFrame.contentWindow.postMessage as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "native-shader-editor-preview-policy" }),
      expect.anything(),
    );
  });

  it("returns a typed unavailable result when ordinary validation lacks prepared source", async () => {
    const result = await validateCaseInEditor({
      fileId: "screen-1",
      item,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      code: "validation-source-unavailable",
    });
    expect(dedicatedRenderAtWithPixelRatio).not.toHaveBeenCalled();
    expect(liveRenderAtWithPixelRatio).not.toHaveBeenCalled();
    expect(renderAt).not.toHaveBeenCalled();
  });

  it("rejects a stale executable hash without calling WebGPU", async () => {
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, executionHash: "0".repeat(64) },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ status: "unavailable", code: "frame-source-stale" });
    expect(renderAt).not.toHaveBeenCalled();
  });

  const mountedFrame = {
    viewport: { width: 200, height: 180 },
    pixelRatio: 2,
  };
  const expectedLinearSamples = [
    {
      x: 399,
      y: 359,
      expected: [0.25, 0.5, 1, 0.8] as [number, number, number, number],
      tolerance: 0.005,
    },
  ];

  it("returns requested full-scene RGBA8 samples with request and frame provenance", async () => {
    const rgba = new Uint8Array(400 * 360 * 4);
    const put = (
      x: number,
      y: number,
      value: [number, number, number, number],
    ) => {
      rgba.set(value, (y * 400 + x) * 4);
    };
    put(2, 3, [18, 91, 203, 255]);
    put(399, 359, [7, 8, 9, 0]);
    renderValidated.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba,
      },
      mountOutput: {
        scope: "exact-mount-output-linear-premultiplied",
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        width: 2,
        height: 2,
        pixelSha256: item.executionHash,
        nonTransparentPixels: 0,
        partialAlphaPixels: 0,
        nonZeroRgbaPixels: 0,
      },
    });
    const requestId = "00000000-0000-4000-8000-000000000001";
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: {
        ...item,
        mountedFrame,
        scenePixelSampleCoordinates: [
          { x: 2, y: 3 },
          { x: 399, y: 359 },
        ],
      },
      requestId,
      expectedVersionHash: "source-v1",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ready");
    expect(result.fullScenePixelSamples).toEqual({
      scope: "full-scene-composition-srgb-straight-u8",
      requestId,
      sourceVersionHash: "source-v1",
      frameIndex: 0,
      timeSeconds: 0,
      width: 400,
      height: 360,
      pixelRatio: 2,
      colorSpace: "srgb",
      alpha: "straight",
      samples: [
        { x: 2, y: 3, rgba8: [18, 91, 203, 255] },
        { x: 399, y: 359, rgba8: [7, 8, 9, 0] },
      ],
    });
    expect(result.linearGolden).toBeUndefined();
  });

  it("fails the full-scene sample request instead of returning a partial set", async () => {
    renderValidated.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: new Uint8Array(400 * 360 * 4 - 1),
      },
      mountOutput: {
        scope: "exact-mount-output-linear-premultiplied",
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        width: 2,
        height: 2,
        pixelSha256: item.executionHash,
        nonTransparentPixels: 0,
        partialAlphaPixels: 0,
        nonZeroRgbaPixels: 0,
      },
    });
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: {
        ...item,
        mountedFrame,
        scenePixelSampleCoordinates: [{ x: 2, y: 3 }],
      },
      requestId: "00000000-0000-4000-8000-000000000001",
      expectedVersionHash: "source-v1",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("error");
    expect(result.fullScenePixelSamples).toBeUndefined();
    expect(result.code).toBe("mounted-frame-pixels-unreadable");
  });

  async function selectParticleFlow(): Promise<void> {
    const applied = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "fill",
        definition: PARTICLE_FLOW_EFFECT,
      },
    );
    const instance = parseEffectsFromHtml(applied.html).document!.instances[0];
    item = {
      ...item,
      instanceId: instance.id,
      definitionId: instance.definitionId,
      definitionVersion: instance.definitionVersion,
      executionHash: await hashEffectDefinition(PARTICLE_FLOW_EFFECT),
    };
    const originalTarget = frameMock.current!.contentWindow as unknown as {
      __anNativeShaders: Record<string, unknown>;
    };
    const target = {
      ...originalTarget,
      postMessage: (request: { requestId: string }) => {
        listener?.({
          source: target,
          origin: "http://localhost",
          data: {
            type: "native-shader-status",
            schemaVersion: 1,
            runtimeEpoch: "epoch-1",
            requestId: request.requestId,
            instanceId: instance.id,
            nodeId: "hero",
            backend: "webgpu",
            status: "ready",
            frames: 1,
            sourceCaptures: 0,
            estimatedResourceBytes: 4096,
            renderWallMs: 2,
          },
        });
      },
    };
    frameMock.current = {
      isConnected: true,
      srcdoc: applied.html,
      getAttribute: (name: string) => (name === "srcdoc" ? applied.html : null),
      contentDocument: { documentElement: { outerHTML: applied.html } },
      contentWindow: target,
    } as unknown as HTMLIFrameElement;
  }

  async function selectFeedbackDefinition(): Promise<void> {
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
    const applied = editNativeEffectHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      {
        kind: "apply",
        nodeId: "hero",
        placement: "layer",
        definition: feedbackDefinition,
        params: { phase: 12, pigment: 0.8 },
      },
    );
    if (applied.errors.length) throw new Error(applied.errors.join("; "));
    const parsedFeedback = parseEffectsFromHtml(applied.html);
    if (!parsedFeedback.document)
      throw new Error(
        parsedFeedback.errors.join("; ") || "no feedback manifest",
      );
    const instance = parsedFeedback.document.instances[0];
    item = {
      ...item,
      instanceId: instance.id,
      definitionId: instance.definitionId,
      definitionVersion: instance.definitionVersion,
      executionHash: await hashEffectDefinition(feedbackDefinition),
    };
    const originalTarget = frameMock.current!.contentWindow as unknown as {
      __anNativeShaders: Record<string, unknown>;
    };
    const target = {
      ...originalTarget,
      postMessage: (request: { requestId: string }) => {
        listener?.({
          source: target,
          origin: "http://localhost",
          data: {
            type: "native-shader-status",
            schemaVersion: 1,
            runtimeEpoch: "epoch-feedback",
            requestId: request.requestId,
            instanceId: instance.id,
            nodeId: "hero",
            backend: "webgpu",
            status: "ready",
            frames: 1,
            sourceCaptures: 0,
            estimatedResourceBytes: 4096,
            renderWallMs: 2,
          },
        });
      },
    };
    frameMock.current = {
      ...frameMock.current,
      srcdoc: applied.html,
      getAttribute: (name: string) => (name === "srcdoc" ? applied.html : null),
      contentDocument: { documentElement: { outerHTML: applied.html } },
      contentWindow: target,
    } as unknown as HTMLIFrameElement;
  }

  function addParticleFlowSibling(): void {
    const frame = frameMock.current!;
    const source = frame.srcdoc.replace(
      "</body>",
      '<div data-agent-native-node-id="particle">Particle</div></body>',
    );
    const applied = editNativeEffectHtml(source, {
      kind: "apply",
      nodeId: "particle",
      placement: "fill",
      definition: PARTICLE_FLOW_EFFECT,
    });
    frameMock.current = {
      ...frame,
      srcdoc: applied.html,
      getAttribute: (name: string) => (name === "srcdoc" ? applied.html : null),
      contentDocument: { documentElement: { outerHTML: applied.html } },
    } as unknown as HTMLIFrameElement;
  }

  it("requires a held frame when another enabled mount is persistent", async () => {
    addParticleFlowSibling();
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      code: "stateful-frame-required",
    });
    expect(renderAt).not.toHaveBeenCalled();
  });

  it("replays the whole scene for an ordinary target beside an already advancing persistent mount", async () => {
    addParticleFlowSibling();
    primeHeldViewport.mockRejectedValueOnce(
      Object.assign(new Error("Cannot seek feedback backward."), {
        code: "feedback-seek-backward",
      }),
    );
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, timeSeconds: 2 / 60, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: "ready", backend: "webgpu" });
    expect(primeHeldViewport).not.toHaveBeenCalled();
    expect(beginSession).toHaveBeenCalledWith(
      expect.objectContaining({ fps: 60, totalFrames: 3 }),
    );
    expect(
      renderPixels.mock.calls.map(([options]) => options.frameIndex),
    ).toEqual([0, 1, 2]);
    expect(
      renderPixels.mock.calls.every(
        ([options]) => options.simulationSessionId === "session-1",
      ),
    ).toBe(true);
    expect(endSession).toHaveBeenCalledWith("session-1", { timeoutMs: 30_000 });
  });

  it("requires a bounded held frame for persistent state", async () => {
    await selectParticleFlow();
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ status: "unavailable", code: "stateful-frame-required" });
    expect(renderAt).not.toHaveBeenCalled();
  });

  it("replays stateful frames in order and restores the live session", async () => {
    await selectParticleFlow();
    primeHeldViewport.mockRejectedValueOnce(
      Object.assign(new Error("Cannot seek feedback backward."), {
        code: "feedback-seek-backward",
      }),
    );
    const calls: string[] = [];
    beginSession.mockImplementation(async () => {
      calls.push("begin");
      return { sessionId: "session-1" };
    });
    renderPixels.mockImplementation(
      async ({ frameIndex }: { frameIndex: number }) => {
        calls.push(`pixels-${frameIndex}`);
        return {
          width: 400,
          height: 360,
          colorSpace: "srgb",
          alpha: "straight",
          rgba: new Uint8Array(400 * 360 * 4),
        };
      },
    );
    renderGolden.mockImplementation(
      async ({ frameIndex }: { frameIndex: number }) => {
        calls.push(`golden-${frameIndex}`);
        return {
          pixels: {
            width: 400,
            height: 360,
            colorSpace: "srgb",
            alpha: "straight",
            rgba: new Uint8Array(400 * 360 * 4),
          },
          linearGolden: { sampleCount: 1, maxAbsError: 0.001, passed: true },
        };
      },
    );
    endSession.mockImplementation(async () => {
      calls.push("end");
    });
    const signal = new AbortController().signal;
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: {
        ...item,
        timeSeconds: 2 / 60,
        mountedFrame,
        expectedLinearSamples,
      },
      signal,
    });
    expect(result).toMatchObject({
      status: "ready",
      linearGolden: { passed: true },
    });
    expect(calls).toEqual(["begin", "pixels-0", "pixels-1", "golden-2", "end"]);
    expect(beginSession).toHaveBeenCalledWith({
      fps: 60,
      totalFrames: 3,
      startTimeSeconds: 0,
      signal,
      timeoutMs: 30_000,
    });
    expect(renderAt).not.toHaveBeenCalled();
    expect(primeHeldViewport).not.toHaveBeenCalled();
    expect(renderGolden.mock.calls[0][0].simulationSessionId).toBe("session-1");
  });

  it("runs fixed advances, parameter edits, and zero-dt captures in one held feedback session", async () => {
    await selectFeedbackDefinition();
    const sequence: NativeShaderValidationStatefulSequence = [
      { kind: "advance", stepId: "initial" },
      {
        kind: "capture",
        stepId: "initial_identity",
        compare: {
          referenceStepId: "initial",
          feedbackState: "same",
          pixels: "same",
        },
      },
      { kind: "advance", stepId: "at_one" },
      {
        kind: "capture",
        stepId: "advance_same_state",
        compare: { referenceStepId: "initial", feedbackState: "same" },
      },
      { kind: "set-params", stepId: "pigment", params: { pigment: 0.4 } },
      {
        kind: "capture",
        stepId: "control_response",
        compare: {
          referenceStepId: "at_one",
          feedbackState: "same",
          pixels: "different",
        },
      },
      {
        kind: "capture",
        stepId: "control_identity",
        compare: {
          referenceStepId: "control_response",
          feedbackState: "same",
          pixels: "same",
        },
      },
      { kind: "set-params", stepId: "seed_change", params: { phase: 42 } },
      {
        kind: "capture",
        stepId: "seed_reset",
        compare: { referenceStepId: "at_one", feedbackState: "different" },
      },
      { kind: "set-params", stepId: "seed_replay", params: { phase: 12 } },
      {
        kind: "capture",
        stepId: "seed_replay_state",
        compare: { referenceStepId: "at_one", feedbackState: "same" },
      },
    ];
    const stateHashes = ["1", "1", "1", "1", "1", "1", "3", "1"];
    const targetPixelHashes = ["1", "1", "1", "1", "2", "2", "3", "1"];
    const pixelMarkers = [0, 0, 0, 0, 1, 1, 2, 0];
    let renderedIndex = 0;
    renderValidated.mockImplementation(async (options) => {
      const index = renderedIndex++;
      const rgba = new Uint8Array(400 * 360 * 4);
      rgba[0] = pixelMarkers[index] ?? 0;
      const stepIndex = [0, 0, 1, 1, 1, 1, 1, 1][index] ?? 1;
      return {
        pixels: {
          width: 400,
          height: 360,
          colorSpace: "srgb",
          alpha: "straight",
          rgba,
        },
        mountOutput: {
          scope: "exact-mount-output-linear-premultiplied",
          instanceId: item.instanceId,
          nodeId: item.nodeId,
          definitionId: item.definitionId,
          definitionVersion: item.definitionVersion,
          executionHash: item.executionHash,
          width: 2,
          height: 2,
          pixelSha256: (targetPixelHashes[index] ?? "1").repeat(64),
          nonTransparentPixels: 0,
          partialAlphaPixels: 0,
          nonZeroRgbaPixels: 0,
          feedbackState: {
            availability: "available",
            scope: "exact-feedback-state-linear-rgba16f",
            width: 16,
            height: 2,
            completedStep: stepIndex,
            byteLength: 16 * 2 * 8,
            sha256: (stateHashes[index] ?? "1").repeat(64),
            followups: {
              sourceTransition: {
                availability: "unavailable",
                code: "second-source-fixture-required",
              },
              lifecycleReplay: {
                availability: "unavailable",
                code: "multi-action-editor-sequence-required",
              },
            },
          },
        },
      };
    });
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: {
        ...item,
        timeSeconds: 1 / 60,
        mountedFrame,
        captureFeedbackState: true,
        statefulSequence: sequence,
      },
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ready");
    expect(result.statefulRenderMode).toBe("same-held-session-sequence");
    expect(result.statefulSequence).toHaveLength(11);
    expect(result.statefulSequence?.[0]).toMatchObject({
      stepId: "initial",
      mountOutput: {
        feedbackState: { completedStep: 0, sha256: "1".repeat(64) },
      },
    });
    expect(result.statefulSequence?.[3]).toMatchObject({
      stepId: "advance_same_state",
      mountOutput: {
        feedbackState: { completedStep: 1, sha256: "1".repeat(64) },
      },
      comparisons: [{ expected: "same", observed: "same", passed: true }],
    });
    expect(beginSession).toHaveBeenCalledWith(
      expect.objectContaining({ fps: 60, totalFrames: 2, startTimeSeconds: 0 }),
    );
    expect(
      renderValidated.mock.calls.map(([options]) => [
        options.frameIndex,
        options.repeatCurrentSimulationFrame === true,
      ]),
    ).toEqual([
      [0, false],
      [0, true],
      [1, false],
      [1, true],
      [1, true],
      [1, true],
      [1, true],
      [1, true],
    ]);
    expect(setSessionParams.mock.calls.map(([args]) => args.params)).toEqual([
      { pigment: 0.4 },
      { phase: 42 },
      { phase: 12 },
    ]);
    expect(
      result.statefulSequence
        ?.filter((step) => step.kind !== "set-params")
        .flatMap((step) => step.comparisons)
        .every((comparison) => comparison.passed),
    ).toBe(true);
    expect(endSession).toHaveBeenCalledWith("session-1", { timeoutMs: 30_000 });
  });

  it("captures numeric goldens at stateless controls and reports typed mismatches", async () => {
    const sequence: NativeShaderValidationStatefulSequence = [
      { kind: "advance", stepId: "initial" },
      { kind: "set-params", stepId: "scale", params: { scale: 2 } },
      {
        kind: "capture",
        stepId: "scale_capture",
        expectedLinearSamples: expectedLinearSamples,
      },
    ];
    const requestItem = {
      ...item,
      mountedFrame,
      statefulSequence: sequence,
      timeSeconds: 0,
    };
    const passed = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: requestItem,
      signal: new AbortController().signal,
    });
    expect(passed.status).toBe("ready");
    expect(passed.statefulSequence?.[2]).toMatchObject({
      kind: "capture",
      linearGolden: { sampleCount: 1, passed: true },
    });
    expect(beginSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetInstanceIds: [item.instanceId] }),
    );
    expect(
      renderValidated.mock.calls[renderValidated.mock.calls.length - 1]?.[1],
    ).toMatchObject({
      expectedLinearSamples,
    });
    expect(endSession).toHaveBeenCalledOnce();

    renderGolden.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: new Uint8Array(400 * 360 * 4),
      },
      linearGolden: { sampleCount: 1, maxAbsError: 2, passed: false },
      mountOutput: {
        scope: "exact-mount-output-linear-premultiplied",
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        width: 2,
        height: 2,
        pixelSha256: item.executionHash,
        nonTransparentPixels: 0,
        partialAlphaPixels: 0,
        nonZeroRgbaPixels: 0,
      },
    });
    const failed = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: requestItem,
      signal: new AbortController().signal,
    });
    expect(failed).toMatchObject({
      status: "error",
      code: "linear-golden-failed",
    });
    expect(endSession).toHaveBeenCalledTimes(2);
  });

  it("compares stateful pixel changes against the exact mounted output", async () => {
    await selectFeedbackDefinition();
    const sequence: NativeShaderValidationStatefulSequence = [
      { kind: "advance", stepId: "reference" },
      {
        kind: "capture",
        stepId: "unrelated-composition-change",
        compare: { referenceStepId: "reference", pixels: "same" },
      },
      {
        kind: "capture",
        stepId: "target-output-change",
        compare: { referenceStepId: "reference", pixels: "different" },
      },
      {
        kind: "capture",
        stepId: "target-dimension-change",
        compare: { referenceStepId: "reference", pixels: "different" },
      },
    ];
    const compositionMarkers = [0, 1, 0, 0];
    const outputHashes = ["a", "a", "b", "a"];
    const outputWidths = [2, 2, 2, 3];
    let renderedIndex = 0;
    renderValidated.mockImplementation(async () => {
      const index = renderedIndex++;
      const rgba = new Uint8Array(400 * 360 * 4);
      rgba[0] = compositionMarkers[index] ?? 0;
      return {
        pixels: {
          width: 400,
          height: 360,
          colorSpace: "srgb",
          alpha: "straight",
          rgba,
        },
        mountOutput: {
          scope: "exact-mount-output-linear-premultiplied",
          instanceId: item.instanceId,
          nodeId: item.nodeId,
          definitionId: item.definitionId,
          definitionVersion: item.definitionVersion,
          executionHash: item.executionHash,
          width: outputWidths[index] ?? 2,
          height: 2,
          pixelSha256: (outputHashes[index] ?? "a").repeat(64),
          nonTransparentPixels: 1,
          partialAlphaPixels: 0,
          nonZeroRgbaPixels: 1,
          feedbackState: {
            availability: "available",
            scope: "exact-feedback-state-linear-rgba16f",
            width: 2,
            height: 2,
            completedStep: 0,
            byteLength: 2 * 2 * 8,
            sha256: "c".repeat(64),
            followups: {
              sourceTransition: {
                availability: "unavailable",
                code: "second-source-fixture-required",
              },
              lifecycleReplay: {
                availability: "unavailable",
                code: "multi-action-editor-sequence-required",
              },
            },
          },
        },
      };
    });

    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: {
        ...item,
        timeSeconds: 0,
        mountedFrame,
        captureFeedbackState: true,
        statefulSequence: sequence,
      },
      signal: new AbortController().signal,
    });

    expect(result.statefulSequence?.[1]).toMatchObject({
      stepId: "unrelated-composition-change",
      comparisons: [{ subject: "pixels", observed: "same", passed: true }],
    });
    expect(result.statefulSequence?.[2]).toMatchObject({
      stepId: "target-output-change",
      comparisons: [{ subject: "pixels", observed: "different", passed: true }],
    });
    expect(result.statefulSequence?.[3]).toMatchObject({
      stepId: "target-dimension-change",
      comparisons: [{ subject: "pixels", observed: "different", passed: true }],
    });
  });

  it("keeps scene coverage distinct from exact mounted zero output", async () => {
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "ready",
      pixelWidth: 400,
      pixelHeight: 360,
      mountOutput: {
        instanceId: item.instanceId,
        width: 2,
        height: 2,
        nonTransparentPixels: 0,
        nonZeroRgbaPixels: 0,
      },
    });
    expect(renderValidated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ executionHash: item.executionHash }),
    );
  });

  it("requires and preserves the typed feedback-state readback result", async () => {
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame, captureFeedbackState: true },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "ready",
      mountOutput: {
        feedbackState: {
          availability: "unavailable",
          code: "state-uninitialized",
          followups: {
            sourceTransition: {
              availability: "unavailable",
              code: "second-source-fixture-required",
            },
            lifecycleReplay: {
              availability: "unavailable",
              code: "multi-action-editor-sequence-required",
            },
          },
        },
      },
    });
    expect(renderValidated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        executionHash: item.executionHash,
        captureFeedbackState: true,
      }),
    );
  });

  it("reads feedback state from the exact held mount output", async () => {
    const feedbackState = {
      availability: "available" as const,
      scope: "exact-feedback-state-linear-rgba16f" as const,
      width: 16,
      height: 2,
      completedStep: 0,
      byteLength: 256,
      sha256: item.executionHash,
      followups: {
        sourceTransition: {
          availability: "unavailable" as const,
          code: "second-source-fixture-required" as const,
        },
        lifecycleReplay: {
          availability: "unavailable" as const,
          code: "multi-action-editor-sequence-required" as const,
        },
      },
    };
    renderValidated.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: new Uint8Array(400 * 360 * 4),
      },
      mountOutput: {
        scope: "exact-mount-output-linear-premultiplied",
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        width: 2,
        height: 2,
        pixelSha256: item.executionHash,
        nonTransparentPixels: 0,
        partialAlphaPixels: 0,
        nonZeroRgbaPixels: 0,
        feedbackState,
      },
    });

    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame, captureFeedbackState: true },
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ready");
    expect(result.mountOutput?.feedbackState).toEqual(feedbackState);
  });

  it("refuses missing or wrong-identity mounted output summaries", async () => {
    for (const mountOutput of [undefined, { bad: true }]) {
      renderValidated.mockResolvedValueOnce({
        pixels: {
          width: 400,
          height: 360,
          colorSpace: "srgb",
          alpha: "straight",
          rgba: new Uint8Array(400 * 360 * 4),
        },
        mountOutput,
      });
      const result = await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame },
        signal: new AbortController().signal,
      });
      expect(result.status).not.toBe("ready");
      expect(result).not.toHaveProperty("mountOutput");
    }
  });

  it("can validate stateful mounted status without a float golden", async () => {
    await selectParticleFlow();
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "ready",
      pixelWidth: 400,
      pixelHeight: 360,
    });
    expect(result).not.toHaveProperty("linearGolden");
    expect(renderPixels).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledWith("session-1", { timeoutMs: 30_000 });
  });

  it("counts alpha coverage in a held whole scene, including opaque black", async () => {
    const empty = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(empty).toMatchObject({
      status: "ready",
      nonTransparentPixels: 0,
      partialAlphaPixels: 0,
    });

    const rgba = new Uint8Array(400 * 360 * 4);
    rgba.set([0, 0, 0, 255], 0);
    rgba.set([0, 0, 0, 128], 4);
    rgba.set([255, 255, 255, 0], 8);
    renderPixels.mockResolvedValueOnce({
      width: 400,
      height: 360,
      colorSpace: "srgb",
      alpha: "straight",
      rgba,
    });
    const covered = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(covered).toMatchObject({
      status: "ready",
      pixelWidth: 400,
      pixelHeight: 360,
      nonTransparentPixels: 2,
      partialAlphaPixels: 1,
    });
    expect(covered.pixelSha256).not.toBe(empty.pixelSha256);
    expect(
      nativeShaderValidationCaseResultSchema.safeParse(covered).success,
    ).toBe(true);
    expect(
      nativeShaderValidationCaseResultSchema.safeParse({
        ...covered,
        nonTransparentPixels: 400 * 360 + 1,
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseResultSchema.safeParse({
        ...covered,
        partialAlphaPixels: 3,
      }).success,
    ).toBe(false);
  });

  it("uses canonical prepared HTML instead of editor scripts in the held viewport", async () => {
    frameMock.current!.srcdoc += "<script>window.editorChrome = true</script>";
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ready");
    expect(dedicatedFrame.srcdoc).not.toContain("editorChrome");
    expect(dedicatedFrame.srcdoc).toContain("data-agent-native-node-id");
  });

  it("requires a prepared scene before creating a held viewport", async () => {
    const result = await validateCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      code: "mounted-viewport-source-unavailable",
    });
    expect(renderPixels).not.toHaveBeenCalled();
  });

  it("does not grant a mounted effect missing from the prepared approval set", async () => {
    const result = await validateCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      preparedScene: {
        html: frameMock.current!.contentDocument!.documentElement.outerHTML,
        approvedDefinitionHashes: [],
        viewport: mountedFrame.viewport,
        initialPixelRatio: mountedFrame.pixelRatio,
      },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      code: "mounted-viewport-source-unavailable",
    });
    expect(renderPixels).not.toHaveBeenCalled();
  });

  it("reports a failed stateful frame and cleanup together without a ready result", async () => {
    await selectParticleFlow();
    renderGolden.mockRejectedValueOnce(
      Object.assign(new Error("An authored script can change pixels."), {
        code: "composition-scripted-source",
      }),
    );
    endSession.mockRejectedValueOnce(
      Object.assign(new Error("The requested frame did not complete."), {
        code: "simulation-session-incomplete",
      }),
    );
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      status: "error",
      code: "composition-scripted-source",
      message: "An authored script can change pixels.",
      cleanupCode: "simulation-session-incomplete",
      cleanupMessage: "The requested frame did not complete.",
    });
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["error", "input-resource-missing", "error"],
    ["last-good", "gpu-validation", "unavailable"],
    ["unavailable", "render-pending", "unavailable"],
  ] as const)(
    "keeps an exact live target %s diagnostic %s without claiming mounted pixels",
    async (status, code, expectedStatus) => {
      liveStatusOverride = {
        backend: status === "unavailable" ? "unavailable" : "webgpu",
        status,
        frames: 0,
        code,
        message: `Exact target: ${code}`,
      };
      const result = await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({
        status: expectedStatus,
        backend: "unavailable",
        code,
        message: `Exact target: ${code}`,
        frames: 0,
      });
      expect(result.mountOutput).toBeUndefined();
      expect(result.linearGolden).toBeUndefined();
      expect(result.pixelSha256).toBeUndefined();
      expect(renderGolden).not.toHaveBeenCalled();
      expect(renderPixels).not.toHaveBeenCalled();
      expect(
        nativeShaderValidationCaseResultSchema.safeParse(result).success,
      ).toBe(true);
    },
  );

  it("refuses a typed live error if the source frame detaches during status lookup", async () => {
    liveStatusOverride = {
      backend: "webgpu",
      status: "error",
      frames: 0,
      code: "input-resource-missing",
      message: "Required incoming input is missing.",
    };
    detachLiveFrameOnStatus = true;
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      code: "frame-source-stale",
    });
    expect(renderPixels).not.toHaveBeenCalled();
  });

  it("renders an offscreen held target in the held capture before checking readiness", async () => {
    dedicatedReady = false;
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame, expectedLinearSamples },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: "ready", backend: "webgpu" });
    expect(primeHeldViewport).not.toHaveBeenCalled();
    expect(renderGolden).toHaveBeenCalledTimes(1);
    expect(renderAt).not.toHaveBeenCalled();
  });

  it("does not report ready if the actual held capture leaves the target unavailable", async () => {
    dedicatedReady = false;
    renderGolden.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: new Uint8Array(400 * 360 * 4),
      },
      linearGolden: { sampleCount: 1, maxAbsError: 0.001, passed: true },
    });
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame, expectedLinearSamples },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      code: "render-failed",
    });
    expect(renderGolden).toHaveBeenCalledTimes(1);
    expect(primeHeldViewport).not.toHaveBeenCalled();
    expect(dedicatedFrame.remove).toHaveBeenCalledTimes(1);
  });

  it("waits for queued approval and scanning before the held capture", async () => {
    asyncApproval = true;
    dedicatedReady = false;
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame, expectedLinearSamples },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: "ready", backend: "webgpu" });
    expect(approvalProcessed).toBe(true);
    expect(approvedScanCompleted).toBe(true);
    const messages = (
      dedicatedFrame.contentWindow.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map(([request]) => request.type);
    expect(messages.slice(0, 3)).toEqual([
      "native-shader-approvals",
      "native-shader-status-request",
      "native-shader-status-request",
    ]);
    expect(primeHeldViewport).not.toHaveBeenCalled();
    expect(renderGolden).toHaveBeenCalledTimes(1);
  });

  it.each(["approvals-unreadable", "definition-untrusted"] as const)(
    "does not render a held frame when approval is %s",
    async (code) => {
      asyncApproval = true;
      approvalFailure = code;
      const result = await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({ status: "unavailable", code });
      expect(approvedScanCompleted).toBe(true);
      expect(primeHeldViewport).not.toHaveBeenCalled();
      expect(renderGolden).not.toHaveBeenCalled();
      expect(dedicatedFrame.remove).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a failed held initialization distinct from a completed comparison", async () => {
    renderGolden.mockRejectedValueOnce(
      Object.assign(new Error("Held shader compilation failed."), {
        code: "shader-compile-failed",
      }),
    );
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame, expectedLinearSamples },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "error",
      code: "shader-compile-failed",
    });
    expect(primeHeldViewport).not.toHaveBeenCalled();
    expect(dedicatedFrame.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps an iframe-realm native render diagnostic when held initialization fails", async () => {
    renderGolden.mockRejectedValueOnce(
      runInNewContext(`Object.assign(new Error("native render incomplete"), {
        code: "native-render-incomplete",
        result: { failures: [{
          code: "shader-compile-failed",
          message: "WGSL line 165: cannot assign to let value",
          instanceId: "grain-instance"
        }] }
      })`),
    );
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, mountedFrame, expectedLinearSamples },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "error",
      code: "shader-compile-failed",
      message: "WGSL line 165: cannot assign to let value",
    });
    expect(primeHeldViewport).not.toHaveBeenCalled();
    expect(dedicatedFrame.remove).toHaveBeenCalledTimes(1);
  });

  it("holds the exact mounted frame and returns only bounded float summary and pixel identity", async () => {
    const signal = new AbortController().signal;
    const result = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: { ...item, timeSeconds: 1.5, mountedFrame, expectedLinearSamples },
      signal,
    });
    expect(renderGolden).toHaveBeenCalledWith(
      {
        frameIndex: 90,
        fps: 60,
        startTimeSeconds: 0,
        sourceContract: "declarative-only",
        viewport: mountedFrame.viewport,
        pixelRatio: 2,
        signal,
        timeoutMs: 30_000,
      },
      {
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        expectedLinearSamples,
      },
    );
    expect(renderAt).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      backend: "webgpu",
      status: "ready",
      linearGolden: { sampleCount: 1, passed: true, maxAbsError: 0.001 },
      pixelWidth: 400,
      pixelHeight: 360,
    });
    expect(result.pixelSha256).toBe(
      createHash("sha256")
        .update(new Uint8Array(400 * 360 * 4))
        .digest("hex"),
    );
    expect(result).not.toHaveProperty("rgba");
    expect(JSON.stringify(result)).not.toContain("Uint8Array");
    expect(dedicatedFrame.contentWindow.innerWidth).toBe(200);
    expect(dedicatedFrame.contentWindow.innerHeight).toBe(180);
    expect(
      dedicatedFrame.contentWindow.__anNativeShaders.scan,
    ).toHaveBeenCalled();
    expect(dedicatedFrame.contentWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "native-shader-approvals",
        status: "ready",
        hashes: [item.executionHash],
      },
      "http://localhost",
    );
    expect(
      dedicatedFrame.contentWindow.__anNativeShaders.dispose,
    ).toHaveBeenCalledTimes(1);
    expect(dedicatedFrame.remove).toHaveBeenCalledTimes(1);
    expect(frameMock.current?.isConnected).toBe(true);
  });

  it("refuses a clone with the wrong CSS viewport before held pixel work", async () => {
    dedicatedWidth = 1440;
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      status: "unavailable",
      code: "mounted-viewport-mismatch",
    });
    expect(renderGolden).not.toHaveBeenCalled();
    expect(dedicatedFrame.remove).toHaveBeenCalledTimes(1);
  });

  it("refuses a source swap during clone creation before held pixel work", async () => {
    changeSourceDuringClone = true;
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      status: "unavailable",
      code: "mounted-viewport-source-stale",
    });
    expect(renderGolden).not.toHaveBeenCalled();
    expect(dedicatedFrame.remove).toHaveBeenCalledTimes(1);
  });

  it("accepts byte readback from the iframe realm without an instanceof check", async () => {
    renderGolden.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: runInNewContext("new Uint8Array(400 * 360 * 4)"),
      },
      linearGolden: { sampleCount: 1, maxAbsError: 0, passed: true },
    });
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ status: "ready", pixelWidth: 400, pixelHeight: 360 });
  });

  it("rejects a stale mounted target before held GPU work", async () => {
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: {
          ...item,
          executionHash: "0".repeat(64),
          mountedFrame,
          expectedLinearSamples,
        },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ status: "unavailable", code: "frame-source-stale" });
    expect(renderGolden).not.toHaveBeenCalled();
  });

  it("rejects malformed live benchmark payloads and accepts only the exact window", async () => {
    const runtime = (
      frameMock.current!.contentWindow as unknown as {
        __anNativeShaders: Record<string, unknown>;
      }
    ).__anNativeShaders;
    const measureMountedScene = vi.fn();
    runtime.measureMountedScene = measureMountedScene;
    const measuredItem = {
      ...item,
      mountedMeasurement: {
        warmupRafIntervals: 120 as const,
        measuredRafIntervals: 840 as const,
      },
    };
    measureMountedScene.mockResolvedValueOnce(null);
    const missing = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: measuredItem,
      signal: new AbortController().signal,
    });
    expect(missing).toMatchObject({
      status: "error",
      code: "benchmark-result-unreadable",
    });
    expect(missing).not.toHaveProperty("mountedMeasurement");

    const stats = (count: number) => ({
      count,
      p50: 1,
      p95: 2,
      p99: 3,
      max: 4,
    });
    const valid = {
      scope: "live-mounted-scene",
      warmupRafIntervals: 120,
      measuredRafIntervals: 840,
      measuredRenderFrames: 840,
      rafIntervalMs: stats(840),
      renderWallMs: stats(840),
      sourceWallMs: stats(840),
      composeWallMs: stats(840),
      deadlines: { over60Hz: 0, over120Hz: 840 },
      sourceCaptureDelta: 12,
      gpuScope: "target-mount-command-encoder-not-full-scene",
      gpuTargetInstanceId: measuredItem.instanceId,
      gpuAfterFrameIndex: -1,
      gpuThroughFrameIndex: -1,
      gpuWindow: {
        scope: "sparse-target-mount-command-encoder",
        targetInstanceId: measuredItem.instanceId,
        sampleEveryFrames: 60,
        maxSamples: 128,
        warmupAfterFrameIndex: -1,
        afterFrameIndex: -1,
        throughFrameIndex: -1,
        kind: "unavailable",
        code: "timestamp-query-unavailable",
        samples: [],
        skippedCapacity: { warmup: 0, measurement: 0 },
        omittedSamples: 0,
        gpuPassSumMs: null,
      },
    };
    measureMountedScene.mockResolvedValueOnce({
      ...valid,
      rafIntervalMs: stats(839),
    });
    const truncated = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: measuredItem,
      signal: new AbortController().signal,
    });
    expect(truncated).toMatchObject({
      status: "error",
      code: "benchmark-result-unreadable",
    });
    expect(truncated).not.toHaveProperty("mountedMeasurement");

    measureMountedScene.mockResolvedValueOnce(valid);
    const complete = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: measuredItem,
      signal: new AbortController().signal,
    });
    expect(complete).toMatchObject({
      status: "ready",
      mountedMeasurement: {
        measuredRafIntervals: 840,
        rafIntervalMs: { count: 840 },
        sourceCaptureDelta: 12,
      },
    });
    expect(measureMountedScene).toHaveBeenCalledTimes(3);
    expect(measureMountedScene).toHaveBeenLastCalledWith({
      instanceId: measuredItem.instanceId,
      executionHash: measuredItem.executionHash,
      request: measuredItem.mountedMeasurement,
      signal: expect.any(AbortSignal),
    });
    for (const bad of [
      { ...valid, gpuThroughFrameIndex: undefined, gpuWindow: undefined },
      { ...valid, gpuThroughFrameIndex: -2 },
      {
        ...valid,
        gpuWindow: { ...valid.gpuWindow, targetInstanceId: "other" },
      },
      { ...valid, gpuWindow: { ...valid.gpuWindow, throughFrameIndex: 1 } },
    ]) {
      measureMountedScene.mockResolvedValueOnce(bad);
      expect(
        await validateNativeShaderCaseInEditor({
          fileId: "screen-1",
          item: measuredItem,
          signal: new AbortController().signal,
        }),
      ).toMatchObject({ status: "error", code: "benchmark-result-unreadable" });
    }
    const previousProfile = runtime.profile as (options?: {
      instanceId: string;
    }) => Record<string, unknown>;
    runtime.profile = (options?: { instanceId: string }) => ({
      ...previousProfile(options),
      gpu: {
        kind: "ready",
        frameIndex: 2,
        passCount: 1,
        gpuPassSumMs: 999,
        passes: [
          { label: `${measuredItem.instanceId}:post-window`, gpuMs: 999 },
        ],
        estimatedResourceBytes: 2304,
      },
    });
    measureMountedScene.mockResolvedValueOnce(valid);
    const postWindow = await validateNativeShaderCaseInEditor({
      fileId: "screen-1",
      item: measuredItem,
      signal: new AbortController().signal,
    });
    expect(postWindow).toMatchObject({
      status: "ready",
      mountedMeasurement: {
        gpuWindow: {
          kind: "unavailable",
          code: "timestamp-query-unavailable",
          gpuPassSumMs: null,
        },
        profileAtEnd: { gpu: { kind: "error", code: "outside-window" } },
      },
    });
    runtime.profile = previousProfile;
  });

  it("does not report ready when the held physical extent or float samples fail", async () => {
    renderGolden.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 200,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: new Uint8Array(400 * 200 * 4),
      },
      linearGolden: { sampleCount: 1, maxAbsError: 0, passed: true },
    });
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      status: "error",
      code: "mounted-frame-pixels-unreadable",
    });
    renderGolden.mockResolvedValueOnce({
      pixels: {
        width: 400,
        height: 360,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: new Uint8Array(400 * 360 * 4),
      },
      linearGolden: { sampleCount: 1, maxAbsError: 0.02, passed: false },
    });
    expect(
      await validateNativeShaderCaseInEditor({
        fileId: "screen-1",
        item: { ...item, mountedFrame, expectedLinearSamples },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      status: "error",
      code: "linear-golden-failed",
      linearGolden: { passed: false },
    });
  });
});
