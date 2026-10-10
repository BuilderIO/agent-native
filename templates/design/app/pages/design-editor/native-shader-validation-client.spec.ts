import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

import { editNativeEffectHtml } from "@shared/native-effect-edits";
import { PARTICLE_FLOW_EFFECT } from "@shared/native-effect-particle-flow";
import { GRAIN_GRADIENT_EFFECT } from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { parseEffectsFromHtml } from "@shared/native-effects";
import { nativeShaderValidationCaseResultSchema } from "@shared/native-shader-validation";
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
      ...(args.item.mountedFrame && !args.preparedScene
        ? {
            preparedScene: {
              html: frameMock.current!.contentDocument!.documentElement
                .outerHTML,
              approvedDefinitionHashes: [item.executionHash],
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
  let dedicatedFrame: {
    srcdoc: string;
    contentWindow: Window & { __anNativeShaders: Record<string, unknown> };
    remove: ReturnType<typeof vi.fn>;
  };
  let dedicatedWidth: number;
  let changeSourceDuringClone: boolean;

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
      };
    });
    beginSession = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    endSession = vi.fn().mockResolvedValue(undefined);
    const target = {
      __anNativeShaders: {
        renderAt,
        renderCompositionFrameGolden: renderGolden,
        renderCompositionFrameValidated: renderValidated,
        renderCompositionFramePixels: renderPixels,
        beginSimulationExportSession: beginSession,
        endSimulationExportSession: endSession,
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
    expect(renderAt).toHaveBeenCalledWith(0);
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
