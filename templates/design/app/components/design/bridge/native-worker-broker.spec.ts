// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NativeWorkerBroker,
  acquireNativeWorkerLease,
  installNativeWorkerBroker,
} from "./native-worker-broker";
import { NativeWorkerHost } from "./native-worker-host";
import { NATIVE_WORKER_PROTOCOL_VERSION } from "./native-worker-protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;

  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
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

  fail(): void {
    this.onerror?.({
      message: "worker crashed",
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent);
  }
}

function canvas(): HTMLCanvasElement {
  const element = document.createElement("canvas");
  Object.defineProperty(element, "transferControlToOffscreen", {
    value: () => ({ width: 1, height: 1 }),
  });
  return element;
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:worker-${FakeWorker.instances.length + 1}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  delete (window as Window & { __agentNativeDesignWorkerBrokerV1?: unknown })
    .__agentNativeDesignWorkerBrokerV1;
  FakeWorker.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native worker broker", () => {
  it("uses the frame owner's same-origin broker without reading parent.document", () => {
    const lease = { post: vi.fn(), release: vi.fn() };
    const acquire = vi.fn(() => lease);
    const owner = { __agentNativeDesignWorkerBrokerV1: { acquire } };
    const frame = { ownerDocument: { defaultView: owner } };
    const descriptor = Object.getOwnPropertyDescriptor(window, "frameElement");
    Object.defineProperty(window, "frameElement", {
      configurable: true,
      value: frame,
    });
    try {
      expect(
        acquireNativeWorkerLease("source", "scene", {
          message: vi.fn(),
          failure: vi.fn(),
        }),
      ).toBe(lease);
      expect(acquire).toHaveBeenCalledOnce();
      expect(FakeWorker.instances).toHaveLength(0);
    } finally {
      if (descriptor) Object.defineProperty(window, "frameElement", descriptor);
      else Reflect.deleteProperty(window, "frameElement");
    }
  });

  it("uses a local worker when frameElement is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "frameElement");
    Object.defineProperty(window, "frameElement", {
      configurable: true,
      value: null,
    });
    try {
      const lease = acquireNativeWorkerLease("source", "scene", {
        message: vi.fn(),
        failure: vi.fn(),
      });
      expect(FakeWorker.instances).toHaveLength(1);
      lease.release();
      expect(FakeWorker.instances[0]?.terminated).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(window, "frameElement", descriptor);
      else Reflect.deleteProperty(window, "frameElement");
    }
  });
  it("routes two iframe scenes through one exact-source worker and releases it after the last scene", async () => {
    installNativeWorkerBroker(window);
    const commitsA: number[] = [];
    const commitsB: number[] = [];
    const a = new NativeWorkerHost(
      "worker-source-v1",
      "scene-a",
      canvas(),
      (message) => commitsA.push(message.generation),
      () => {},
    );
    const b = new NativeWorkerHost(
      "worker-source-v1",
      "scene-b",
      canvas(),
      (message) => commitsB.push(message.generation),
      () => {},
    );
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0]!;
    expect(worker.messages).toMatchObject([
      { type: "init", sceneId: "scene-a" },
      { type: "init", sceneId: "scene-b" },
    ]);
    for (const sceneId of ["scene-a", "scene-b"])
      worker.receive({
        type: "ready",
        sceneId,
        protocol: NATIVE_WORKER_PROTOCOL_VERSION,
      });
    await Promise.all([a.readyPromise, b.readyPromise]);
    const scene = (sceneId: string, generation: number) => ({
      sceneId,
      generation,
      sourceEpoch: generation,
      authoredEpoch: generation,
      viewport: { x: 0, y: 0, width: 1, height: 1 },
      width: 1,
      height: 1,
      pixelRatio: 1,
      colorSpace: "srgb" as const,
      clock: { playing: false, timeSeconds: 0, speed: 1 },
      requiredAssets: [],
      definitions: [],
      instances: [],
      targets: [],
      records: [],
    });
    await Promise.all([
      a.sendScene(scene("scene-a", 1), []),
      b.sendScene(scene("scene-b", 1), []),
    ]);
    worker.receive({
      type: "committed",
      sceneId: "scene-b",
      generation: 1,
      sourceEpoch: 1,
      frame: 1,
      timeSeconds: 0,
      presentedAtMs: 16,
    });
    expect(commitsA).toEqual([]);
    expect(commitsB).toEqual([1]);
    a.dispose();
    expect(worker.terminated).toBe(false);
    worker.receive({
      type: "committed",
      sceneId: "scene-a",
      generation: 1,
      sourceEpoch: 1,
      frame: 1,
      timeSeconds: 0,
      presentedAtMs: 16,
    });
    expect(commitsA).toEqual([]);
    await b.sendScene(scene("scene-b", 2), []);
    worker.receive({
      type: "committed",
      sceneId: "scene-b",
      generation: 2,
      sourceEpoch: 2,
      frame: 2,
      timeSeconds: 0,
      presentedAtMs: 32,
    });
    expect(commitsB).toEqual([1, 2]);
    b.dispose();
    expect(worker.terminated).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("keeps different worker source versions isolated", () => {
    const broker = new NativeWorkerBroker(window);
    const listener = { message: vi.fn(), failure: vi.fn() };
    const old = broker.acquire("source-v1", "scene-old", listener);
    const same = broker.acquire("source-v1", "scene-same", listener);
    const fresh = broker.acquire("source-v2", "scene-fresh", listener);
    expect(FakeWorker.instances).toHaveLength(2);
    old.release();
    expect(FakeWorker.instances[0]?.terminated).toBe(false);
    same.release();
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    expect(FakeWorker.instances[1]?.terminated).toBe(false);
    fresh.release();
    expect(FakeWorker.instances[1]?.terminated).toBe(true);
  });

  it("constructs the physical worker with the installing owner's browser constructors", () => {
    class ParentWorker extends FakeWorker {}
    const owner = {
      Worker: ParentWorker,
      Blob,
      URL,
      setTimeout: window.setTimeout.bind(window),
    } as unknown as Window & typeof globalThis;
    const broker = new NativeWorkerBroker(owner);
    const lease = broker.acquire("source-v1", "scene-a", {
      message: vi.fn(),
      failure: vi.fn(),
    });
    expect(FakeWorker.instances[0]).toBeInstanceOf(ParentWorker);
    lease.release();
  });

  it("releases iframe leases on pagehide without leaving the parent-owned worker alive", () => {
    installNativeWorkerBroker(window);
    new NativeWorkerHost(
      "worker-source-v1",
      "scene-a",
      canvas(),
      () => {},
      () => {},
    );
    new NativeWorkerHost(
      "worker-source-v1",
      "scene-b",
      canvas(),
      () => {},
      () => {},
    );
    expect(FakeWorker.instances).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("fans out a worker crash, then creates a fresh pool for recovery", () => {
    const broker = new NativeWorkerBroker(window);
    const a = { message: vi.fn(), failure: vi.fn() };
    const b = { message: vi.fn(), failure: vi.fn() };
    const oldA = broker.acquire("source-v1", "scene-a", a);
    const oldB = broker.acquire("source-v1", "scene-b", b);
    FakeWorker.instances[0]!.fail();
    expect(a.failure).toHaveBeenCalledWith("worker-failed", "worker crashed");
    expect(b.failure).toHaveBeenCalledWith("worker-failed", "worker crashed");
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    const fresh = broker.acquire("source-v1", "scene-c", {
      message: vi.fn(),
      failure: vi.fn(),
    });
    expect(FakeWorker.instances).toHaveLength(2);
    oldA.release();
    oldB.release();
    expect(FakeWorker.instances[1]?.terminated).toBe(false);
    fresh.release();
  });

  it("replaces a shared lost device while keeping ordinary scene errors isolated", () => {
    const broker = new NativeWorkerBroker(window);
    const a = { message: vi.fn(), failure: vi.fn() };
    const b = { message: vi.fn(), failure: vi.fn() };
    const oldA = broker.acquire("source-v1", "scene-a", a);
    const oldB = broker.acquire("source-v1", "scene-b", b);
    const worker = FakeWorker.instances[0]!;
    worker.receive({
      type: "error",
      sceneId: "scene-a",
      code: "gpu-validation",
      message: "bad scene",
    });
    expect(a.message).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gpu-validation" }),
    );
    expect(b.failure).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(false);
    worker.receive({
      type: "error",
      sceneId: "scene-b",
      code: "gpu-device-lost",
      message: "device lost",
    });
    expect(a.failure).toHaveBeenCalledWith("gpu-device-lost", "device lost");
    expect(b.failure).toHaveBeenCalledWith("gpu-device-lost", "device lost");
    expect(worker.terminated).toBe(true);
    const fresh = broker.acquire("source-v1", "scene-a", {
      message: vi.fn(),
      failure: vi.fn(),
    });
    expect(FakeWorker.instances).toHaveLength(2);
    oldA.release();
    oldB.release();
    expect(FakeWorker.instances[1]?.terminated).toBe(false);
    fresh.release();
  });

  it("fails all active scenes on an unrouteable response but ignores a disposed scene's late reply", () => {
    const broker = new NativeWorkerBroker(window);
    const a = { message: vi.fn(), failure: vi.fn() };
    const b = { message: vi.fn(), failure: vi.fn() };
    const oldA = broker.acquire("source-v1", "scene-a", a);
    const oldB = broker.acquire("source-v1", "scene-b", b);
    const worker = FakeWorker.instances[0]!;
    oldA.release();
    worker.receive({ type: "ready", sceneId: "scene-a" });
    expect(b.failure).not.toHaveBeenCalled();
    worker.receive({ type: "ready" });
    expect(b.failure).toHaveBeenCalledWith(
      "worker-response-unroutable",
      expect.stringContaining("without a scene ID"),
    );
    expect(worker.terminated).toBe(true);
    oldB.release();
  });

  it("does not deliver a retired host's reply to its replacement in the same worker", () => {
    const broker = new NativeWorkerBroker(window);
    const keepAlive = broker.acquire("source-v1", "other-scene", {
      message: vi.fn(),
      failure: vi.fn(),
    });
    const old = broker.acquire("source-v1", "runtime:old-host", {
      message: vi.fn(),
      failure: vi.fn(),
    });
    const worker = FakeWorker.instances[0]!;
    old.release();
    const replacement = { message: vi.fn(), failure: vi.fn() };
    const fresh = broker.acquire(
      "source-v1",
      "runtime:fresh-host",
      replacement,
    );
    worker.receive({ type: "ready", sceneId: "runtime:old-host" });
    expect(replacement.message).not.toHaveBeenCalled();
    worker.receive({ type: "ready", sceneId: "runtime:fresh-host" });
    expect(replacement.message).toHaveBeenCalledOnce();
    fresh.release();
    keepAlive.release();
  });

  it("keeps an active scene healthy after many disposed scenes send late replies", () => {
    const broker = new NativeWorkerBroker(window);
    const active = { message: vi.fn(), failure: vi.fn() };
    const keepAlive = broker.acquire("source-v1", "active-scene", active);
    for (let index = 0; index < 300; index++)
      broker
        .acquire("source-v1", `retired-${index}`, {
          message: vi.fn(),
          failure: vi.fn(),
        })
        .release();
    const worker = FakeWorker.instances[0]!;
    worker.receive({ type: "ready", sceneId: "retired-0" });
    expect(active.failure).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(false);
    worker.receive({ type: "ready", sceneId: "active-scene" });
    expect(active.message).toHaveBeenCalledOnce();
    keepAlive.release();
  });
});
