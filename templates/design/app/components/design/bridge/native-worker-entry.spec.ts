import { afterEach, describe, expect, it, vi } from "vitest";

import { NativePreviewPolicyController } from "./native-preview-policy";
import { composeNativeWorkerScene } from "./native-worker-compositor";
import {
  NativeWorkerRuntime,
  sceneCompositionSignature,
} from "./native-worker-entry";

vi.mock("./native-worker-compositor", async (importOriginal) => ({
  ...(await importOriginal()),
  composeNativeWorkerScene: vi.fn(async () => ({ label: "composed" })),
}));

type PreviewState = {
  gpu: { frontBank: () => object; reject: ReturnType<typeof vi.fn> };
  visible: boolean;
  disposed: boolean;
  busy: boolean;
  exports: unknown[];
  current: { clock: { playing: boolean } } | null;
  staged: object | null;
  anchorMs: number;
  stagedAnchorMs: number;
};

function runtimeWithState(state: PreviewState) {
  const runtime = new NativeWorkerRuntime(() => undefined);
  const scenes = (runtime as unknown as { scenes: Map<string, PreviewState> })
    .scenes;
  scenes.set("scene", state);
  return runtime;
}

afterEach(() => vi.unstubAllGlobals());

describe("native worker preview visibility", () => {
  it("stops hidden preview frames and resumes with the retained scene and clock anchor", async () => {
    const cancel = vi.fn();
    const request = vi.fn(() => 8);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    vi.stubGlobal("requestAnimationFrame", request);
    const current = { clock: { playing: true } };
    const staged = {};
    const state: PreviewState = {
      gpu: { frontBank: () => ({}), reject: vi.fn() },
      visible: true,
      disposed: false,
      busy: false,
      exports: [],
      current,
      staged,
      anchorMs: 123,
      stagedAnchorMs: 456,
    };
    const runtime = runtimeWithState(state);
    Object.assign(runtime, { timer: 7 });

    await runtime.handle({
      type: "visibility",
      sceneId: "scene",
      visible: false,
    });
    expect(cancel).toHaveBeenCalledWith(7);
    expect((runtime as unknown as { timer: number | null }).timer).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(state.current).toBe(current);
    expect(state.staged).toBe(staged);
    expect([state.anchorMs, state.stagedAnchorMs]).toEqual([123, 456]);
    await vi.waitFor(() => expect(state.gpu.reject).toHaveBeenCalledOnce());

    await runtime.handle({
      type: "visibility",
      sceneId: "scene",
      visible: true,
    });
    expect(request).toHaveBeenCalledOnce();
    expect((runtime as unknown as { timer: number | null }).timer).toBe(8);
    expect([state.anchorMs, state.stagedAnchorMs]).toEqual([123, 456]);
  });

  it("continues scheduling an explicit export while preview is hidden", async () => {
    const cancel = vi.fn();
    const request = vi.fn(() => 11);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    vi.stubGlobal("requestAnimationFrame", request);
    const state: PreviewState = {
      gpu: { frontBank: () => ({}), reject: vi.fn() },
      visible: true,
      disposed: false,
      busy: false,
      exports: [{}],
      current: null,
      staged: null,
      anchorMs: 123,
      stagedAnchorMs: 456,
    };
    const runtime = runtimeWithState(state);
    Object.assign(runtime, { timer: 10 });

    await runtime.handle({
      type: "visibility",
      sceneId: "scene",
      visible: false,
    });
    expect(cancel).not.toHaveBeenCalled();
    expect((runtime as unknown as { timer: number | null }).timer).toBe(10);

    Object.assign(runtime, { timer: null });
    await runtime.handle({
      type: "visibility",
      sceneId: "scene",
      visible: false,
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect((runtime as unknown as { timer: number | null }).timer).toBe(11);
  });
});

describe("native worker staged scene publication", () => {
  function fixture() {
    const prior = {
      generation: 1,
      sourceEpoch: 1,
      clock: { playing: false, timeSeconds: 0, speed: 1 },
    };
    const scene = {
      sceneId: "scene",
      generation: 2,
      sourceEpoch: 1,
      width: 1,
      height: 1,
      pixelRatio: 1,
      viewport: { x: 0, y: 0, width: 1, height: 1 },
      colorSpace: "srgb",
      clock: { playing: false, timeSeconds: 0, speed: 1 },
      instances: [],
      definitions: [],
      targets: [],
      requiredAssets: [],
      records: [],
    };
    const newer = { ...scene, generation: 3 };
    const bank = {};
    const final = { label: "candidate" };
    const front = { label: "prior" };
    const gpu = {
      spareBank: vi.fn(() => bank),
      endLegacyFlight: vi.fn(),
      beginFrame: vi.fn(),
      finishFrame: vi.fn(),
      stageFinal: vi.fn(() => final),
      uploadFrame: vi.fn(),
      publish: vi.fn(),
      trimWork: vi.fn(),
      frontTexture: vi.fn(() => front),
      retireAssets: vi.fn(),
      workingFormat: "rgba16float",
      device: {
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn(async () => null),
        createCommandEncoder: vi.fn(() => ({ finish: () => ({}) })),
        queue: {
          submit: vi.fn(),
          onSubmittedWorkDone: vi.fn(async () => undefined),
        },
      },
    };
    const state = {
      gpu,
      current: prior,
      staged: scene,
      anchorMs: 0,
      stagedAnchorMs: 0,
      frame: 0,
      disposed: false,
      unclaimedAssets: new Map(),
      exports: [],
      cadence: { commitSubmission: vi.fn() },
    };
    const post = vi.fn();
    const runtime = new NativeWorkerRuntime(post);
    const frame = () =>
      (
        runtime as unknown as {
          frame(
            sceneId: string,
            state: unknown,
            scene: unknown,
            now: number,
          ): Promise<void>;
        }
      ).frame("scene", state, scene, 16);
    return {
      runtime,
      frame,
      state,
      scene,
      newer,
      prior,
      gpu,
      final,
      front,
      post,
    };
  }

  it("keeps a newer staged scene when the older presentation completes", async () => {
    const { runtime, frame, state, scene, newer, prior, gpu, post } = fixture();
    const latest = { ...newer, generation: 4 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseRestore!: () => void;
    const restoring = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const present = vi.fn(async (_gpu, _bank, presentedScene) => {
      if (presentedScene === scene) await blocked;
      if (presentedScene === prior) await restoring;
    });
    Object.assign(runtime, { present });
    const pending = frame();
    await vi.waitFor(() => expect(present).toHaveBeenCalledOnce());
    state.staged = newer;
    release();
    await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(2));
    state.staged = latest;
    releaseRestore();
    await pending;
    expect(state.staged).toBe(latest);
    expect(state.current).toBe(prior);
    expect(gpu.publish).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "committed", generation: 2 }),
    );
    expect(present).toHaveBeenCalledTimes(2);
    expect(present.mock.calls[1]?.[2]).toBe(prior);
  });

  it("keeps a newer staged scene when the older presentation fails", async () => {
    const { runtime, frame, state, scene, newer } = fixture();
    Object.assign(runtime, {
      present: async () => {
        state.staged = newer;
        throw new Error("presentation failed");
      },
    });
    await expect(frame()).rejects.toThrow("presentation failed");
    expect(state.staged).toBe(newer);
    expect(state.current).not.toBe(scene);
  });
});

