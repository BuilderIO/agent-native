import { afterEach, describe, expect, it, vi } from "vitest";

import { NativePreviewPolicyController } from "./native-preview-policy";
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
    expect(request).toHaveBeenCalledOnce();
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

describe("shared worker GPU batches", () => {
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
        cadence: {
          setPolicy: vi.fn(),
          isSubmissionDue: vi.fn(() => true),
          commitSubmission: vi.fn(),
        },
      };
      scenes.set(sceneId, state);
      return { sceneId, state, scene, gpu, current };
    });
    const batch = () =>
      (
        runtime as unknown as {
          batchCurrent(due: readonly unknown[], now: number): Promise<void>;
        }
      ).batchCurrent(
        items.map(({ sceneId, state, scene }) => ({
          sceneId,
          state,
          scene,
          staged,
        })),
        16,
      );
    return { runtime, post, device, queue, items, batch };
  }

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
    expect(device.popErrorScope).toHaveBeenCalledTimes(2);
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
    Object.assign(runtime, { present: restore });
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
    await expect(pending).rejects.toThrow("present failed");
    expect(restore).toHaveBeenCalledOnce();
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    expect(post).not.toHaveBeenCalled();
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
    const { device, queue, items, post, batch } = fixture();
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
    await expect(pending).rejects.toThrow("bad batch");
    expect(post).not.toHaveBeenCalled();
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
    Object.assign(runtime, { present: restore });

    await expect(batch()).rejects.toThrow("present failed");
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
    expect(post).not.toHaveBeenCalled();
  });

  it("restores every touched canvas even when one restore fails", async () => {
    const { runtime, items, post, batch } = fixture(true);
    items[1]!.gpu.pipeline.mockRejectedValueOnce(new Error("present failed"));
    const restore = vi.fn(async () => {
      if (restore.mock.calls.length === 1) throw new Error("restore failed");
    });
    Object.assign(runtime, { present: restore });

    await expect(batch()).rejects.toMatchObject({
      code: "presentation-restore-failed",
    });
    expect(restore).toHaveBeenCalledTimes(2);
    expect(items.every(({ gpu }) => gpu.publish.mock.calls.length === 0)).toBe(
      true,
    );
    expect(post).not.toHaveBeenCalled();
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

    expect(restore).toHaveBeenCalledTimes(4);
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
    Object.assign(runtime, { batchCurrent: batch, frame });

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
    Object.assign(runtime, { batchCurrent: batch });
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
    Object.assign(runtime, { batchCurrent: batch });
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
    Object.assign(runtime, { batchCurrent: batch });
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
    Object.assign(runtime, { batchCurrent: batch });
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
    Object.assign(runtime, { batchCurrent: batch, frame });

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
});
