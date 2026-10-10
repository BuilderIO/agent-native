// @vitest-environment happy-dom

import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { OWNED_FEEDBACK_TEST_DEFINITION } from "../../../shared/native-effect-owned-test-fixtures";
import { PARTICLE_FLOW_EFFECT } from "../../../shared/native-effect-particle-flow";
import { writeEffectsToHtml } from "../../../shared/native-effects";
import {
  NativeSceneExportError,
  awaitNativeRasterWork,
  awaitNativeExportApprovalRescan,
  awaitNativeReady,
  captureNativeSceneFrames,
  cropNativeScenePixels,
  consumeNativeSceneWithViewedSourceFence,
  sceneRequiresNativeStateSession,
  withNativeSimulationSession,
  DEFAULT_NATIVE_VIDEO_SETTINGS,
  encodeNativeRasterCanvas,
  nativeVideoFrameCount,
  padNativeVideoFrame,
  readNativeScenePixels,
  readPreparedScene,
  renderOneNativeFrame,
  type NativePixelRuntime,
  type NativeVideoSettings,
} from "./native-scene-export-client";

type HeldFrame = NonNullable<
  NativePixelRuntime["renderCompositionVectorFrame"]
>;
type HeldFrameOptions = Parameters<HeldFrame>[0];
type HeldFrameSnapshot = Parameters<Parameters<HeldFrame>[1]>[0];