describe("native worker export lifetime", () => {
  function fixture(outputFails = false) {
    const steps: string[] = [];
    const composed = { label: "composed" };
    const output = { createView: () => ({}) };
    const readback = {
      mapAsync: vi.fn(async () => undefined),
      getMappedRange: vi.fn(() => new ArrayBuffer(512)),
      unmap: vi.fn(),
      destroy: vi.fn(),
    };
    const encoder = () => ({
      beginRenderPass: () => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn(),
      }),
      copyTextureToBuffer: vi.fn(),
      finish: () => ({}),
    });
    const queue = {
      submit: vi.fn(() => steps.push("submit")),
      onSubmittedWorkDone: vi.fn(async () => {
        steps.push("fence");
      }),
    };
    const gpu = {
      spareBank: vi.fn(() => ({})),
      endLegacyFlight: vi.fn(),
      beginFrame: vi.fn(),
      uploadFrame: vi.fn(),
      finishFrame: vi.fn(),
      trimWorkExcept: vi.fn((_bank, retained) =>
        steps.push(retained ? "retain-composed" : "retire-scratch"),
      ),
      texture: vi.fn(() => {
        steps.push("output");
        if (outputFails) throw new Error("output allocation failed");
        return output;
      }),
      pipeline: vi.fn(async () => ({})),
      bind: vi.fn(() => ({})),
      reserveTransient: vi.fn(),
      releaseTransient: vi.fn(),
      retireAssets: vi.fn(),
      workingFormat: "rgba16float",
      device: {
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn(async () => null),
        createCommandEncoder: vi.fn(encoder),
        createBuffer: vi.fn(() => readback),
        queue,
      },
    };
    const scene = {
      sceneId: "scene",
      generation: 2,
      sourceEpoch: 1,
      width: 2,
      height: 2,
      pixelRatio: 1,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
      colorSpace: "srgb",
      clock: { playing: false, timeSeconds: 0, speed: 1 },
      instances: [],
      definitions: [],
      targets: [],
      requiredAssets: [],
      records: [],
    };
    const state = {
      gpu,
      current: scene,
      staged: null,
      exports: [],
      cancelled: new Set<string>(),
      unclaimedAssets: new Map(),
      activeExportId: null,
    };
    const post = vi.fn();
    const runtime = new NativeWorkerRuntime(post);
    const run = (timeSeconds = 0) =>
      (
        runtime as unknown as {
          exportScene(
            sceneId: string,
            state: unknown,
            request: unknown,
          ): Promise<void>;
        }
      ).exportScene("scene", state, {
        type: "export-scene",
        sceneId: "scene",
        requestId: "export",
        scene,
        cropRect: { x: 0, y: 0, width: 2, height: 2 },
        pixelRatio: 1,
        timeSeconds,
      });
    return { run, steps, gpu, queue, readback, post, composed, state, scene };
  }

  it("keeps still export at the requested time despite a playing preview sample", async () => {
    vi.stubGlobal("GPUMapMode", { READ: 1 });
    vi.stubGlobal("GPUBufferUsage", { COPY_DST: 1, MAP_READ: 2 });
    const { run, scene, post } = fixture();
    Object.assign(scene.clock, {
      playing: true,
      timeSeconds: 40,
      sampledAtEpochMs: performance.timeOrigin + performance.now() - 1000,
    });
    await run(7);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "exported", timeSeconds: 7 }),
      expect.any(Array),
    );
  });

  it("fences composition before retiring intermediates and allocating readback", async () => {
    vi.stubGlobal("GPUMapMode", { READ: 1 });
    vi.stubGlobal("GPUBufferUsage", { COPY_DST: 1, MAP_READ: 2 });
    const { run, steps, gpu, queue, readback, post, state } = fixture();
    await run();
    expect(steps).toEqual([
      "submit",
      "fence",
      "retain-composed",
      "output",
      "submit",
      "fence",
      "retire-scratch",
    ]);
    expect(queue.submit).toHaveBeenCalledTimes(2);
    expect(gpu.finishFrame).toHaveBeenCalledTimes(2);
    expect(readback.destroy).toHaveBeenCalledOnce();
    expect(state.activeExportId).toBeNull();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "exported" }),
      expect.any(Array),
    );
  });

  it("retires composition scratch when the output allocation fails", async () => {
    const { run, steps, gpu, post, state } = fixture(true);
    await run();
    expect(steps).toEqual([
      "submit",
      "fence",
      "retain-composed",
      "output",
      "fence",
      "retire-scratch",
    ]);
    expect(gpu.finishFrame).toHaveBeenCalledTimes(2);
    expect(state.activeExportId).toBeNull();
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "exported" }),
      expect.anything(),
    );
  });
});

