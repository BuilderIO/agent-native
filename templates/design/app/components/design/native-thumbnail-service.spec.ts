import { OWNED_INTRINSIC_IMAGE_TEST_EFFECT } from "@shared/native-effect-owned-source-test-fixtures";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "@shared/native-effect-owned-test-fixtures";
import { PARTICLE_FLOW_EFFECT } from "@shared/native-effect-particle-flow";
import {
  HALFTONE_EFFECT,
  NATIVE_EFFECT_DEFINITION_CATALOG,
} from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeThumbnailService } from "./native-thumbnail-service";

const services: NativeThumbnailService[] = [];

afterEach(async () => {
  for (const service of services) await service.dispose();
  services.length = 0;
  vi.restoreAllMocks();
});

const options = (id: string) => ({
  items: [
    {
      id,
      definition: NATIVE_EFFECT_DEFINITION_CATALOG[0],
      params: {},
      seed: 77,
      sourceRevision: "neutral-v1",
    },
  ],
  approvedExecutionHashes: [],
});

describe("shared native thumbnail work queue", () => {
  it("mounts a decoded intrinsic source as an owned same-origin PNG and revokes it after validation", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    if (!frame.contentWindow || !frame.contentDocument)
      throw new Error("Test iframe has no document.");
    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    const internal = service as unknown as { frame: HTMLIFrameElement | null };
    internal.frame = frame;
    vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {});
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      160,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalHeight",
      "get",
    ).mockReturnValue(100);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["png"], { type: "image/png" })),
    );
    const url = `blob:${window.location.origin}/owned-intrinsic`;
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue(url);
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const scan = vi.fn(async () => {
      const target = frameDocument.querySelector("[data-agent-native-node-id]");
      if (target) target.setAttribute("data-an-native-status", "ready");
    });
    const render = vi.fn(async () => {
      const image = frameDocument.querySelector<HTMLImageElement>(
        "[data-agent-native-node-id]",
      );
      const manifest = frameDocument.querySelector<HTMLScriptElement>(
        'script[type="application/x-agent-native-effects"]',
      );
      expect(image?.src).toBe(url);
      expect(image?.style.objectFit).toBe("fill");
      expect(
        JSON.parse(manifest?.textContent ?? "{}").instances[0],
      ).toMatchObject({
        sourceSizing: { inputSpace: "intrinsic-image", aspectRatio: 1.6 },
      });
      return {
        width: 320,
        height: 200,
        colorSpace: "srgb" as const,
        alpha: "straight" as const,
        rgba: new Uint8Array(320 * 200 * 4),
      };
    });
    Object.defineProperty(frameWindow, "__anNativeShaders", {
      configurable: true,
      value: {
        scan,
        renderCompositionFramePixels: render,
        requestStatusSnapshot: () => {
          const manifest = frameDocument.querySelector<HTMLScriptElement>(
            'script[type="application/x-agent-native-effects"]',
          );
          const instance = JSON.parse(manifest?.textContent ?? "{}")
            .instances[0];
          frameWindow.dispatchEvent(
            new CustomEvent("native-shader-status", {
              detail: {
                instanceId: instance.id,
                nodeId: instance.nodeId,
                status: "ready",
                backend: "webgpu",
                frames: 1,
                sourceCaptures: 1,
                estimatedResourceBytes: 1024,
              },
            }),
          );
        },
        dispose: vi.fn(),
      },
    });
    const definition = OWNED_INTRINSIC_IMAGE_TEST_EFFECT;
    const result = await service.renderValidationBatch({
      items: [
        {
          ...options("intrinsic").items[0],
          definition,
          placement: "layer",
          fixture: {
            sourceKind: "owned-image",
            aspect: "portrait",
            alpha: "transparent",
            rounded: false,
          },
        },
      ],
      approvedExecutionHashes: [await hashEffectDefinition(definition)],
    });
    expect(result[0]).toMatchObject({ status: "ready", backend: "webgpu" });
    expect(drawImage).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith(url);
    expect(render).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("reuses one realm for clean GPU cases and returns raw pixels without a Blob URL", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    if (!frame.contentWindow) throw new Error("Test iframe has no window.");
    vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
    let nextFrame = 0;
    let expectedFrames = 0;
    const beginSession = vi.fn(async (input: { totalFrames: number }) => {
      nextFrame = 0;
      expectedFrames = input.totalFrames;
      return { sessionId: "particle-export-session" };
    });
    const endSession = vi.fn(async () => {
      if (nextFrame !== expectedFrames)
        throw new Error("The simulation session did not complete every frame.");
    });
    const render = vi.fn(
      async (input: { frameIndex: number; simulationSessionId?: string }) => {
        const source = frame.contentDocument?.querySelector<HTMLScriptElement>(
          'script[type="application/x-agent-native-effects"]',
        )?.textContent;
        if (!source) throw new Error("The validation manifest is absent.");
        const manifest = JSON.parse(source) as {
          instances: Array<{
            placement: string;
            definitionId: string;
            clip: string;
            timing: { paused: boolean };
          }>;
        };
        expect(manifest.instances[0].timing.paused).toBe(false);
        if (manifest.instances[0].definitionId === PARTICLE_FLOW_EFFECT.id) {
          expect(manifest.instances[0].placement).toBe("fill");
          expect(manifest.instances[0].clip).toBe("text");
          expect(
            frame.contentDocument?.querySelector("[data-agent-native-node-id]")
              ?.textContent,
          ).toContain("Native");
        }
        if (
          manifest.instances[0].placement === "layer" &&
          manifest.instances[0].definitionId !==
            OWNED_FEEDBACK_TEST_DEFINITION.id
        ) {
          const target = frame.contentDocument?.querySelector<HTMLElement>(
            "[data-agent-native-node-id]",
          );
          expect(target?.style.opacity).not.toBe("0");
          expect(
            decodeURIComponent(target?.getAttribute("src") ?? ""),
          ).toContain('fill-opacity="0"');
        }
        if (input.simulationSessionId) {
          if (
            input.simulationSessionId !== "particle-export-session" ||
            input.frameIndex !== nextFrame
          )
            throw new Error("The simulation frame sequence is not contiguous.");
          nextFrame += 1;
        }
        const rgba = new Uint8Array(320 * 200 * 4);
        for (let index = 0; index < rgba.length; index += 4)
          rgba.set([21, 42, 63, 255], index);
        return {
          width: 320,
          height: 200,
          colorSpace: "srgb" as const,
          alpha: "straight" as const,
          rgba,
        };
      },
    );
    const scan = vi.fn(async () => {
      for (const target of frame.contentDocument?.querySelectorAll(
        "[data-agent-native-node-id]",
      ) ?? [])
        target.setAttribute("data-an-native-status", "ready");
    });
    const renderGolden = vi.fn(
      async (
        input: { frameIndex: number; simulationSessionId?: string },
        target: {
          instanceId: string;
          nodeId: string;
          expectedLinearSamples: readonly unknown[];
        },
      ) => {
        expect(target.instanceId).toBeTruthy();
        expect(target.nodeId).toBeTruthy();
        expect(target.expectedLinearSamples).toHaveLength(1);
        return {
          pixels: await render(input),
          linearGolden: { sampleCount: 1, maxAbsError: 0.0005, passed: true },
        };
      },
    );
    const dispose = vi.fn();
    Object.defineProperty(frame.contentWindow, "__anNativeShaders", {
      configurable: true,
      value: {
        scan,
        renderCompositionFramePixels: render,
        renderCompositionFrameGolden: renderGolden,
        beginSimulationExportSession: beginSession,
        endSimulationExportSession: endSession,
        requestStatusSnapshot: () => {
          const source =
            frame.contentDocument?.querySelector<HTMLScriptElement>(
              'script[type="application/x-agent-native-effects"]',
            )?.textContent;
          if (!source) throw new Error("Validation manifest was not mounted.");
          const instance = (
            JSON.parse(source) as {
              instances: Array<{ id: string; nodeId: string }>;
            }
          ).instances[0];
          frame.contentWindow?.dispatchEvent(
            new CustomEvent("native-shader-status", {
              detail: {
                instanceId: instance.id,
                nodeId: instance.nodeId,
                status: "ready",
                backend: "webgpu",
                frames: 2,
                sourceCaptures: 1,
                estimatedResourceBytes: 1024,
                renderWallMs: 1.5,
              },
            }),
          );
        },
        dispose,
      },
    });
    const internal = service as unknown as { frame: HTMLIFrameElement | null };
    internal.frame = frame;
    const createUrl = vi.spyOn(URL, "createObjectURL");
    const results = await service.renderValidationBatch({
      items: [
        {
          ...options("unsupported").items[0],
          definition: HALFTONE_EFFECT,
          placement: "layer",
          fixture: {
            sourceKind: "generated",
            aspect: "square",
            alpha: "opaque",
            rounded: false,
          },
        },
        {
          ...options("ready").items[0],
          placement: "fill",
          fixture: {
            sourceKind: "generated",
            aspect: "portrait",
            alpha: "transparent",
            rounded: true,
          },
          timeSeconds: 1,
          expectedLinearSamples: [
            { x: 2, y: 3, expected: [0.5, 0.25, 0.1, 1], tolerance: 0.002 },
          ],
        },
        {
          ...options("particle").items[0],
          definition: PARTICLE_FLOW_EFFECT,
          placement: "fill",
          fixture: {
            sourceKind: "editable-text",
            aspect: "landscape",
            alpha: "opaque",
            rounded: false,
          },
          timeSeconds: 1,
        },
        {
          ...options("feedback").items[0],
          definition: OWNED_FEEDBACK_TEST_DEFINITION,
          placement: "layer",
          fixture: {
            sourceKind: "owned-image",
            aspect: "square",
            alpha: "opaque",
            rounded: false,
          },
          timeSeconds: 1,
        },
      ],
      approvedExecutionHashes: [
        await hashEffectDefinition(PARTICLE_FLOW_EFFECT),
        await hashEffectDefinition(OWNED_FEEDBACK_TEST_DEFINITION),
      ],
    });
    expect(results[0]).toMatchObject({
      id: "unsupported",
      status: "error",
      code: "validation-fixture-unsupported",
    });
    if (results[1].status !== "ready")
      throw new Error(JSON.stringify(results[1]));
    expect(results[1]).toMatchObject({
      id: "ready",
      status: "ready",
      backend: "webgpu",
      width: 160,
      height: 100,
      frames: 2,
      renderWallMs: 1.5,
      linearGolden: { sampleCount: 1, maxAbsError: 0.0005, passed: true },
    });
    expect(renderGolden).toHaveBeenCalledTimes(1);
    if (results[1].status !== "ready")
      throw new Error("GPU case was not ready.");
    expect(results[1].rgba).toHaveLength(160 * 100 * 4);
    expect([...results[1].rgba.subarray(0, 4)]).toEqual([21, 42, 63, 255]);
    expect(results.slice(1).map((result) => result.status)).toEqual([
      "ready",
      "ready",
      "ready",
    ]);
    const zeroSource = await service.renderValidationBatch({
      items: [
        {
          ...options("zero-source").items[0],
          definition: HALFTONE_EFFECT,
          placement: "layer",
          fixture: {
            sourceKind: "owned-image",
            aspect: "square",
            alpha: "zero",
            rounded: false,
          },
          timeSeconds: 1,
        },
      ],
      approvedExecutionHashes: [],
    });
    expect(zeroSource[0]).toMatchObject({ status: "ready" });
    expect(render).toHaveBeenCalledTimes(124);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ frameIndex: 60, pixelRatio: 1 }),
    );
    expect(beginSession).toHaveBeenCalledTimes(2);
    expect(beginSession).toHaveBeenCalledWith(
      expect.objectContaining({
        fps: 60,
        totalFrames: 61,
        startTimeSeconds: 0,
      }),
    );
    expect(endSession).toHaveBeenCalledTimes(2);
    expect(nextFrame).toBe(61);
    expect(scan).toHaveBeenCalledTimes(8);
    expect(createUrl).not.toHaveBeenCalled();
    await service.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("retains rendering and cleanup diagnostics when frame initialization fails", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const internal = service as unknown as {
      ensureFrame(signal: AbortSignal): Promise<HTMLIFrameElement>;
    };
    const controller = new AbortController();
    const pending = internal.ensureFrame(controller.signal);
    const frame = document.querySelector("iframe");
    if (!frame?.contentWindow)
      throw new Error("The renderer frame did not mount.");
    Object.defineProperty(frame.contentWindow, "__anNativeShaders", {
      configurable: true,
      value: {
        dispose: () => {
          throw {
            message: "GPU cleanup timed out.",
            code: "queue-cleanup-timeout",
          };
        },
      },
    });
    controller.abort(
      Object.assign(new Error("Particle seek failed."), {
        code: "simulation-seek-failed",
      }),
    );
    await expect(pending).rejects.toMatchObject({
      code: "thumbnail-cleanup-failed",
      message:
        "simulation-seek-failed: Particle seek failed.; queue-cleanup-timeout: GPU cleanup timed out.",
    });
    expect(frame.isConnected).toBe(false);
  });

  it("disposes a renderer created before iframe initialization is canceled", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const internal = service as unknown as {
      ensureFrame(signal: AbortSignal): Promise<HTMLIFrameElement>;
    };
    const controller = new AbortController();
    const pending = internal.ensureFrame(controller.signal);
    const frame = document.querySelector("iframe");
    if (!frame?.contentWindow)
      throw new Error("Thumbnail renderer frame did not mount.");
    const dispose = vi.fn();
    Object.defineProperty(frame.contentWindow, "__anNativeShaders", {
      configurable: true,
      value: { dispose },
    });
    controller.abort(new Error("Canceled while the renderer loaded."));
    await expect(pending).rejects.toThrow("Canceled while");
    expect(dispose).toHaveBeenCalledOnce();
    expect(frame.isConnected).toBe(false);
  });

  it("releases the frame and cached URLs even when an active renderer never settles", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const internal = service as unknown as {
      frame: HTMLIFrameElement | null;
      cache: Map<string, string>;
      perform(): Promise<never[]>;
    };
    let release!: () => void;
    vi.spyOn(internal, "perform").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const dispose = vi.fn();
    Object.defineProperty(frame.contentWindow, "__anNativeShaders", {
      configurable: true,
      value: { dispose },
    });
    internal.frame = frame;
    internal.cache.set("cached", "blob:thumbnail-cached");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const now = vi.spyOn(performance, "now");
    let elapsed = 0;
    now.mockImplementation(() => {
      elapsed += 20_000;
      return elapsed;
    });
    const active = service.renderBatch(options("active"));
    await expect(service.dispose()).rejects.toMatchObject({
      code: "thumbnail-cleanup-timeout",
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(frame.isConnected).toBe(false);
    expect(revoke).toHaveBeenCalledWith("blob:thumbnail-cached");
    expect(internal.cache.size).toBe(0);
    release();
    await active;
  });

  it("rejects an already canceled request before starting a renderer", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const internal = service as unknown as { perform(): Promise<never[]> };
    const work = vi.spyOn(internal, "perform");
    const controller = new AbortController();
    controller.abort(
      new Error("Canceled before the thumbnail request was queued."),
    );
    await expect(
      service.renderBatch({
        ...options("canceled"),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Canceled before");
    expect(work).not.toHaveBeenCalled();
  });

  it("quarantines a stalled scan before a replacement can use another frame", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const first = document.createElement("iframe");
    const second = document.createElement("iframe");
    document.body.append(first, second);
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    let finishFirstScan!: () => void;
    const firstScan = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirstScan = resolve;
        }),
    );
    const secondScan = vi.fn(async () => {
      throw new Error("The second frame rejected its own source.");
    });
    for (const [frame, scan, dispose] of [
      [first, firstScan, firstDispose],
      [second, secondScan, secondDispose],
    ] as const) {
      if (!frame.contentWindow) throw new Error("Test iframe has no window.");
      vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
      Object.defineProperty(frame.contentWindow, "__anNativeShaders", {
        configurable: true,
        value: { scan, dispose },
      });
    }
    const internal = service as unknown as {
      frame: HTMLIFrameElement | null;
      ensureFrame(signal: AbortSignal): Promise<HTMLIFrameElement>;
    };
    let frameIndex = 0;
    vi.spyOn(internal, "ensureFrame").mockImplementation(async () => {
      const frame = [first, second][frameIndex++];
      if (!frame) throw new Error("A third frame was requested.");
      internal.frame = frame;
      return frame;
    });
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
    const old = service.renderBatch(options("old"));
    await vi.waitFor(() => expect(firstScan).toHaveBeenCalledOnce());
    const replacement = service.renderBatch(options("replacement"));
    await expect(old).rejects.toMatchObject({ code: "thumbnail-superseded" });
    await expect(replacement).rejects.toThrow(
      "The second frame rejected its own source.",
    );
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(false);
    finishFirstScan();
    await Promise.resolve();
    expect(frameIndex).toBe(2);
  });

  it("settles an unresponsive thumbnail scan with a typed timeout and releases the frame", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    if (!frame.contentWindow) throw new Error("Test iframe has no window.");
    vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
    const scan = vi.fn(() => new Promise<void>(() => {}));
    const dispose = vi.fn();
    Object.defineProperty(frame.contentWindow, "__anNativeShaders", {
      configurable: true,
      value: { scan, dispose },
    });
    const internal = service as unknown as { frame: HTMLIFrameElement | null };
    internal.frame = frame;
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) =>
      originalSetTimeout(
        callback,
        delay === 10_000 ? 20 : delay,
        ...args,
      )) as typeof setTimeout);
    const pending = service.renderBatch(options("unresponsive"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "thumbnail-scan-timeout",
    });
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
    expect(frame.isConnected).toBe(false);
  });

  it("keeps only the newest queued batch and waits for the active batch to settle", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const internal = service as unknown as {
      perform(job: {
        options: ReturnType<typeof options>;
        controller: AbortController;
      }): Promise<never[]>;
    };
    const releases: Array<() => void> = [];
    const work = vi.spyOn(internal, "perform").mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve([]));
        }),
    );
    const first = service.renderBatch(options("first"));
    const second = service.renderBatch(options("second"));
    const third = service.renderBatch(options("third"));
    await expect(second).rejects.toMatchObject({
      code: "thumbnail-superseded",
    });
    expect(work).toHaveBeenCalledTimes(1);
    releases[0]();
    await expect(first).resolves.toEqual([]);
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
    expect(work.mock.calls[1][0].options.items[0].id).toBe("third");
    releases[1]();
    await expect(third).resolves.toEqual([]);
  });

  it("rejects queued work on disposal without starting it", async () => {
    const service = new NativeThumbnailService();
    services.push(service);
    const internal = service as unknown as {
      perform(): Promise<never[]>;
    };
    let release!: () => void;
    const work = vi.spyOn(internal, "perform").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    const active = service.renderBatch(options("active"));
    const queued = service.renderBatch(options("queued"));
    const disposed = service.dispose();
    await expect(queued).rejects.toMatchObject({
      code: "thumbnail-service-disposed",
    });
    release();
    await active;
    await disposed;
    expect(work).toHaveBeenCalledTimes(1);
    await expect(service.renderBatch(options("later"))).rejects.toMatchObject({
      code: "thumbnail-service-disposed",
    });
  });
});