describe("bounded native image export work", () => {
  it("rejects a viewed-source change that occurs while the pixel consumer is pending", async () => {
    let viewedVersion = "v1";
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const assertStillViewed = () => {
      if (viewedVersion !== "v1")
        throw new NativeSceneExportError(
          "source-stale",
          "Viewed source changed.",
        );
    };
    const consumer = vi.fn(async () => {
      await pending;
      return "rendered pixels";
    });
    const result = consumeNativeSceneWithViewedSourceFence(
      consumer,
      assertStillViewed,
    );
    viewedVersion = "v2";
    release();
    await expect(result).rejects.toMatchObject({ code: "source-stale" });
    expect(consumer).toHaveBeenCalledTimes(1);
    viewedVersion = "v1";
    await expect(
      consumeNativeSceneWithViewedSourceFence(consumer, assertStillViewed),
    ).resolves.toBe("rendered pixels");
  });
  it("checks selected geometry inside the synchronized pixel consumer", async () => {
    const target = document.createElement("div");
    target.setAttribute("data-agent-native-node-id", "selected");
    document.body.append(target);
    const scene = {
      designId: "design",
      fileId: "file",
      viewport: { width: 4, height: 3 },
      initialPixelRatio: 1,
      html: "<html><body></body></html>",
      approvedDefinitionHashes: [],
      instanceTargets: [],
      sourceVersions: [],
      localQaSinkEnabled: false,
    };
    const pixels = {
      width: 4,
      height: 3,
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
      rgba: new Uint8Array(4 * 3 * 4),
    };
    const scalarFrame = vi.fn(async () => pixels);
    const heldFrameCall = vi.fn<(options: HeldFrameOptions) => void>();
    const heldFrame: HeldFrame = async <Result>(
      options: HeldFrameOptions,
      consume: (frame: HeldFrameSnapshot) => Promise<Result>,
    ): Promise<Result> => {
      heldFrameCall(options);
      return consume({
        document,
        pixels,
        runtimeCanvases: [],
        viewport: scene.viewport,
        pixelRatio: 1,
        signal: new AbortController().signal,
      });
    };
    const runtime = {
      renderCompositionFramePixels: scalarFrame,
      renderCompositionVectorFrame: heldFrame,
    } as NativePixelRuntime;
    const rect = vi.spyOn(target, "getBoundingClientRect");
    const crop = { nodeId: "selected", x: 1, y: 1, width: 2, height: 2 };
    try {
      rect.mockReturnValue(new DOMRect(2, 1, 2, 2));
      await expect(
        renderOneNativeFrame(
          runtime,
          scene,
          1,
          new AbortController().signal,
          crop,
        ),
      ).rejects.toMatchObject({ code: "scene-unreadable" });
      rect.mockReturnValue(new DOMRect(1, 1, 2, 2));
      await expect(
        renderOneNativeFrame(
          runtime,
          scene,
          1,
          new AbortController().signal,
          crop,
        ),
      ).resolves.toMatchObject({ width: 4, height: 3 });
      expect(heldFrameCall).toHaveBeenCalledTimes(2);
      expect(scalarFrame).not.toHaveBeenCalled();
    } finally {
      target.remove();
      rect.mockRestore();
    }
  });
  it("crops full-scene straight RGBA at the selected physical origin without changing alpha", () => {
    const viewport = { width: 4, height: 3 };
    const rgba = Uint8Array.from(
      Array.from({ length: 4 * 3 }, (_, index) => [
        index,
        255 - index,
        17,
        index % 2 ? 128 : 0,
      ]).flat(),
    );
    const pixels = {
      width: 4,
      height: 3,
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
      rgba,
    };
    const crop = cropNativeScenePixels(
      pixels,
      { nodeId: "selected", x: 1, y: 1, width: 2, height: 2 },
      viewport,
      1,
    );
    expect([crop.width, crop.height]).toEqual([2, 2]);
    expect(Array.from(crop.rgba)).toEqual([
      5, 250, 17, 128, 6, 249, 17, 0, 9, 246, 17, 128, 10, 245, 17, 0,
    ]);
  });

  it("refuses an out-of-scene or fractional physical crop instead of shifting layout", () => {
    const pixels = {
      width: 8,
      height: 6,
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
      rgba: new Uint8Array(8 * 6 * 4),
    };
    expect(() =>
      cropNativeScenePixels(
        pixels,
        { nodeId: "selected", x: 3, y: 1, width: 2, height: 2 },
        { width: 4, height: 3 },
        2,
      ),
    ).toThrow(/not pixel-aligned within the full scene/);
    expect(() =>
      cropNativeScenePixels(
        {
          width: 5,
          height: 4,
          colorSpace: "srgb",
          alpha: "straight",
          rgba: new Uint8Array(5 * 4 * 4),
        },
        { nodeId: "selected", x: 0, y: 0, width: 3, height: 2 },
        { width: 4, height: 3 },
        1.00000001,
      ),
    ).toThrow(/not pixel-aligned within the full scene/);
    expect(() =>
      cropNativeScenePixels(
        pixels,
        { nodeId: "selected", x: 0.5, y: 0, width: 2, height: 2 },
        { width: 4, height: 3 },
        1,
      ),
    ).toThrow(/not pixel-aligned within the full scene/);
    expect(() =>
      cropNativeScenePixels(
        {
          ...pixels,
          width: 7,
          height: 5,
          rgba: new Uint8Array(7 * 5 * 4),
        },
        { nodeId: "selected", x: 0, y: 0, width: 1, height: 1 },
        { width: 4, height: 3 },
        1.6,
      ),
    ).toThrow(/not pixel-aligned within the full scene/);
  });
  it("pads at most one codec pixel per edge without rescaling selected scene pixels", () => {
    const source = {
      frameIndex: 0,
      width: 3,
      height: 3,
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
      rgba: Uint8Array.from(
        Array.from({ length: 36 }, (_, index) => index + 1),
      ),
    };
    const padded = padNativeVideoFrame(source, { width: 4, height: 4 });
    expect(padded.width).toBe(4);
    expect(padded.height).toBe(4);
    for (let row = 0; row < 3; row++) {
      expect(Array.from(padded.rgba.subarray(row * 16, row * 16 + 12))).toEqual(
        Array.from(source.rgba.subarray(row * 12, row * 12 + 12)),
      );
      expect(
        Array.from(padded.rgba.subarray(row * 16 + 12, row * 16 + 16)),
      ).toEqual([0, 0, 0, 0]);
    }
    expect(Array.from(padded.rgba.subarray(48))).toEqual(new Array(16).fill(0));
    const evenFrame = {
      ...source,
      width: 2,
      height: 2,
      rgba: source.rgba.subarray(0, 16),
    };
    expect(padNativeVideoFrame(evenFrame, { width: 2, height: 2 })).toBe(
      evenFrame,
    );
  });

  it("rejects a codec target that would alter more than one pixel of source geometry", () => {
    const frame = {
      frameIndex: 0,
      width: 2,
      height: 2,
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
      rgba: new Uint8Array(16),
    };
    expect(() => padNativeVideoFrame(frame, { width: 4, height: 2 })).toThrow(
      /cannot fit its even codec dimensions/,
    );
    expect(() => padNativeVideoFrame(frame, { width: 1, height: 2 })).toThrow(
      /cannot fit its even codec dimensions/,
    );
  });
  it("rejects a never-returning prepare task when the export deadline aborts", async () => {
    const controller = new AbortController();
    const pending = awaitNativeRasterWork(
      new Promise<unknown>(() => {}),
      controller.signal,
    );
    controller.abort(
      new NativeSceneExportError("export-timeout", "Prepare timed out."),
    );
    await expect(pending).rejects.toMatchObject({ code: "export-timeout" });
  });

  it("bounds an encoder that never calls back and ignores a late callback", async () => {
    vi.useFakeTimers();
    try {
      let callback!: (blob: Blob | null) => void;
      const canvas = {
        toBlob: (receive: typeof callback) => {
          callback = receive;
        },
      } as unknown as HTMLCanvasElement;
      const pending = encodeNativeRasterCanvas(
        canvas,
        "image/jpeg",
        0.95,
        new AbortController().signal,
      );
      const rejection = expect(pending).rejects.toMatchObject({
        code: "export-timeout",
      });
      await vi.advanceTimersByTimeAsync(10_001);
      await rejection;
      callback(new Blob(["late"], { type: "image/jpeg" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a null encoder result distinguishable from unsupported fallback", async () => {
    const canvas = {
      toBlob: (callback: (blob: Blob | null) => void) => callback(null),
    } as unknown as HTMLCanvasElement;
    await expect(
      encodeNativeRasterCanvas(
        canvas,
        "image/webp",
        0.95,
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });
});

describe("custom definition export approval ordering", () => {
  it("waits for the child approval message before rescanning and still refuses a genuine unapproved effect", async () => {
    const order: string[] = [];
    const listeners = new Set<(event: MessageEvent) => void>();
    const origin = "http://127.0.0.1:9310";
    vi.stubGlobal("window", {
      location: { origin },
      addEventListener(_type: string, listener: (event: MessageEvent) => void) {
        listeners.add(listener);
      },
      removeEventListener(
        _type: string,
        listener: (event: MessageEvent) => void,
      ) {
        listeners.delete(listener);
      },
    });
    let scanned = false;
    let approved = true;
    const target = {
      postMessage(message: { type: string; requestId?: string }) {
        order.push(message.type);
        if (message.type !== "native-shader-status-request") return;
        queueMicrotask(() => {
          const ready = scanned && approved;
          const data = {
            type: "native-shader-status",
            schemaVersion: 1,
            runtimeEpoch: "exportEpoch1",
            instanceId: "owned-instance",
            nodeId: "owned-node",
            status: ready ? "ready" : "error",
            backend: ready ? "webgpu" : "unavailable",
            ...(!ready && {
              code: scanned ? "definition-untrusted" : "approvals-pending",
            }),
            requestId: message.requestId,
            frames: ready ? 1 : 0,
            sourceCaptures: 0,
            estimatedResourceBytes: 0,
          };
          for (const listener of listeners)
            listener({ source: target, origin, data } as MessageEvent);
        });
      },
    } as unknown as Window;
    const runtime = {
      scan: vi.fn(async () => {
        expect(order[0]).toBe("native-shader-approvals");
        expect(order[1]).toBe("native-shader-status-request");
        scanned = true;
      }),
    } as unknown as NativePixelRuntime;
    const instances = [{ instanceId: "owned-instance", nodeId: "owned-node" }];
    const signal = new AbortController().signal;
    try {
      target.postMessage(
        { type: "native-shader-approvals", status: "ready", hashes: [] },
        origin,
      );
      await awaitNativeExportApprovalRescan(target, runtime, instances, signal);
      await expect(
        awaitNativeReady(target, instances, signal),
      ).resolves.toBeUndefined();
      expect(runtime.scan).toHaveBeenCalledTimes(1);
      approved = false;
      await expect(
        awaitNativeReady(target, instances, signal),
      ).rejects.toMatchObject({
        code: "native-not-ready",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a child runtime that cannot rescan approved effects", async () => {
    await expect(
      awaitNativeExportApprovalRescan(
        {} as Window,
        {} as NativePixelRuntime,
        [{ instanceId: "owned-instance", nodeId: "owned-node" }],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "native-unavailable" });
  });
});

describe("persistent native simulation export", () => {
  it("holds a state session for enabled feedback effects but not disabled ones", () => {
    const instance = {
      id: "feedback-effect",
      nodeId: "feedback-card",
      definitionId: OWNED_FEEDBACK_TEST_DEFINITION.id,
      definitionVersion: OWNED_FEEDBACK_TEST_DEFINITION.version,
      placement: "layer" as const,
      params: {},
      enabled: true,
      opacity: 1,
      seed: 77,
      clip: "bounds" as const,
      blend: "normal" as const,
      timing: { speed: 1, paused: true, time: 0 },
    };
    const scene = (enabled: boolean) =>
      writeEffectsToHtml("<main></main>", {
        schemaVersion: 2,
        definitions: [OWNED_FEEDBACK_TEST_DEFINITION],
        instances: [{ ...instance, enabled }],
      });
    expect(sceneRequiresNativeStateSession(scene(true))).toBe(true);
    expect(sceneRequiresNativeStateSession(scene(false))).toBe(false);
  });

  it("detects the saved simulation and holds one runtime session around serial frame encoding", async () => {
    const html = writeEffectsToHtml("<main></main>", {
      schemaVersion: 2,
      definitions: [PARTICLE_FLOW_EFFECT],
      instances: [
        {
          id: "effect-1",
          nodeId: "particle-card",
          definitionId: PARTICLE_FLOW_EFFECT.id,
          definitionVersion: PARTICLE_FLOW_EFFECT.version,
          placement: "fill",
          params: { quality: "low" },
          enabled: true,
          opacity: 1,
          seed: 77,
          clip: "bounds",
          blend: "normal",
          timing: { speed: 1, paused: true, time: 0 },
        },
      ],
    });
    expect(sceneRequiresNativeStateSession(html)).toBe(true);
    expect(sceneRequiresNativeStateSession("<main></main>")).toBe(false);
    const order: string[] = [];
    const runtime: NativePixelRuntime = {
      beginSimulationExportSession: vi.fn(async () => {
        order.push("begin");
        return { sessionId: "held-1" };
      }),
      renderCompositionFramePixels: vi.fn(
        async ({ frameIndex, simulationSessionId }) => {
          order.push(`render-${frameIndex}-${simulationSessionId}`);
          return {
            width: 1,
            height: 1,
            colorSpace: "srgb" as const,
            alpha: "straight" as const,
            rgba: new Uint8Array(4),
          };
        },
      ),
      endSimulationExportSession: vi.fn(async () => {
        order.push("end");
      }),
    };
    await withNativeSimulationSession({
      runtime,
      fps: 60,
      frameCount: 2,
      startTimeSeconds: 0,
      signal: new AbortController().signal,
      run: (simulationSessionId) =>
        captureNativeSceneFrames({
          runtime,
          viewport: { width: 1, height: 1 },
          pixelRatio: 1,
          fps: 60,
          frameCount: 2,
          startTimeSeconds: 0,
          simulationSessionId,
          signal: new AbortController().signal,
          appendFrame: async ({ frameIndex }) => {
            order.push(`append-${frameIndex}`);
          },
        }),
    });
    expect(order).toEqual([
      "begin",
      "render-0-held-1",
      "append-0",
      "render-1-held-1",
      "append-1",
      "end",
    ]);
  });

  it("rejects a nonzero seek before opening a simulation session", async () => {
    const begin = vi.fn(async () => ({ sessionId: "held-1" }));
    await expect(
      withNativeSimulationSession({
        runtime: {
          beginSimulationExportSession: begin,
          endSimulationExportSession: vi.fn(async () => {}),
          renderCompositionFramePixels: vi.fn(),
        },
        fps: 60,
        frameCount: 180,
        startTimeSeconds: 1,
        signal: new AbortController().signal,
        run: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "video-unavailable" });
    expect(begin).not.toHaveBeenCalled();
  });

  it("preserves both a failed frame and failed session cleanup, including a falsy frame rejection", async () => {
    const end = vi.fn(async () => {
      throw new Error("restore failed");
    });
    await expect(
      withNativeSimulationSession({
        runtime: {
          beginSimulationExportSession: vi.fn(async () => ({
            sessionId: "held-1",
          })),
          endSimulationExportSession: end,
          renderCompositionFramePixels: vi.fn(),
        },
        fps: 60,
        frameCount: 2,
        startTimeSeconds: 0,
        signal: new AbortController().signal,
        run: async () => Promise.reject(false),
      }),
    ).rejects.toMatchObject({ causes: [false, expect.any(Error)] });
    expect(end).toHaveBeenCalledWith("held-1");
  });
});

const expectedScene = {
  designId: "design-1",
  fileId: "screen-1",
  width: 640,
  height: 480,
  pixelRatio: 1,
};
const preparedScene = {
  designId: "design-1",
  fileId: "screen-1",
  viewport: { width: 640, height: 480 },
  initialPixelRatio: 1,
  html: '<!doctype html><html><head><script data-agent-native-native-shader-runtime data-agent-native-export-initial-pixel-ratio="1"></script></head><body></body></html>',
  approvedDefinitionHashes: [],
  instanceTargets: [],
  localQaSinkEnabled: false,
  sourceVersions: [
    { fileId: "screen-1", filename: "index.html", versionHash: "v2" },
  ],
};

describe("native scene pixel boundary", () => {
  it("captures deterministic frames serially and waits for encoder backpressure", async () => {
    const order: string[] = [];
    const runtime: NativePixelRuntime = {
      renderCompositionFramePixels: vi.fn(async ({ frameIndex, fps }) => {
        order.push(`render-${frameIndex}-${fps}`);
        return {
          width: 2,
          height: 2,
          colorSpace: "srgb" as const,
          alpha: "straight" as const,
          rgba: new Uint8Array(16).fill(frameIndex),
        };
      }),
    };
    await captureNativeSceneFrames({
      runtime,
      viewport: { width: 2, height: 2 },
      pixelRatio: 1,
      fps: 60,
      frameCount: 3,
      startTimeSeconds: 1.25,
      signal: new AbortController().signal,
      appendFrame: async (frame) => {
        order.push(`append-${frame.frameIndex}-${frame.rgba[0]}`);
      },
    });
    expect(order).toEqual([
      "render-0-60",
      "append-0-0",
      "render-1-60",
      "append-1-1",
      "render-2-60",
      "append-2-2",
    ]);
    expect(runtime.renderCompositionFramePixels).toHaveBeenCalledWith(
      expect.objectContaining({
        frameIndex: 2,
        fps: 60,
        startTimeSeconds: 1.25,
        sourceContract: "declarative-only",
      }),
    );
  });

  it("holds the original scene, crops each selected video frame at DPR 2, and preserves the frame count", async () => {
    const doc = document.implementation.createHTMLDocument("Native Design");
    const target = doc.createElement("div");
    target.setAttribute("data-agent-native-node-id", "selected");
    target.getBoundingClientRect = () => new DOMRect(1, 0, 2, 2);
    doc.body.append(target);
    const viewport = { width: 4, height: 2 };
    const signal = new AbortController().signal;
    const scalarFrame = vi.fn();
    const sourceFrames: Uint8Array[] = [];
    const heldFrameCall = vi.fn<(options: HeldFrameOptions) => void>();
    const heldFrame: HeldFrame = async <Result>(
      options: HeldFrameOptions,
      consume: (frame: HeldFrameSnapshot) => Promise<Result>,
    ): Promise<Result> => {
      heldFrameCall(options);
      const rgba = Uint8Array.from(
        Array.from({ length: 8 * 4 }, (_, index) => [
          options.frameIndex * 60 + (index % 8),
          Math.floor(index / 8),
          17,
          index % 2 ? 128 : 255,
        ]).flat(),
      );
      sourceFrames.push(rgba);
      return consume({
        document: doc,
        pixels: {
          width: 8,
          height: 4,
          colorSpace: "srgb",
          alpha: "straight",
          rgba,
        },
        runtimeCanvases: [],
        viewport,
        pixelRatio: 2,
        signal,
      });
    };
    const frames: Array<{
      frameIndex: number;
      width: number;
      height: number;
      rgba: number[];
    }> = [];
    await captureNativeSceneFrames({
      runtime: {
        renderCompositionFramePixels: scalarFrame,
        renderCompositionVectorFrame: heldFrame,
      },
      viewport,
      pixelRatio: 2,
      fps: 30,
      frameCount: 3,
      startTimeSeconds: 1,
      signal,
      crop: { x: 1, y: 0, width: 2, height: 2, nodeId: "selected" },
      appendFrame: async (frame) => {
        frames.push({
          frameIndex: frame.frameIndex,
          width: frame.width,
          height: frame.height,
          rgba: Array.from(frame.rgba),
        });
      },
    });
    expect(scalarFrame).not.toHaveBeenCalled();
    expect(sourceFrames).toHaveLength(3);
    for (const [frameIndex, rgba] of sourceFrames.entries())
      expect(Array.from(rgba)).toEqual(
        Array.from({ length: 8 * 4 }, (_, index) => [
          frameIndex * 60 + (index % 8),
          Math.floor(index / 8),
          17,
          index % 2 ? 128 : 255,
        ]).flat(),
      );
    expect(heldFrameCall).toHaveBeenCalledTimes(3);
    expect(
      heldFrameCall.mock.calls.map(([options]) => options.frameIndex),
    ).toEqual([0, 1, 2]);
    expect(
      heldFrameCall.mock.calls.every(
        ([options]) =>
          options.viewport.width === 4 &&
          options.viewport.height === 2 &&
          options.pixelRatio === 2,
      ),
    ).toBe(true);
    expect(
      frames.map(({ frameIndex, width, height, rgba }) => ({
        frameIndex,
        width,
        height,
        first: rgba.slice(0, 4),
        last: rgba.slice(-4),
      })),
    ).toEqual([
      {
        frameIndex: 0,
        width: 4,
        height: 4,
        first: [2, 0, 17, 255],
        last: [5, 3, 17, 128],
      },
      {
        frameIndex: 1,
        width: 4,
        height: 4,
        first: [62, 0, 17, 255],
        last: [65, 3, 17, 128],
      },
      {
        frameIndex: 2,
        width: 4,
        height: 4,
        first: [122, 0, 17, 255],
        last: [125, 3, 17, 128],
      },
    ]);
  });

  it("rejects selected geometry drift on the next held frame before appending it", async () => {
    const doc = document.implementation.createHTMLDocument("Native Design");
    const target = doc.createElement("div");
    target.setAttribute("data-agent-native-node-id", "selected");
    doc.body.append(target);
    let x = 1;
    target.getBoundingClientRect = () => new DOMRect(x, 0, 2, 2);
    const signal = new AbortController().signal;
    const appendFrame = vi.fn(async () => {
      x = 2;
    });
    const scalarFrame = vi.fn();
    const heldFrameCall = vi.fn<(options: HeldFrameOptions) => void>();
    const heldFrame: HeldFrame = async <Result>(
      options: HeldFrameOptions,
      consume: (frame: HeldFrameSnapshot) => Promise<Result>,
    ): Promise<Result> => {
      heldFrameCall(options);
      return consume({
        document: doc,
        pixels: {
          width: 4,
          height: 2,
          colorSpace: "srgb",
          alpha: "straight",
          rgba: new Uint8Array(32),
        },
        runtimeCanvases: [],
        viewport: { width: 4, height: 2 },
        pixelRatio: 1,
        signal,
      });
    };
    await expect(
      captureNativeSceneFrames({
        runtime: {
          renderCompositionFramePixels: scalarFrame,
          renderCompositionVectorFrame: heldFrame,
        },
        viewport: { width: 4, height: 2 },
        pixelRatio: 1,
        fps: 30,
        frameCount: 2,
        startTimeSeconds: 0,
        signal,
        crop: { x: 1, y: 0, width: 2, height: 2, nodeId: "selected" },
        appendFrame,
      }),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
    expect(heldFrameCall).toHaveBeenCalledTimes(2);
    expect(scalarFrame).not.toHaveBeenCalled();
    expect(appendFrame).toHaveBeenCalledTimes(1);
  });

  it("fails closed when selected video has no held-frame renderer", async () => {
    const scalarFrame = vi.fn();
    const appendFrame = vi.fn();
    await expect(
      captureNativeSceneFrames({
        runtime: { renderCompositionFramePixels: scalarFrame },
        viewport: { width: 4, height: 2 },
        pixelRatio: 1,
        fps: 30,
        frameCount: 2,
        startTimeSeconds: 0,
        signal: new AbortController().signal,
        crop: { x: 1, y: 0, width: 2, height: 2, nodeId: "selected" },
        appendFrame,
      }),
    ).rejects.toMatchObject({ code: "native-unavailable" });
    expect(scalarFrame).not.toHaveBeenCalled();
    expect(appendFrame).not.toHaveBeenCalled();
  });

  it("passes only the validated pixel view to the encoder", async () => {
    const backing = new Uint8Array(12).fill(99);
    backing.set([10, 20, 30, 40], 4);
    const runtime: NativePixelRuntime = {
      renderCompositionFramePixels: vi.fn(async () => ({
        width: 1,
        height: 1,
        colorSpace: "srgb" as const,
        alpha: "straight" as const,
        rgba: backing.subarray(4, 8),
      })),
    };
    const appendFrame = vi.fn(async (frame: { rgba: Uint8Array }) => {
      expect(Array.from(frame.rgba)).toEqual([10, 20, 30, 40]);
      expect(frame.rgba.byteLength).toBe(4);
    });
    await captureNativeSceneFrames({
      runtime,
      viewport: { width: 1, height: 1 },
      pixelRatio: 1,
      fps: 60,
      frameCount: 1,
      startTimeSeconds: 0,
      signal: new AbortController().signal,
      appendFrame,
    });
    expect(appendFrame).toHaveBeenCalledOnce();
  });

  it("stops before the next GPU frame when canceled during encoding", async () => {
    const controller = new AbortController();
    const runtime: NativePixelRuntime = {
      renderCompositionFramePixels: vi.fn(async () => ({
        width: 1,
        height: 1,
        colorSpace: "srgb" as const,
        alpha: "straight" as const,
        rgba: new Uint8Array(4),
      })),
    };
    await expect(
      captureNativeSceneFrames({
        runtime,
        viewport: { width: 1, height: 1 },
        pixelRatio: 1,
        fps: 60,
        frameCount: 3,
        startTimeSeconds: 0,
        signal: controller.signal,
        appendFrame: async () => controller.abort(),
      }),
    ).rejects.toMatchObject({ code: "video-unavailable" });
    expect(runtime.renderCompositionFramePixels).toHaveBeenCalledTimes(1);
  });

  it("bounds duration by the frame budget and validates timeline and matte", () => {
    expect(nativeVideoFrameCount(DEFAULT_NATIVE_VIDEO_SETTINGS)).toBe(180);
    expect(
      nativeVideoFrameCount({
        ...DEFAULT_NATIVE_VIDEO_SETTINGS,
        durationSeconds: 25,
        fps: 24,
        startTimeSeconds: 10,
      }),
    ).toBe(600);
    for (const settings of [
      {
        ...DEFAULT_NATIVE_VIDEO_SETTINGS,
        durationSeconds: 10.1,
        fps: 60 as const,
      },
      {
        ...DEFAULT_NATIVE_VIDEO_SETTINGS,
        startTimeSeconds: 3599,
        durationSeconds: 3,
      },
      { ...DEFAULT_NATIVE_VIDEO_SETTINGS, matte: { r: -1, g: 255, b: 255 } },
      {
        ...DEFAULT_NATIVE_VIDEO_SETTINGS,
        matte: { x: 1, y: 2, z: 3 } as unknown as NativeVideoSettings["matte"],
      },
      { ...DEFAULT_NATIVE_VIDEO_SETTINGS, pixelRatio: 0 },
      { ...DEFAULT_NATIVE_VIDEO_SETTINGS, durationSeconds: 3.001 },
    ])
      expect(() => nativeVideoFrameCount(settings)).toThrow(
        NativeSceneExportError,
      );
  });
  it("accepts zero enabled targets but rejects malformed or duplicate source versions", () => {
    expect(
      readPreparedScene(preparedScene, expectedScene).instanceTargets,
    ).toEqual([]);
    expect(
      readPreparedScene(
        { ...preparedScene, localQaSinkEnabled: true },
        expectedScene,
      ).localQaSinkEnabled,
    ).toBe(true);
    expect(() =>
      readPreparedScene(
        { ...preparedScene, localQaSinkEnabled: undefined },
        expectedScene,
      ),
    ).toThrowError(expect.objectContaining({ code: "scene-unreadable" }));
    for (const initialPixelRatio of [undefined, 0.75, 2, NaN, Infinity])
      expect(() =>
        readPreparedScene(
          { ...preparedScene, initialPixelRatio },
          expectedScene,
        ),
      ).toThrowError(expect.objectContaining({ code: "scene-unreadable" }));
    for (const html of [
      preparedScene.html.replace(
        'data-agent-native-export-initial-pixel-ratio="1"',
        'data-agent-native-export-initial-pixel-ratio="2"',
      ),
      preparedScene.html.replace(
        'data-agent-native-export-initial-pixel-ratio="1"',
        "",
      ),
    ])
      expect(() =>
        readPreparedScene({ ...preparedScene, html }, expectedScene),
      ).toThrowError(expect.objectContaining({ code: "scene-unreadable" }));
    expect(
      readPreparedScene(preparedScene, {
        ...expectedScene,
        expectedVersionHash: "v2",
      }).sourceVersions[0]?.versionHash,
    ).toBe("v2");
    expect(() =>
      readPreparedScene(preparedScene, {
        ...expectedScene,
        expectedVersionHash: "v1",
      }),
    ).toThrowError(expect.objectContaining({ code: "source-stale" }));
    for (const sourceVersions of [
      [],
      [{ fileId: "screen-1", filename: "index.html" }],
      [
        { fileId: "screen-1", filename: "index.html", versionHash: "v2" },
        { fileId: "screen-1", filename: "copy.html", versionHash: "v3" },
      ],
      [{ fileId: "screen-2", filename: "other.html", versionHash: "v2" }],
    ]) {
      expect(() =>
        readPreparedScene({ ...preparedScene, sourceVersions }, expectedScene),
      ).toThrow(NativeSceneExportError);
    }
  });
  it("accepts exact straight-sRGB bytes across realms and copies them into a local buffer", () => {
    const foreign = runInNewContext("new Uint8Array(4 * 6 * 4).fill(71)") as
      | Uint8Array
      | undefined;
    expect(foreign).toBeDefined();
    const result = readNativeScenePixels(
      {
        width: 4,
        height: 6,
        colorSpace: "srgb",
        alpha: "straight",
        rgba: foreign,
      },
      { width: 2, height: 3 },
      2,
    );
    expect(result.width).toBe(4);
    expect(result.height).toBe(6);
    expect(result.rgba).toHaveLength(96);
    expect(result.rgba[0]).toBe(71);
    foreign![0] = 0;
    expect(result.rgba[0]).toBe(71);
  });

  it("rejects truncated, premultiplied, and mismatched frames", () => {
    const valid = {
      width: 4,
      height: 6,
      colorSpace: "srgb",
      alpha: "straight",
      rgba: new Uint8Array(96),
    };
    for (const malformed of [
      { ...valid, rgba: new Uint8Array(95) },
      { ...valid, alpha: "premultiplied" },
      { ...valid, width: 5 },
      { ...valid, colorSpace: "display-p3" },
    ]) {
      expect(() =>
        readNativeScenePixels(malformed, { width: 2, height: 3 }, 2),
      ).toThrow(NativeSceneExportError);
    }
  });

  it("rejects physical dimensions over the renderer limit before accepting pixels", () => {
    expect(() =>
      readNativeScenePixels(null, { width: 4096, height: 4096 }, 2),
    ).toThrowError(expect.objectContaining({ code: "frame-too-large" }));
  });
});