describe("shared worker GPU batches", () => {
  function stubAdmission<T>(
    runtime: NativeWorkerRuntime,
    batch: (due: readonly T[]) => Promise<void>,
    frame?: (...args: never[]) => Promise<void>,
  ) {
    Object.assign(runtime, {
      recordFlight: async (due: readonly T[], now: number) => {
        await batch(due);
        return { items: due, due, now, fence: Promise.resolve() };
      },
      presentFlight: async () => undefined,
      settleFlights: () => {
        (runtime as unknown as { flights: unknown[] }).flights.length = 0;
      },
      ...(frame ? { frame } : {}),
    });
  }
  function fixture(staged = false, count = 2) {
    const queue = {
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const device = {
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn<() => Promise<{ message: string } | null>>(
        async () => null,
      ),
      createCommandEncoder: vi.fn(() => ({
        beginRenderPass: () => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        }),
        finish: () => ({}),
      })),
      queue,
    };
    const post = vi.fn();
    const runtime = new NativeWorkerRuntime(post);
    const scenes = (runtime as unknown as { scenes: Map<string, unknown> })
      .scenes;
    const texture = { createView: () => ({}) };
    const items = Array.from({ length: count }, (_, index) =>
      String.fromCharCode(97 + index),
    ).map((sceneId) => {
      const current = {
        sceneId,
        generation: 1,
        sourceEpoch: 1,
        authoredEpoch: 1,
        width: 1,
        height: 1,
        pixelRatio: 1,
        viewport: { x: 0, y: 0, width: 1, height: 1 },
        colorSpace: "srgb" as const,
        clock: { playing: true, timeSeconds: 0, speed: 1 },
        definitions: [],
        instances: [],
        targets: [],
        requiredAssets: [],
        records: [],
      };
      const scene = staged
        ? { ...current, generation: 2, clock: { ...current.clock } }
        : current;
      const bank = {};
      const gpu = {
        device,
        spareBank: vi.fn(() => bank),
        tryAcquireFlight: vi.fn(() => ({
          status: "acquired",
          lease: { bank },
        })),
        markFlightSubmitted: vi.fn(),
        releaseFlight: vi.fn(),
        endLegacyFlight: vi.fn(),
        retireIdleWorkForAssetUpload: vi.fn(),
        uploadAsset: vi.fn(),
        dropAsset: vi.fn(),
        beginFrame: vi.fn(),
        finishFrame: vi.fn(),
        stageFinal: vi.fn(() => texture),
        uploadFrame: vi.fn(),
        preparePresentation: vi.fn(),
        pipeline: vi.fn(async () => ({})),
        bind: vi.fn(() => ({})),
        whiteTexture: vi.fn(() => texture),
        context: { getCurrentTexture: vi.fn(() => texture) },
        canvasFormat: "rgba8unorm",
        frontTexture: vi.fn(() => texture),
        frontBank: vi.fn(() => bank),
        validatePublication: vi.fn(),
        publish: vi.fn(),
        trimWork: vi.fn(),
        retireAssets: vi.fn(),
      };
      const signature = sceneCompositionSignature(current);
      const state = {
        gpu,
        current,
        staged: staged ? scene : null,
        currentSignature: signature,
        stagedSignature: staged ? sceneCompositionSignature(scene) : null,
        anchorMs: 0,
        stagedAnchorMs: 0,
        frame: 0,
        failedGeneration: null,
        disposed: false,
        visible: true,
        busy: false,
        exports: [],
        unclaimedAssets: new Map(),
        pendingUploads: new Map(),
        cadence: {
          setPolicy: vi.fn(),
          isSubmissionDue: vi.fn(() => true),
          commitSubmission: vi.fn(),
        },
      };
      scenes.set(sceneId, state);
      return { sceneId, state, scene, gpu, current };
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 3),
    );
    const batch = async () => {
      await (
        runtime as unknown as { pumpAll(now: number): Promise<void> }
      ).pumpAll(16);
      await (
        runtime as unknown as { waitForFlights(): Promise<void> }
      ).waitForFlights();
    };
    return { runtime, post, device, queue, items, batch };
  }

  it("keeps a sampled preview clock continuous across delayed staging and a camera update", async () => {
    const { runtime, post, items } = fixture(false, 1);
    const { state, current } = items[0]!;
    const batchAt = async (
      scene: typeof current,
      staged: boolean,
      now: number,
    ) => {
      expect(staged ? state.staged : state.current).toBe(scene);
      await (
        runtime as unknown as { pumpAll(now: number): Promise<void> }
      ).pumpAll(now);
      await (
        runtime as unknown as { waitForFlights(): Promise<void> }
      ).waitForFlights();
      return post.mock.calls[post.mock.calls.length - 1]?.[0] as {
        timeSeconds: number;
      };
    };
    Object.assign(current.clock, {
      timeSeconds: 4,
      sampledAtEpochMs: performance.timeOrigin + 100,
    });
    state.anchorMs = 200;
    expect((await batchAt(current, false, 200)).timeSeconds).toBeCloseTo(4.1);

    const camera = {
      ...current,
      generation: 2,
      clock: {
        playing: true,
        timeSeconds: 4.132,
        speed: 1,
        sampledAtEpochMs: performance.timeOrigin + 232,
      },
    };
    state.staged = camera;
    state.stagedSignature = state.currentSignature;
    state.stagedAnchorMs = 240;
    expect((await batchAt(camera, true, 248)).timeSeconds).toBeCloseTo(4.148);

    const paused = {
      ...camera,
      generation: 3,
      clock: {
        playing: false,
        timeSeconds: 7,
        speed: 1,
        sampledAtEpochMs: performance.timeOrigin + 248,
      },
    };
    state.staged = paused;
    state.stagedSignature = state.currentSignature;
    expect((await batchAt(paused, true, 400)).timeSeconds).toBe(7);

    const legacy = {
      ...paused,
      generation: 4,
      clock: { playing: true, timeSeconds: 7, speed: 1 },
    };
    state.staged = legacy;
    state.stagedSignature = state.currentSignature;
    state.stagedAnchorMs = 400;
    expect((await batchAt(legacy, true, 416)).timeSeconds).toBeCloseTo(7.016);
  });

  it("stages compact camera generations from one committed scene without recopying content", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    const { runtime, post, items } = fixture();
    const { state, current, sceneId } = items[0]!;
    state.visible = false;
    const camera = {
      type: "camera" as const,
      sceneId,
      generation: 2,
      baseGeneration: 1,
      sourceEpoch: 1,
      authoredEpoch: 1,
      viewport: { x: 5, y: -3, width: 2, height: 1 },
      width: 2,
      height: 1,
      pixelRatio: 1,
      clock: {
        playing: true,
        timeSeconds: 2,
        speed: 1,
        sampledAtEpochMs: performance.timeOrigin + performance.now(),
      },
    };
    await runtime.handle(camera);
    expect(state.staged).toMatchObject({
      generation: 2,
      viewport: camera.viewport,
      clock: camera.clock,
    });
    expect(state.staged?.definitions).toBe(current.definitions);
    expect(state.staged?.instances).toBe(current.instances);
    expect(state.staged?.records).toBe(current.records);
    expect(state.stagedSignature).toBe(state.currentSignature);
    await runtime.handle({
      ...camera,
      generation: 3,
      viewport: { ...camera.viewport, x: 8 },
    });
    expect(state.staged?.generation).toBe(3);
    expect(post).toHaveBeenLastCalledWith({
      type: "scene-staged",
      sceneId,
      generation: 3,
      sourceEpoch: 1,
    });
  });

  it("rejects stale or incompatible camera updates without replacing the last good scene", async () => {
    const { runtime, post, items } = fixture();
    const { state, current, sceneId } = items[0]!;
    state.visible = false;
    const camera = {
      type: "camera" as const,
      sceneId,
      generation: 2,
      baseGeneration: 1,
      sourceEpoch: 1,
      authoredEpoch: 1,
      viewport: { x: 5, y: 0, width: 1, height: 1 },
      width: 1,
      height: 1,
      pixelRatio: 1,
      clock: { playing: true, timeSeconds: 0, speed: 1 },
    };
    await runtime.handle({ ...camera, baseGeneration: 0 });
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        code: "worker-camera-base-stale",
        generation: 2,
      }),
    );
    expect(state.current).toBe(current);
    expect(state.staged).toBeNull();
    await runtime.handle({ ...camera, sourceEpoch: 2 });
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        code: "worker-camera-base-stale",
        generation: 2,
      }),
    );
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "scene-staged", generation: 2 }),
    );
    expect(state.staged).toBeNull();

    await runtime.handle({
      ...camera,
      clock: { ...camera.clock, sampledAtEpochMs: Infinity },
    });
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        code: "scene-geometry-invalid",
        generation: 2,
      }),
    );
    expect(state.current).toBe(current);
    expect(state.staged).toBeNull();

    state.staged = {
      ...current,
      generation: 2,
      definitions: [...current.definitions],
    };
    const incompatible = state.staged;
    await runtime.handle({ ...camera, generation: 3 });
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        code: "worker-camera-base-stale",
        generation: 3,
      }),
    );
    expect(state.staged).toBe(incompatible);
    expect(state.current).toBe(current);
  });

  it("submits render and presentation before one completion fence and then publishes", async () => {
    const { device, queue, items, post, batch } = fixture();
    let release!: () => void;
    const presentFence = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementation(() => presentFence);

    const pending = batch();
    await vi.waitFor(() => expect(queue.submit).toHaveBeenCalledTimes(2));
    expect(device.popErrorScope).toHaveBeenCalledTimes(2);
    expect(queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    expect(queue.submit.mock.calls.map(([buffers]) => buffers.length)).toEqual([
      2, 2,
    ]);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    expect(items.every(({ gpu }) => gpu.trimWork.mock.calls.length === 0)).toBe(
      true,
    );
    expect(
      items.every(({ gpu }) => gpu.retireAssets.mock.calls.length === 0),
    ).toBe(true);
    release();
    await pending;
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 1)).toBe(
      true,
    );
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(2);
  });

  it("drains render work when every staged scene is superseded before presentation", async () => {
    const { device, queue, items, post, batch } = fixture(true);
    const newer = items.map(({ scene }) => ({ ...scene, generation: 3 }));
    device.popErrorScope.mockImplementationOnce(async () => {
      items.forEach(({ state }, index) => {
        state.staged = newer[index]!;
      });
      return null;
    });
    let release!: () => void;
    const fence = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementation(() => fence);

    let finished = false;
    const pending = batch().finally(() => {
      finished = true;
    });
    await vi.waitFor(() =>
      expect(queue.onSubmittedWorkDone).toHaveBeenCalledOnce(),
    );
    expect(queue.submit).toHaveBeenCalledTimes(1);
    expect(device.popErrorScope).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    release();
    await pending;
    items.forEach(({ state }, index) =>
      expect(state.staged).toBe(newer[index]),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("drains render work before restoring a presentation that failed before submit", async () => {
    const { runtime, queue, items, post, batch } = fixture();
    items[0]!.gpu.pipeline.mockRejectedValueOnce(new Error("present failed"));
    const restore = vi.fn(async () => undefined);
    Object.assign(runtime, {
      present: restore,
      frame: vi.fn(async () => undefined),
    });
    let release!: () => void;
    const fence = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementation(() => fence);

    const pending = batch();
    await vi.waitFor(() => expect(items[0]!.gpu.pipeline).toHaveBeenCalled());
    expect(queue.submit).toHaveBeenCalledTimes(1);
    expect(queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
    release();
    await pending;
    expect(restore).toHaveBeenCalledTimes(2);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(0);
  });

  it("publishes an in-flight current frame when a compatible camera stage arrives", async () => {
    const { items, post, queue, batch } = fixture();
    const item = items[0]!;
    let release!: () => void;
    const presentFence = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementation(() => presentFence);

    const pending = batch();
    await vi.waitFor(() => expect(queue.submit).toHaveBeenCalledTimes(2));
    const camera = {
      ...item.current,
      generation: 2,
      viewport: { ...item.current.viewport, height: 2 },
      height: 2,
    };
    item.state.staged = camera;
    item.state.stagedSignature = sceneCompositionSignature(camera);
    release();
    await pending;

    expect(item.gpu.publish).toHaveBeenCalledOnce();
    expect(item.state.current).toBe(item.current);
    expect(item.state.staged).toBe(camera);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "committed",
        sceneId: item.sceneId,
        generation: item.current.generation,
      }),
    );
  });

  it("does not publish a current frame superseded by changed source content", async () => {
    const { items, post, queue, batch } = fixture();
    const item = items[0]!;
    let release!: () => void;
    const presentFence = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementation(() => presentFence);

    const pending = batch();
    await vi.waitFor(() => expect(queue.submit).toHaveBeenCalledTimes(2));
    const changed = { ...item.current, generation: 2, sourceEpoch: 2 };
    item.state.staged = changed;
    item.state.stagedSignature = sceneCompositionSignature(changed);
    release();
    await pending;

    expect(item.gpu.publish).not.toHaveBeenCalled();
    expect(item.state.current).toBe(item.current);
    expect(item.state.staged).toBe(changed);
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "committed", sceneId: item.sceneId }),
    );
  });

  it("does not publish a disposed current frame with a compatible camera queued", async () => {
    const { items, post, queue, batch } = fixture();
    const item = items[0]!;
    let release!: () => void;
    const presentFence = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementation(() => presentFence);

    const pending = batch();
    await vi.waitFor(() => expect(queue.submit).toHaveBeenCalledTimes(2));
    const camera = { ...item.current, generation: 2 };
    item.state.staged = camera;
    item.state.stagedSignature = sceneCompositionSignature(camera);
    item.state.disposed = true;
    release();
    await pending;

    expect(item.gpu.publish).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "committed", sceneId: item.sceneId }),
    );
  });

  it("adopts five camera-only staged scenes in the same validated batch", async () => {
    const { items, batch, post, queue } = fixture(true, 5);
    await batch();
    for (const { state, scene } of items) {
      expect(state.current).toBe(scene);
      expect(state.staged).toBeNull();
    }
    expect(queue.submit.mock.calls.map(([buffers]) => buffers.length)).toEqual([
      5, 5,
    ]);
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(5);
    expect(post.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ generation: 2, committedInstances: [] }),
    );
  });

  it("drains submitted renders before reporting shared validation failure", async () => {
    const { runtime, device, queue, items, post, batch } = fixture();
    Object.assign(runtime, { frame: vi.fn(async () => undefined) });
    device.popErrorScope.mockResolvedValueOnce({ message: "bad batch" });
    let release!: () => void;
    const fence = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementation(() => fence);

    let finished = false;
    const pending = batch().finally(() => {
      finished = true;
    });
    await vi.waitFor(() =>
      expect(queue.onSubmittedWorkDone).toHaveBeenCalledOnce(),
    );
    expect(queue.submit).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    release();
    await pending;
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(0);
  });

  it("restores every touched canvas when a resized peer fails presentation", async () => {
    const { runtime, items, post, batch } = fixture(true);
    const widths = new Map(items.map(({ sceneId }) => [sceneId, 1]));
    items[0]!.scene.width = 2;
    items[0]!.scene.viewport.width = 2;
    for (const { sceneId, gpu } of items)
      gpu.preparePresentation.mockImplementation((scene: { width: number }) => {
        widths.set(sceneId, scene.width);
      });
    items[1]!.gpu.pipeline.mockRejectedValueOnce(new Error("present failed"));
    const restore = vi.fn(
      async (
        _gpu: unknown,
        _bank: unknown,
        scene: { sceneId: string; width: number },
      ) => {
        widths.set(scene.sceneId, scene.width);
      },
    );
    Object.assign(runtime, {
      present: restore,
      frame: vi.fn(async () => undefined),
    });

    await batch();
    expect(widths).toEqual(
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
    );
    expect(restore).toHaveBeenCalledTimes(2);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(0);
  });

  it("restores every touched canvas even when one restore fails", async () => {
    const { runtime, items, post, batch } = fixture(true);
    items[1]!.gpu.pipeline.mockRejectedValueOnce(new Error("present failed"));
    const restore = vi.fn(async () => {
      if (restore.mock.calls.length === 1) throw new Error("restore failed");
    });
    Object.assign(runtime, {
      present: restore,
      frame: vi.fn(async () => undefined),
    });

    await batch();
    expect(restore).toHaveBeenCalledTimes(2);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(0);
  });

  it("restores newly superseded scenes before publishing a healthy peer", async () => {
    const { runtime, items, post, queue, batch } = fixture(true, 3);
    queue.onSubmittedWorkDone.mockImplementationOnce(async () => {
      items[0]!.state.staged = { ...items[0]!.scene, generation: 3 };
    });
    const restore = vi.fn(async () => {
      items[1]!.state.staged = { ...items[1]!.scene, generation: 3 };
    });
    Object.assign(runtime, { present: restore });

    await batch();

    expect(restore).toHaveBeenCalledTimes(3);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("treats viewport geometry as camera work but rejects changed assets", () => {
    const scene = fixture().items[0]!.scene;
    const moved = {
      ...scene,
      viewport: { x: -10, y: 5, width: 2, height: 1 },
      width: 2,
    };
    expect(sceneCompositionSignature(moved)).toBe(
      sceneCompositionSignature(scene),
    );
    expect(
      sceneCompositionSignature({
        ...moved,
        requiredAssets: [{ assetId: "paint", revision: 2 }],
      }),
    ).not.toBe(sceneCompositionSignature(scene));
  });

  it("selects compatible camera generations for one batch", async () => {
    const { runtime, items } = fixture(true, 5);
    for (const { current, scene } of items) {
      current.clock.playing = false;
      scene.clock.playing = true;
      scene.clock.speed = 2;
      scene.viewport.x = -4;
      scene.width = 2;
      scene.viewport.width = 2;
      expect(sceneCompositionSignature(scene)).toBe(
        sceneCompositionSignature(current),
      );
    }
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 3),
    );
    const batch = vi.fn<(due: unknown) => Promise<void>>(async () => undefined);
    const frame = vi.fn(async () => undefined);
    stubAdmission(runtime, batch, frame);

    await (
      runtime as unknown as { pumpAll(now: number): Promise<void> }
    ).pumpAll(16);

    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toEqual(
      items.map(({ sceneId, state, scene }) => ({
        sceneId,
        state,
        scene,
        staged: true,
      })),
    );
    expect(frame).not.toHaveBeenCalled();
  });

  it("coalesces an off-phase camera stage into the next shared animation tick", async () => {
    const { runtime, items } = fixture(true);
    const camera = items[0]!;
    const animated = items[1]!;
    camera.current.clock.playing = false;
    camera.scene.clock.playing = false;
    animated.state.staged = null;
    animated.state.stagedSignature = null;
    const cadence = (
      runtime as unknown as {
        cadenceForRate(rate: 60 | 120): NativePreviewPolicyController;
      }
    ).cadenceForRate(60);
    cadence.commitSubmission(0, false);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 3),
    );
    const batch = vi.fn(
      async (
        due: readonly {
          sceneId: string;
          scene: unknown;
          state: { frame: number };
        }[],
      ) => {
        for (const item of due) item.state.frame++;
      },
    );
    stubAdmission(runtime, batch);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );

    await pump(8);
    expect(batch).not.toHaveBeenCalled();
    const latest = { ...camera.scene, generation: 3 };
    camera.state.staged = latest;
    await pump(16.7);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0].map((item) => item.sceneId)).toEqual([
      camera.sceneId,
      animated.sceneId,
    ]);
    expect(batch.mock.calls[0]?.[0][0]?.scene).toBe(latest);
    await pump(24.8);
    expect(batch).toHaveBeenCalledOnce();
  });

  it("advances the shared deadline after a paused camera-only stage", async () => {
    const { runtime, items } = fixture(true, 1);
    const camera = items[0]!;
    camera.current.clock.playing = false;
    camera.scene.clock.playing = false;
    const cadence = (
      runtime as unknown as {
        cadenceForRate(rate: 60 | 120): NativePreviewPolicyController;
      }
    ).cadenceForRate(60);
    cadence.commitSubmission(0, false);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 3),
    );
    const batch = vi.fn(
      async (due: readonly { state: { frame: number } }[]) => {
        for (const item of due) item.state.frame++;
      },
    );
    stubAdmission(runtime, batch);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );

    await pump(8);
    expect(batch).not.toHaveBeenCalled();
    await pump(16.7);
    expect(batch).toHaveBeenCalledOnce();
    camera.state.staged = { ...camera.scene, generation: 3 };
    await pump(24.8);
    expect(batch).toHaveBeenCalledOnce();
    await pump(33.4);
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it("aligns two scenes adopted eight milliseconds apart without a catch-up burst", async () => {
    const { runtime, items } = fixture(true);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 3),
    );
    const completeFrame = (
      runtime as unknown as { completeFrame: (...args: unknown[]) => void }
    ).completeFrame.bind(runtime);
    for (const [index, item] of items.entries()) {
      const cadence = new NativePreviewPolicyController();
      cadence.setPolicy({ quality: "quality", frameRateTarget: 60 });
      Object.assign(item.state, { cadence });
      completeFrame(
        item.sceneId,
        item.state,
        item.scene,
        true,
        index * 8,
        {},
        { provenance: () => [] },
        0,
      );
    }
    const batch = vi.fn(
      async (due: readonly { state: { frame: number } }[]) => {
        for (const item of due) item.state.frame++;
      },
    );
    stubAdmission(runtime, batch);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );

    await pump(16.7);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    await pump(24.8);
    expect(batch).toHaveBeenCalledTimes(1);
    await pump(33.4);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1]?.[0]).toHaveLength(2);
  });

  it("keeps 60 Hz scenes at half the 120 Hz admission rate", async () => {
    const { runtime, items } = fixture();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 3),
    );
    Object.assign(items[1]!.scene, { frameRateTarget: 120 });
    const cadence = (
      runtime as unknown as {
        cadenceForRate(rate: 60 | 120): NativePreviewPolicyController;
      }
    ).cadenceForRate.bind(runtime);
    cadence(60).commitSubmission(0, false);
    cadence(120).commitSubmission(0, false);
    const batch = vi.fn(
      async (due: readonly { sceneId: string; state: { frame: number } }[]) => {
        for (const item of due) item.state.frame++;
      },
    );
    stubAdmission(runtime, batch);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );

    await pump(8.4);
    expect(batch.mock.calls[0]?.[0].map((item) => item.sceneId)).toEqual(["b"]);
    await pump(16.7);
    expect(batch.mock.calls[1]?.[0].map((item) => item.sceneId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("isolates a failed scene without latching a healthy peer", async () => {
    const { runtime, items, post } = fixture();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 3),
    );
    const batch = vi.fn(async () => {
      throw new Error("shared validation failed");
    });
    const frame = vi.fn(async (sceneId: string) => {
      if (sceneId === "a") throw new Error("scene a invalid");
    });
    stubAdmission(runtime, batch, frame);

    await (
      runtime as unknown as { pumpAll(now: number): Promise<void> }
    ).pumpAll(16);

    expect(frame.mock.calls.map(([sceneId]) => sceneId)).toEqual(["a", "b"]);
    expect(items[0]?.state.failedGeneration).toBe(1);
    expect(items[1]?.state.failedGeneration).toBeNull();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        sceneId: "a",
        generation: 1,
      }),
    );
  });

  it("submits a second frame before the first presentation validation settles", async () => {
    const { runtime, device, queue, post, items } = fixture(false, 1);
    let validateFirst!: (error: { message: string } | null) => void;
    const firstValidation = new Promise<{ message: string } | null>(
      (resolve) => {
        validateFirst = resolve;
      },
    );
    device.popErrorScope
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => firstValidation);
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    queue.onSubmittedWorkDone
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSecond = resolve;
          }),
      );
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    const first = pump(16);
    await vi.waitFor(() => expect(queue.submit).toHaveBeenCalledTimes(2));
    try {
      const firstReturned = await Promise.race([
        first.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 80)),
      ]);
      expect(firstReturned).toBe(true);
      await pump(33.4);
      expect(queue.submit).toHaveBeenCalledTimes(4);
      expect(items[0]!.gpu.finishFrame).toHaveBeenCalledTimes(4);
      finishSecond();
      await Promise.resolve();
      expect(post).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "committed" }),
      );
      validateFirst(null);
      finishFirst();
      await (
        runtime as unknown as { waitForFlights(): Promise<void> }
      ).waitForFlights();
      expect(
        post.mock.calls
          .filter(([message]) => message.type === "committed")
          .map(([message]) => message.frame),
      ).toEqual([1, 2]);
    } finally {
      validateFirst(null);
      finishFirst?.();
      finishSecond?.();
      await first;
    }
  });

  it("submits B presentation once when A settles during B record validation", async () => {
    const { runtime, device, queue, post, items } = fixture(false, 1);
    let validateSecondRecord!: (error: { message: string } | null) => void;
    const secondRecordValidation = new Promise<{ message: string } | null>(
      (resolve) => {
        validateSecondRecord = resolve;
      },
    );
    device.popErrorScope
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => secondRecordValidation);
    let finishFirst!: () => void;
    queue.onSubmittedWorkDone.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    const second = pump(33.4);
    await vi.waitFor(() => expect(queue.submit).toHaveBeenCalledTimes(3));
    finishFirst();
    await Promise.resolve();
    validateSecondRecord(null);
    await second;
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(queue.submit).toHaveBeenCalledTimes(4);
    expect(items[0]!.gpu.publish).toHaveBeenCalledTimes(2);
    expect(
      post.mock.calls
        .filter(([message]) => message.type === "committed")
        .map(([message]) => message.frame),
    ).toEqual([1, 2]);
  });

  it("shares a pre-fence presentation failure across queued callers", async () => {
    const { runtime, queue, items } = fixture(false, 1);
    const item = items[0]!;
    const worker = runtime as unknown as {
      recordFlight(due: unknown[], now: number): Promise<unknown>;
      presentFlight(flight: unknown): Promise<void>;
    };
    const flight = await worker.recordFlight(
      [
        {
          sceneId: item.sceneId,
          state: item.state,
          scene: item.scene,
          staged: false,
        },
      ],
      16,
    );
    expect(flight).not.toBeNull();
    const failure = new Error("presentation preparation failed");
    item.gpu.preparePresentation.mockImplementationOnce(() => {
      throw failure;
    });

    const first = worker.presentFlight(flight);
    const second = worker.presentFlight(flight);
    const outcomes = await Promise.allSettled([first, second]);
    expect(second).toBe(first);
    expect(outcomes).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(item.gpu.preparePresentation).toHaveBeenCalledOnce();
    expect(queue.submit).toHaveBeenCalledOnce();
  });

  it("holds a failed presentation lease through GPU completion before rollback and export", async () => {
    const { runtime, device, queue, post, items } = fixture(false, 1);
    const item = items[0]!;
    let rejectValidation!: (error: Error) => void;
    const validation = new Promise<{ message: string } | null>(
      (_resolve, reject) => {
        rejectValidation = reject;
      },
    );
    device.popErrorScope
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => validation);
    let rejectFence!: (error: Error) => void;
    queue.onSubmittedWorkDone.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFence = reject;
        }),
    );
    const restore = vi.fn(async () => undefined);
    const exported = vi.fn(async () => undefined);
    const isolatedFrame = vi.fn(async () => undefined);
    Object.assign(runtime, {
      present: restore,
      exportScene: exported,
      frame: isolatedFrame,
    });
    const recover = vi.spyOn(
      runtime as unknown as { recoverFlights(error: unknown): Promise<void> },
      "recoverFlights",
    );
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    (item.state.exports as unknown[]).push({
      requestId: "export",
      scene: item.current,
    });
    await pump(33.4);
    expect(exported).not.toHaveBeenCalled();
    const validationError = new Error("presentation scope rejected");
    const fenceError = new Error("presentation fence rejected");
    rejectValidation(validationError);
    await Promise.resolve();
    expect(item.gpu.releaseFlight).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(exported).not.toHaveBeenCalled();
    rejectFence(fenceError);
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(item.gpu.releaseFlight).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(item.gpu.publish).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "committed" }),
    );
    const failure = recover.mock.calls[0]?.[0];
    expect(failure).toMatchObject({
      code: "gpu-presentation-failed",
      errors: [validationError, fenceError],
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", code: "gpu-batch-validation" }),
    );
    await pump(50.1);
    expect(exported).toHaveBeenCalledOnce();
  });

  it("presents B while A completion is pending but publishes in fence order", async () => {
    const { runtime, queue, post, items } = fixture();
    let finishA!: () => void;
    let finishB!: () => void;
    const fenceA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    const fenceB = new Promise<void>((resolve) => {
      finishB = resolve;
    });
    queue.onSubmittedWorkDone
      .mockImplementationOnce(() => fenceA)
      .mockImplementationOnce(() => fenceB);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await pump(33.4);
    expect(queue.submit).toHaveBeenCalledTimes(4);
    expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
    const submitted = (
      runtime as unknown as {
        flights: Array<{ presentationSubmittedAtMs: number | null }>;
      }
    ).flights.map((flight) => flight.presentationSubmittedAtMs);
    expect(submitted).toEqual([expect.any(Number), expect.any(Number)]);
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(0);
    finishA();
    await vi.waitFor(() =>
      expect(
        post.mock.calls.filter(([message]) => message.type === "committed"),
      ).toHaveLength(2),
    );
    expect(
      post.mock.calls
        .filter(([message]) => message.type === "committed")
        .map(([message]) => message.presentationSubmittedAtMs),
    ).toEqual([submitted[0], submitted[0]]);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 1)).toBe(
      true,
    );
    finishB();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(4);
    expect(
      post.mock.calls
        .filter(([message]) => message.type === "committed")
        .map(([message]) => message.presentationSubmittedAtMs),
    ).toEqual([submitted[0], submitted[0], submitted[1], submitted[1]]);
  });

  it("submits a newer camera while the prior camera's second fence is pending", async () => {
    const { runtime, queue, post, items } = fixture(true, 1);
    const item = items[0]!;
    let finishA!: () => void;
    let finishB!: () => void;
    let finishC!: () => void;
    const fenceA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    const fenceB = new Promise<void>((resolve) => {
      finishB = resolve;
    });
    const fenceC = new Promise<void>((resolve) => {
      finishC = resolve;
    });
    queue.onSubmittedWorkDone
      .mockImplementationOnce(() => fenceA)
      .mockImplementationOnce(() => fenceB)
      .mockImplementationOnce(() => fenceC);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await pump(33.4);
    expect(queue.submit).toHaveBeenCalledTimes(4);
    expect(post).not.toHaveBeenCalled();
    finishA();
    await vi.waitFor(() => expect(item.state.current).toBe(item.scene));
    await runtime.handle({
      type: "camera",
      sceneId: item.sceneId,
      generation: 3,
      baseGeneration: item.scene.generation,
      sourceEpoch: item.scene.sourceEpoch,
      authoredEpoch: item.scene.authoredEpoch,
      viewport: { ...item.scene.viewport, x: 2 },
      width: item.scene.width,
      height: item.scene.height,
      pixelRatio: item.scene.pixelRatio,
      clock: item.scene.clock,
    });
    const cameraC = item.state.staged;
    expect(cameraC).not.toBeNull();
    await pump(50.1);
    expect(queue.submit).toHaveBeenCalledTimes(6);
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(1);
    finishB();
    await vi.waitFor(() =>
      expect(
        post.mock.calls.filter(([message]) => message.type === "committed"),
      ).toHaveLength(2),
    );
    expect(item.state.staged).toBe(cameraC);
    finishC();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(item.state.current).toBe(cameraC);
    expect(item.state.staged).toBeNull();
    expect(item.state.currentSignature).toBe(
      sceneCompositionSignature(cameraC!),
    );
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(3);
  });

  it("does not publish an overlapped camera after authored content changes", async () => {
    const { runtime, queue, post, items } = fixture(true, 1);
    const item = items[0]!;
    let finishA!: () => void;
    let finishB!: () => void;
    let finishC!: () => void;
    queue.onSubmittedWorkDone
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishB = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishC = resolve;
          }),
      );
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await pump(33.4);
    finishA();
    await vi.waitFor(() => expect(item.state.current).toBe(item.scene));
    await runtime.handle({
      type: "camera",
      sceneId: item.sceneId,
      generation: 3,
      baseGeneration: item.scene.generation,
      sourceEpoch: item.scene.sourceEpoch,
      authoredEpoch: item.scene.authoredEpoch,
      viewport: { ...item.scene.viewport, x: 2 },
      width: item.scene.width,
      height: item.scene.height,
      pixelRatio: item.scene.pixelRatio,
      clock: item.scene.clock,
    });
    await pump(50.1);
    expect(queue.submit).toHaveBeenCalledTimes(6);
    const authoredD = {
      ...item.state.staged!,
      generation: 4,
      authoredEpoch: item.scene.authoredEpoch + 1,
    };
    item.state.staged = authoredD;
    item.state.stagedSignature = sceneCompositionSignature(authoredD);
    finishB();
    finishC();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(item.state.current).toBe(item.scene);
    expect(item.state.staged).toBe(authoredD);
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(1);
  });

  it("does not duplicate a paused camera stage while its first frame is pending", async () => {
    const { runtime, queue, items } = fixture(true, 1);
    items[0]!.scene.clock.playing = false;
    let finish!: () => void;
    queue.onSubmittedWorkDone.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await pump(33.4);
    expect(queue.submit).toHaveBeenCalledTimes(2);
    finish();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
  });

  it("restores a scene introduced only in B if A completion fails", async () => {
    const { runtime, queue, post, items } = fixture();
    items[1]!.state.visible = false;
    let failA!: (error: Error) => void;
    let finishB!: () => void;
    const fenceA = new Promise<void>((_resolve, reject) => {
      failA = reject;
    });
    const fenceB = new Promise<void>((resolve) => {
      finishB = resolve;
    });
    queue.onSubmittedWorkDone
      .mockImplementationOnce(() => fenceA)
      .mockImplementationOnce(() => fenceB);
    const restore = vi.fn(async () => undefined);
    Object.assign(runtime, {
      present: restore,
      frame: vi.fn(async () => undefined),
    });
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    items[1]!.state.visible = true;
    await pump(33.4);
    expect(queue.submit).toHaveBeenCalledTimes(4);
    failA(new Error("A fence failed"));
    finishB();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(0);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(items[0]!.gpu.releaseFlight).toHaveBeenCalledTimes(2);
    expect(items[1]!.gpu.releaseFlight).toHaveBeenCalledTimes(1);
  });

  it("restores the newly committed A front if B completion fails", async () => {
    const { runtime, queue, post, items } = fixture();
    let finishA!: () => void;
    let failB!: (error: Error) => void;
    const fenceA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    const fenceB = new Promise<void>((_resolve, reject) => {
      failB = reject;
    });
    queue.onSubmittedWorkDone
      .mockImplementationOnce(() => fenceA)
      .mockImplementationOnce(() => fenceB);
    const restore = vi.fn(async () => undefined);
    Object.assign(runtime, {
      present: restore,
      frame: vi.fn(async () => undefined),
    });
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await pump(33.4);
    failB(new Error("B fence failed before A completed"));
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(0);
    finishA();
    await vi.waitFor(() =>
      expect(
        post.mock.calls.filter(([message]) => message.type === "committed"),
      ).toHaveLength(2),
    );
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(restore).toHaveBeenCalledTimes(2);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 1)).toBe(
      true,
    );
    expect(
      post.mock.calls.filter(([message]) => message.type === "committed"),
    ).toHaveLength(2);
  });

  it("uses A's adopted camera geometry when restoring after B fails", async () => {
    const { runtime, queue, items } = fixture(true, 1);
    let finishA!: () => void;
    let failB!: (error: Error) => void;
    queue.onSubmittedWorkDone
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failB = reject;
          }),
      );
    const restore = vi.fn(async () => undefined);
    Object.assign(runtime, {
      present: restore,
      frame: vi.fn(async () => undefined),
    });
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await pump(33.4);
    finishA();
    await vi.waitFor(() =>
      expect(items[0]!.state.current).toBe(items[0]!.scene),
    );
    failB(new Error("B fence failed"));
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(restore).toHaveBeenCalledWith(
      items[0]!.gpu,
      expect.anything(),
      items[0]!.scene,
      expect.anything(),
      null,
    );
  });

  it("releases both leases and reports a persistent drain failure", async () => {
    const { runtime, queue, post, items } = fixture(false, 1);
    let failA!: (error: Error) => void;
    let finishB!: () => void;
    queue.onSubmittedWorkDone
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failA = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishB = resolve;
          }),
      )
      .mockRejectedValue(new Error("device lost during drain"));
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await pump(33.4);
    failA(new Error("A fence failed"));
    finishB();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(items[0]!.gpu.releaseFlight).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          code: "gpu-flight-drain-failed",
        }),
      ),
    );
  });

  it("falls back to one flight when the second lease exceeds the budget", async () => {
    const { runtime, queue, items } = fixture(false, 1);
    let finishA!: () => void;
    const fenceA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementationOnce(() => fenceA);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    items[0]!.gpu.tryAcquireFlight.mockReturnValueOnce({
      status: "capacity",
      reason: "memory-budget",
    } as never);
    await pump(33.4);
    expect(queue.submit).toHaveBeenCalledTimes(2);
    finishA();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    await pump(50.1);
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(queue.submit).toHaveBeenCalledTimes(4);
    expect(items[0]!.gpu.publish).toHaveBeenCalledTimes(2);
  });

  it("waits for a flight fence before starting an immutable export", async () => {
    const { runtime, queue, items } = fixture(false, 1);
    let finishA!: () => void;
    const fenceA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    queue.onSubmittedWorkDone.mockImplementationOnce(() => fenceA);
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    const exported = vi.fn(async () => undefined);
    Object.assign(runtime, { exportScene: exported });
    await pump(16);
    (items[0]!.state.exports as unknown[]).push({
      requestId: "export",
      scene: items[0]!.current,
    });
    await pump(33.4);
    expect(exported).not.toHaveBeenCalled();
    finishA();
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    await pump(50.1);
    expect(exported).toHaveBeenCalledOnce();
  });

  it("lets a queued asset upload drain flights before another animation admission", async () => {
    const { runtime, queue, items } = fixture(false, 1);
    let finishA!: () => void;
    queue.onSubmittedWorkDone.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishA = resolve;
        }),
    );
    const pump = (now: number) =>
      (runtime as unknown as { pumpAll(now: number): Promise<void> }).pumpAll(
        now,
      );
    await pump(16);
    await runtime.handle({
      type: "asset",
      sceneId: items[0]!.sceneId,
      assetId: "new-source",
      revision: 1,
      generation: 1,
      kind: "rgba16float",
      width: 1,
      height: 1,
      data: new ArrayBuffer(8),
    });
    await pump(33.4);
    expect(queue.submit).toHaveBeenCalledTimes(2);
    expect(items[0]!.gpu.uploadAsset).not.toHaveBeenCalled();
    finishA();
    await vi.waitFor(() =>
      expect(items[0]!.gpu.uploadAsset).toHaveBeenCalledOnce(),
    );
    await vi.waitFor(() => expect(items[0]!.state.pendingUploads.size).toBe(0));
    await pump(50.1);
    await (
      runtime as unknown as { waitForFlights(): Promise<void> }
    ).waitForFlights();
    expect(queue.submit).toHaveBeenCalledTimes(4);
  });

  it("holds an asset upload while a frame is still recording", async () => {
    const { runtime, queue, items } = fixture(false, 1);
    let finishRender!: () => void;
    let finishFence!: () => void;
    const render = new Promise<void>((resolve) => {
      finishRender = resolve;
    });
    const fence = new Promise<void>((resolve) => {
      finishFence = resolve;
    });
    const compose = vi.mocked(composeNativeWorkerScene);
    const original = compose.getMockImplementation()!;
    compose.mockClear();
    compose.mockImplementationOnce(async (...args) => {
      await render;
      return original(...args);
    });
    queue.onSubmittedWorkDone.mockImplementationOnce(() => fence);
    const pump = (
      runtime as unknown as { pumpAll(now: number): Promise<void> }
    ).pumpAll(16);
    await vi.waitFor(() => expect(compose).toHaveBeenCalledOnce());
    await runtime.handle({
      type: "asset",
      sceneId: items[0]!.sceneId,
      assetId: "new-source",
      revision: 1,
      generation: 1,
      kind: "rgba16float",
      width: 1,
      height: 1,
      data: new ArrayBuffer(8),
    });
    expect(items[0]!.gpu.uploadAsset).not.toHaveBeenCalled();
    finishRender();
    await pump;
    expect(items[0]!.gpu.uploadAsset).not.toHaveBeenCalled();
    finishFence();
    await vi.waitFor(() =>
      expect(items[0]!.gpu.uploadAsset).toHaveBeenCalledOnce(),
    );
  });
});
