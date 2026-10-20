// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NativeWorkerBroker } from "./native-worker-broker";
import { NativeWorkerHost, NativeWorkerHostError } from "./native-worker-host";
import { NATIVE_WORKER_PROTOCOL_VERSION } from "./native-worker-protocol";

class FakeWorker {
  static latest: FakeWorker | null = null;
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

function setup(): HTMLCanvasElement {
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:worker-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "transferControlToOffscreen", {
    configurable: true,
    value: () => ({ width: 1, height: 1 }),
  });
  return canvas;
}

function pageHide(persisted: boolean): PageTransitionEvent {
  const event = new PageTransitionEvent("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

afterEach(() => {
  delete (window as Window & { __agentNativeDesignWorkerBrokerV1?: unknown })
    .__agentNativeDesignWorkerBrokerV1;
  FakeWorker.latest = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NativeWorkerHost lifecycle", () => {
  it("retains a cached page's worker and releases it on a real unload", () => {
    const host = new NativeWorkerHost(
      "source",
      "scene",
      setup(),
      () => {},
      () => {},
    );
    const worker = FakeWorker.latest!;
    window.dispatchEvent(pageHide(true));
    expect(worker.terminated).toBe(false);
    window.dispatchEvent(pageHide(false));
    expect(worker.terminated).toBe(true);
    host.dispose();
  });

  it("observes an unexpected disposal send failure after releasing the lease", () => {
    const release = vi.fn();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "__agentNativeDesignWorkerBrokerV1", {
      configurable: true,
      value: {
        acquire: () => ({
          post: (message: { type: string }) => {
            if (message.type === "dispose") throw new Error("transport failed");
          },
          release,
        }),
      },
    });
    const host = new NativeWorkerHost(
      "source",
      "scene",
      setup(),
      () => {},
      () => {},
    );
    host.dispose();
    expect(release).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ code: "worker-dispose-send-failed" }),
    );
  });

  it("does not report an already closed worker during disposal", () => {
    const release = vi.fn();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "__agentNativeDesignWorkerBrokerV1", {
      configurable: true,
      value: {
        acquire: () => ({
          post: (message: { type: string }) => {
            if (message.type === "dispose")
              throw {
                name: "NativeWorkerBrokerError",
                code: "worker-disposed",
                message: "The worker has closed.",
              };
          },
          release,
        }),
      },
    });
    const host = new NativeWorkerHost(
      "source",
      "scene",
      setup(),
      () => {},
      () => {},
    );
    host.dispose();
    expect(release).toHaveBeenCalledOnce();
    expect(logged).not.toHaveBeenCalled();
  });
  it("preserves a parent-realm broker error during acquisition", () => {
    Object.defineProperty(window, "__agentNativeDesignWorkerBrokerV1", {
      configurable: true,
      value: {
        acquire: () => {
          throw {
            name: "NativeWorkerBrokerError",
            code: "worker-scene-duplicate",
            message: "The scene ID is already in use.",
          };
        },
      },
    });
    let thrown: unknown;
    try {
      new NativeWorkerHost(
        "source",
        "scene",
        setup(),
        () => {},
        () => {},
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NativeWorkerHostError);
    expect(thrown).toMatchObject({
      code: "worker-scene-duplicate",
      message: "The scene ID is already in use.",
    });
    expect(FakeWorker.latest).toBeNull();
  });

  it("preserves a parent-realm broker error from an existing scene lease", async () => {
    let listener: Parameters<NativeWorkerBroker["acquire"]>[2] | null = null;
    const release = vi.fn();
    Object.defineProperty(window, "__agentNativeDesignWorkerBrokerV1", {
      configurable: true,
      value: {
        acquire: (
          _source: string,
          _sceneId: string,
          next: Parameters<NativeWorkerBroker["acquire"]>[2],
        ) => {
          listener = next;
          return {
            post: (message: { type: string }) => {
              if (message.type === "visibility")
                throw {
                  name: "NativeWorkerBrokerError",
                  code: "worker-disposed",
                  message: "The shared worker lease is gone.",
                };
            },
            release,
          };
        },
      },
    });
    const host = new NativeWorkerHost(
      "source",
      "scene",
      setup(),
      () => {},
      () => {},
    );
    listener!.message({
      type: "ready",
      sceneId: "scene",
      protocol: NATIVE_WORKER_PROTOCOL_VERSION,
    });
    await host.readyPromise;
    let thrown: unknown;
    try {
      host.setVisible(false);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NativeWorkerHostError);
    expect(thrown).toMatchObject({
      code: "worker-disposed",
      message: "The shared worker lease is gone.",
    });
    host.dispose();
    expect(release).toHaveBeenCalledOnce();
  });

  it("reports worker constructor failure and revokes its source URL", () => {
    const canvas = setup();
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("start failed");
        }
      },
    );
    expect(
      () =>
        new NativeWorkerHost(
          "self.onmessage=()=>{}",
          "scene",
          canvas,
          () => {},
          () => {},
        ),
    ).toThrowError(NativeWorkerHostError);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:worker-test");
  });

  it("terminates the worker when canvas transfer fails", () => {
    const canvas = setup();
    Object.defineProperty(canvas, "transferControlToOffscreen", {
      configurable: true,
      value: () => {
        throw new Error("transfer failed");
      },
    });
    expect(
      () =>
        new NativeWorkerHost(
          "self.onmessage=()=>{}",
          "scene",
          canvas,
          () => {},
          () => {},
        ),
    ).toThrowError(/transfer failed/);
    expect(FakeWorker.latest?.terminated).toBe(true);
  });

  it("rejects initialization errors instead of leaving readiness pending", async () => {
    const canvas = setup();
    const failures: NativeWorkerHostError[] = [];
    const host = new NativeWorkerHost(
      "self.onmessage=()=>{}",
      "scene",
      canvas,
      () => {},
      (error) => failures.push(error),
    );
    FakeWorker.latest!.receive({
      type: "error",
      sceneId: "scene",
      code: "gpu-device-unavailable",
      message: "device failed",
    });
    await expect(host.readyPromise).rejects.toMatchObject({
      code: "gpu-device-unavailable",
    });
    expect(failures).toHaveLength(1);
    expect(FakeWorker.latest?.terminated).toBe(true);
  });

  it("applies hidden visibility after ready and before the first scene", async () => {
    const host = new NativeWorkerHost(
      "self.onmessage=()=>{}",
      "scene",
      setup(),
      () => {},
      () => {},
    );
    const worker = FakeWorker.latest!;
    host.setVisible(false);
    expect(
      worker.messages.map((message) => (message as { type: string }).type),
    ).toEqual(["init"]);
    worker.receive({
      type: "ready",
      sceneId: "scene",
      protocol: NATIVE_WORKER_PROTOCOL_VERSION,
    });
    await host.sendScene(
      {
        sceneId: "scene",
        generation: 1,
        sourceEpoch: 1,
        authoredEpoch: 1,
        viewport: { x: 0, y: 0, width: 1, height: 1 },
        width: 1,
        height: 1,
        pixelRatio: 1,
        colorSpace: "srgb",
        clock: { playing: false, timeSeconds: 0, speed: 1 },
        requiredAssets: [],
        definitions: [],
        instances: [],
        targets: [],
        records: [],
      },
      [],
    );
    expect(
      worker.messages.map((message) => (message as { type: string }).type),
    ).toEqual(["init", "visibility", "scene"]);
    expect(worker.messages[1]).toMatchObject({ visible: false });
    host.dispose();
  });

  it("keeps the committed scene when a newer scene only stages", async () => {
    const canvas = setup();
    const commits: number[] = [];
    const host = new NativeWorkerHost(
      "self.onmessage=()=>{}",
      "scene",
      canvas,
      (message) => commits.push(message.generation),
      () => {},
    );
    const worker = FakeWorker.latest!;
    worker.receive({
      type: "ready",
      sceneId: "scene",
      protocol: NATIVE_WORKER_PROTOCOL_VERSION,
    });
    const scene = (
      generation: number,
    ): Parameters<typeof host.sendScene>[0] => ({
      sceneId: "scene",
      generation,
      sourceEpoch: generation,
      authoredEpoch: generation,
      viewport: { x: 0, y: 0, width: 1, height: 1 },
      width: 1,
      height: 1,
      pixelRatio: 1,
      colorSpace: "srgb",
      clock: { playing: false, timeSeconds: 0, speed: 1 },
      requiredAssets: [],
      definitions: [],
      instances: [],
      targets: [],
      records: [],
    });
    await host.sendScene(scene(1), []);
    worker.receive({
      type: "scene-staged",
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 1,
    });
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 1,
      frame: 1,
      presentedAtMs: 16,
      timeSeconds: 0,
    });
    await host.sendScene(scene(2), []);
    worker.receive({
      type: "scene-staged",
      sceneId: "scene",
      generation: 2,
      sourceEpoch: 2,
    });
    expect(commits).toEqual([1]);
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 2,
      sourceEpoch: 2,
      frame: 1,
      presentedAtMs: 32,
      timeSeconds: 0,
    });
    expect(commits).toEqual([1, 2]);
    host.dispose();
  });

  it("forwards active animation commits while only a compatible camera scene stages", async () => {
    const commits: number[] = [];
    const host = new NativeWorkerHost(
      "self.onmessage=()=>{}",
      "scene",
      setup(),
      (message) => commits.push(message.generation),
      () => {},
    );
    const worker = FakeWorker.latest!;
    worker.receive({
      type: "ready",
      sceneId: "scene",
      protocol: NATIVE_WORKER_PROTOCOL_VERSION,
    });
    const active: Parameters<typeof host.sendScene>[0] = {
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 7,
      authoredEpoch: 3,
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      width: 100,
      height: 100,
      pixelRatio: 1,
      colorSpace: "srgb",
      clock: { playing: true, timeSeconds: 0, speed: 1 },
      requiredAssets: [],
      definitions: [],
      instances: [],
      targets: [],
      records: [],
    };
    await host.sendScene(active, []);
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 7,
      frame: 1,
      presentedAtMs: 16,
      timeSeconds: 0,
    });
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 7,
      frame: 2,
      presentedAtMs: 24,
      timeSeconds: 0.008,
    });
    expect(commits).toEqual([1, 1]);
    const camera = {
      ...active,
      generation: 2,
      viewport: { x: 20, y: 0, width: 100, height: 100 },
    };
    await host.sendScene(camera, [], { retainActiveCommitsWhileStaged: true });
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 7,
      frame: 3,
      presentedAtMs: 32,
      timeSeconds: 0.016,
    });
    expect(commits).toEqual([1, 1, 1]);
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 2,
      sourceEpoch: 7,
      frame: 1,
      presentedAtMs: 48,
      timeSeconds: 0.032,
    });
    expect(commits).toEqual([1, 1, 1, 2]);
    await host.sendScene({ ...camera, generation: 3 }, [], {
      retainActiveCommitsWhileStaged: true,
    });
    worker.receive({
      type: "error",
      sceneId: "scene",
      generation: 3,
      code: "gpu-validation",
      message: "The camera scene failed validation.",
    });
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 2,
      sourceEpoch: 7,
      frame: 2,
      presentedAtMs: 64,
      timeSeconds: 0.048,
    });
    expect(commits).toEqual([1, 1, 1, 2, 2]);
    await host.sendScene({ ...camera, generation: 4, sourceEpoch: 8 }, []);
    worker.receive({
      type: "committed",
      sceneId: "scene",
      generation: 2,
      sourceEpoch: 7,
      frame: 3,
      presentedAtMs: 80,
      timeSeconds: 0.064,
    });
    expect(commits).toEqual([1, 1, 1, 2, 2]);
    host.dispose();
  });

  it("rejects camera retention when source content is not the active immutable scene", async () => {
    const host = new NativeWorkerHost(
      "self.onmessage=()=>{}",
      "scene",
      setup(),
      () => {},
      () => {},
    );
    FakeWorker.latest!.receive({
      type: "ready",
      sceneId: "scene",
      protocol: NATIVE_WORKER_PROTOCOL_VERSION,
    });
    const active: Parameters<typeof host.sendScene>[0] = {
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 7,
      authoredEpoch: 3,
      viewport: { x: 0, y: 0, width: 1, height: 1 },
      width: 1,
      height: 1,
      pixelRatio: 1,
      colorSpace: "srgb",
      clock: { playing: true, timeSeconds: 0, speed: 1 },
      requiredAssets: [],
      definitions: [],
      instances: [],
      targets: [],
      records: [],
    };
    await host.sendScene(active, []);
    FakeWorker.latest!.receive({
      type: "committed",
      sceneId: "scene",
      generation: 1,
      sourceEpoch: 7,
      frame: 1,
      presentedAtMs: 16,
      timeSeconds: 0,
    });
    for (const candidate of [
      { ...active, generation: 2, instances: [...active.instances] },
      { ...active, generation: 2, sourceEpoch: 8 },
      { ...active, generation: 2, pixelRatio: 2 },
    ])
      await expect(
        host.sendScene(candidate, [], {
          retainActiveCommitsWhileStaged: true,
        }),
      ).rejects.toMatchObject({ code: "worker-camera-incompatible" });
    host.dispose();
  });
});
