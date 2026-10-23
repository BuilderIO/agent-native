// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nativePreviewSurfaceDocumentKey } from "./native-preview-surface";
import {
  connectNativePublicWorkerPreview,
  prepareNativePublicWorkerPreviewDocument,
} from "./native-public-worker-preview";

const manifest = JSON.stringify({
  schemaVersion: 2,
  definitions: [],
  instances: [],
});
const html = `<script type="application/x-agent-native-effects">${manifest}</script>`;

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: unknown[] = [];
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
}

function scene(sceneId: string, generation: number) {
  return {
    sceneId,
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
  };
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", Object);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "transferControlToOffscreen",
  ).mockImplementation(function (this: HTMLCanvasElement) {
    return { parentCanvas: this } as unknown as OffscreenCanvas;
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:trusted-worker");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, "__agentNativeDesignWorkerBrokerV1");
  FakeWorker.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connect(sceneId: string) {
  const prepared = prepareNativePublicWorkerPreviewDocument(html);
  if (!prepared) throw new Error("test manifest is absent");
  const frame = document.createElement("iframe");
  frame.srcdoc = prepared.html;
  document.body.append(frame);
  const cleanup = connectNativePublicWorkerPreview(
    frame,
    prepared,
    prepared.html,
  );
  frame.dispatchEvent(new Event("load"));
  const channel = new MessageChannel();
  const inbox: MessageEvent[] = [];
  const waiters: Array<(event: MessageEvent) => void> = [];
  let respondToLoad = true;
  const take = () =>
    inbox.length
      ? Promise.resolve(inbox.shift()!)
      : new Promise<MessageEvent>((resolve) => waiters.push(resolve));
  channel.port1.onmessage = (event) => {
    if (event.data?.type === "native-public-worker-ping") {
      if (respondToLoad)
        channel.port1.postMessage({
          type: "native-public-worker-pong",
          nonce: event.data.nonce,
        });
      return;
    }
    const waiter = waiters.shift();
    if (waiter) waiter(event);
    else inbox.push(event);
  };
  channel.port1.start();
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      origin: "null",
      data: {
        type: "native-public-worker-ready",
        nonce: prepared.nonce,
        sceneId,
      },
      ports: [channel.port2],
    }),
  );
  expect((await take()).data).toMatchObject({
    type: "native-public-worker-connect",
    sceneId,
    nonce: prepared.nonce,
  });
  return {
    frame,
    channel,
    cleanup,
    prepared,
    take,
    stopRespondingToLoad: () => {
      respondToLoad = false;
    },
  };
}

describe("parent-owned public native worker", () => {
  it("remounts a changed prepared document and accepts only its current READY nonce", async () => {
    const first = prepareNativePublicWorkerPreviewDocument(html)!;
    const second = prepareNativePublicWorkerPreviewDocument(html)!;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const cleanupRef: { current: (() => void) | null } = { current: null };
    const render = (prepared: typeof first) => {
      act(() => {
        root.render(
          createElement("iframe", {
            key: nativePreviewSurfaceDocumentKey({
              html: prepared.html,
              profile: "interactive",
              publicAsset: null,
              publicWorker: prepared,
            }),
            srcDoc: prepared.html,
            ref: (frame: HTMLIFrameElement | null) => {
              cleanupRef.current?.();
              cleanupRef.current = frame
                ? connectNativePublicWorkerPreview(
                    frame,
                    prepared,
                    prepared.html,
                  )
                : null;
            },
          }),
        );
      });
      return container.querySelector("iframe")!;
    };
    const firstFrame = render(first);
    const secondFrame = render(second);
    expect(secondFrame).not.toBe(firstFrame);
    expect(secondFrame.srcdoc).toBe(second.html);
    const stale = new MessageChannel();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: secondFrame.contentWindow,
        origin: "null",
        data: {
          type: "native-public-worker-ready",
          nonce: first.nonce,
          sceneId: "stale-scene",
        },
        ports: [stale.port2],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(FakeWorker.instances).toHaveLength(0);
    const current = new MessageChannel();
    const connected = new Promise<MessageEvent>((resolve) => {
      current.port1.onmessage = resolve;
      current.port1.start();
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        source: secondFrame.contentWindow,
        origin: "null",
        data: {
          type: "native-public-worker-ready",
          nonce: second.nonce,
          sceneId: "current-scene",
        },
        ports: [current.port2],
      }),
    );
    expect((await connected).data).toMatchObject({
      type: "native-public-worker-connect",
      nonce: second.nonce,
      sceneId: "current-scene",
    });
    act(() => root.unmount());
    cleanupRef.current?.();
    stale.port1.close();
    stale.port2.close();
    current.port1.close();
    current.port2.close();
  });

  it.each([
    ["wrong origin", "https://other.example.test", false, true],
    ["wrong nonce", "null", true, true],
    ["missing port", "null", false, false],
  ])(
    "rejects a capability with %s",
    async (_case, origin, wrongNonce, hasPort) => {
      const prepared = prepareNativePublicWorkerPreviewDocument(html)!;
      const frame = document.createElement("iframe");
      frame.srcdoc = prepared.html;
      document.body.append(frame);
      const cleanup = connectNativePublicWorkerPreview(
        frame,
        prepared,
        prepared.html,
      );
      const channel = new MessageChannel();
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin,
          data: {
            type: "native-public-worker-ready",
            nonce: wrongNonce ? "other-valid-nonce-123456" : prepared.nonce,
            sceneId: "child-scene",
          },
          ports: hasPort ? [channel.port2] : [],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(FakeWorker.instances).toHaveLength(0);
      cleanup();
      channel.port1.close();
      channel.port2.close();
    },
  );

  it("keeps non-native documents unchanged and pins an active manifest", () => {
    expect(
      prepareNativePublicWorkerPreviewDocument(
        '<p>ordinary</p><script>const text = "application/x-agent-native-effects";</script>',
      ),
    ).toBeNull();
    expect(() =>
      prepareNativePublicWorkerPreviewDocument(`<template>${html}</template>`),
    ).toThrow();
    const prepared = prepareNativePublicWorkerPreviewDocument(html);
    expect(prepared?.html).toContain(`name="an-native-public-worker-nonce"`);
    expect(prepared?.manifest).toMatchObject({
      schemaVersion: 2,
      definitions: [],
      instances: [],
    });
  });

  it("shares one trusted parent worker, translates both scene IDs, and retires one scene without ending its sibling", async () => {
    const first = await connect("child-one");
    const second = await connect("child-two");
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0]!;
    first.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "init",
        protocol: 1,
        sceneId: "child-one",
        canvas: { id: "one" },
      },
    });
    second.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "init",
        protocol: 1,
        sceneId: "child-two",
        canvas: { id: "two" },
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
    const ids = worker.messages.map(
      (message) => (message as { sceneId: string }).sceneId,
    );
    expect(new Set(ids).size).toBe(2);
    for (const id of ids)
      worker.receive({ type: "ready", sceneId: id, protocol: 1 });
    const firstReady = (await first.take()).data;
    const secondReady = (await second.take()).data;
    expect(firstReady).toMatchObject({
      type: "native-public-worker-message",
      message: { type: "ready", sceneId: "child-one" },
    });
    expect(secondReady).toMatchObject({
      type: "native-public-worker-message",
      message: { type: "ready", sceneId: "child-two" },
    });
    for (const message of worker.messages) {
      const canvas = (message as { canvas: { parentCanvas: HTMLElement } })
        .canvas.parentCanvas;
      expect(canvas.hasAttribute("data-an-native-public-canvas")).toBe(true);
    }
    expect(
      first.frame.nextElementSibling?.hasAttribute(
        "data-an-native-public-presentation",
      ),
    ).toBe(true);
    expect(
      second.frame.nextElementSibling?.hasAttribute(
        "data-an-native-public-presentation",
      ),
    ).toBe(true);
    first.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: { type: "scene", scene: scene("child-one", 1) },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(3));
    const firstId = (worker.messages[2] as { scene: { sceneId: string } }).scene
      .sceneId;
    const secondId = ids.find((id) => id !== firstId)!;
    expect(worker.messages[2]).toMatchObject({
      type: "scene",
      scene: { sceneId: firstId },
    });
    first.cleanup();
    expect(worker.messages).toContainEqual({
      type: "dispose",
      sceneId: firstId,
    });
    expect(worker.terminated).toBe(false);
    second.cleanup();
    expect(worker.messages).toContainEqual({
      type: "dispose",
      sceneId: secondId,
    });
    expect(worker.terminated).toBe(true);
    first.channel.port1.close();
    second.channel.port1.close();
  });

  it("forwards a bounded linear-data bitmap input with its encoding intact", async () => {
    vi.stubGlobal("ImageBitmap", Object);
    const child = await connect("child-input");
    const worker = FakeWorker.instances[0]!;
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "init",
        protocol: 1,
        sceneId: "child-input",
        canvas: {},
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "asset",
        kind: "bitmap",
        sceneId: "child-input",
        generation: 1,
        revision: 1,
        assetId: "input:noise",
        bitmap: { width: 2, height: 2 },
        sampleEncoding: "linear-data",
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
    expect(worker.messages[1]).toMatchObject({
      type: "asset",
      assetId: "input:noise",
      sampleEncoding: "linear-data",
    });
    child.cleanup();
    child.channel.port1.close();
  });

  it("reveals the parent canvas only for a matching committed scene and removes it on dispose", async () => {
    const child = await connect("child-present");
    child.frame.style.transform = "scale(1.5)";
    child.frame.style.transformOrigin = "top left";
    child.frame.style.borderRadius = "8px";
    child.frame.style.opacity = "0.7";
    child.frame.style.zIndex = "3";
    Object.defineProperties(child.frame, {
      offsetLeft: { configurable: true, value: 11 },
      offsetTop: { configurable: true, value: 13 },
      offsetWidth: { configurable: true, value: 300 },
      offsetHeight: { configurable: true, value: 200 },
    });
    const worker = FakeWorker.instances[0]!;
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "init",
        protocol: 1,
        sceneId: "child-present",
        canvas: { id: "unused-child-canvas" },
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    const internalId = (worker.messages[0] as { sceneId: string }).sceneId;
    const box = child.frame.nextElementSibling as HTMLElement;
    const canvas = box.firstElementChild as HTMLCanvasElement;
    expect(box.dataset).toHaveProperty("anNativePublicPresentation");
    expect(box.style.visibility).toBe("hidden");
    expect(box.style.overflow).toBe("hidden");
    expect(box.style.left).toBe("11px");
    expect(box.style.top).toBe("13px");
    expect(box.style.width).toBe("300px");
    expect(box.style.height).toBe("200px");
    expect(box.style.transform).toBe("scale(1.5)");
    expect(box.style.transformOrigin).toBe("top left");
    expect(box.style.borderRadius).toBe("8px");
    expect(box.style.opacity).toBe("0.7");
    expect(box.style.zIndex).toBe("3");
    expect(canvas.style.pointerEvents).toBe("none");
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "scene",
        scene: {
          ...scene("child-present", 1),
          sourceEpoch: 7,
          viewport: { x: 12, y: 19, width: 240, height: 160 },
          width: 480,
          height: 320,
          pixelRatio: 2,
        },
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
    worker.receive({
      type: "committed",
      sceneId: internalId,
      generation: 1,
      sourceEpoch: 6,
      frame: 1,
      timeSeconds: 0,
      presentedAtMs: 1,
    });
    expect(box.style.visibility).toBe("hidden");
    worker.receive({
      type: "committed",
      sceneId: internalId,
      generation: 1,
      sourceEpoch: 7,
      frame: 1,
      timeSeconds: 0,
      presentedAtMs: 2,
    });
    expect(box.style.visibility).toBe("visible");
    expect(canvas.style.left).toBe("12px");
    expect(canvas.style.top).toBe("19px");
    expect(canvas.style.width).toBe("240px");
    expect(canvas.style.height).toBe("160px");
    const styleReads = vi.spyOn(window, "getComputedStyle");
    worker.receive({
      type: "committed",
      sceneId: internalId,
      generation: 1,
      sourceEpoch: 7,
      frame: 2,
      timeSeconds: 0.016,
      presentedAtMs: 18,
    });
    expect(styleReads).not.toHaveBeenCalled();
    styleReads.mockRestore();
    worker.receive({
      type: "error",
      sceneId: internalId,
      generation: 2,
      code: "worker-scene-invalid",
      message: "The later scene failed.",
    });
    expect(box.style.visibility).toBe("visible");
    expect(canvas.style.left).toBe("12px");
    child.cleanup();
    expect(box.isConnected).toBe(false);
    child.channel.port1.close();
  });

  it("forwards bounded camera updates against the committed public scene and presents their viewport", async () => {
    const child = await connect("child-camera");
    const worker = FakeWorker.instances[0]!;
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "init",
        protocol: 1,
        sceneId: "child-camera",
        canvas: {},
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    const internalId = (worker.messages[0] as { sceneId: string }).sceneId;
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: { type: "scene", scene: scene("child-camera", 1) },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
    worker.receive({
      type: "committed",
      sceneId: internalId,
      generation: 1,
      sourceEpoch: 1,
      frame: 1,
      timeSeconds: 0,
      presentedAtMs: 1,
    });
    const camera = {
      type: "camera",
      sceneId: "child-camera",
      generation: 2,
      baseGeneration: 1,
      sourceEpoch: 1,
      authoredEpoch: 1,
      viewport: { x: -8, y: 12, width: 2, height: 1 },
      width: 2,
      height: 1,
      pixelRatio: 1,
      clock: {
        playing: true,
        timeSeconds: 1,
        speed: 1,
        sampledAtEpochMs: performance.timeOrigin + performance.now(),
      },
    };
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: camera,
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(3));
    expect(worker.messages[2]).toEqual({ ...camera, sceneId: internalId });
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        ...camera,
        generation: 3,
        viewport: { ...camera.viewport, x: -12 },
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(4));
    expect(worker.messages[3]).toMatchObject({
      type: "camera",
      sceneId: internalId,
      generation: 3,
      baseGeneration: 1,
    });
    worker.receive({
      type: "committed",
      sceneId: internalId,
      generation: 3,
      sourceEpoch: 1,
      frame: 1,
      timeSeconds: 1,
      presentedAtMs: 2,
    });
    const canvas = child.frame.nextElementSibling
      ?.firstElementChild as HTMLCanvasElement;
    expect(canvas.style.left).toBe("-12px");
    expect(canvas.style.top).toBe("12px");
    expect(canvas.style.width).toBe("2px");
    child.cleanup();
    child.channel.port1.close();
  });

  it.each([
    ["stale base", { baseGeneration: 0 }],
    ["changed source", { sourceEpoch: 2 }],
    ["invalid geometry", { width: 3 }],
    [
      "invalid clock sample",
      {
        clock: {
          playing: true,
          timeSeconds: 0,
          speed: 1,
          sampledAtEpochMs: Infinity,
        },
      },
    ],
    ["extra scene content", { definitions: [] }],
  ])("denies a camera packet with %s", async (_case, overrides) => {
    const child = await connect("child-denied");
    const worker = FakeWorker.instances[0]!;
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "init",
        protocol: 1,
        sceneId: "child-denied",
        canvas: {},
      },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    const internalId = (worker.messages[0] as { sceneId: string }).sceneId;
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: { type: "scene", scene: scene("child-denied", 1) },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
    worker.receive({
      type: "committed",
      sceneId: internalId,
      generation: 1,
      sourceEpoch: 1,
      frame: 1,
      timeSeconds: 0,
      presentedAtMs: 1,
    });
    await child.take();
    child.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "camera",
        sceneId: "child-denied",
        generation: 2,
        baseGeneration: 1,
        sourceEpoch: 1,
        authoredEpoch: 1,
        viewport: { x: 0, y: 0, width: 1, height: 1 },
        width: 1,
        height: 1,
        pixelRatio: 1,
        clock: { playing: false, timeSeconds: 0, speed: 1 },
        ...overrides,
      },
    });
    expect((await child.take()).data).toMatchObject({
      type: "native-public-worker-failure",
    });
    expect(worker.messages).toHaveLength(3);
    expect(worker.messages[2]).toEqual({
      type: "dispose",
      sceneId: internalId,
    });
    child.cleanup();
    child.channel.port1.close();
  });

  it("rejects a scene outside its pinned manifest and closes on later navigation", async () => {
    const { frame, channel, cleanup, stopRespondingToLoad } =
      await connect("child-only");
    const worker = FakeWorker.instances[0]!;
    channel.port1.postMessage({
      type: "native-public-worker-message",
      message: { type: "init", protocol: 1, sceneId: "child-only", canvas: {} },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    stopRespondingToLoad();
    frame.dispatchEvent(new Event("load"));
    await vi.waitFor(() =>
      expect(worker.messages[1]).toMatchObject({ type: "dispose" }),
    );
    cleanup();
    channel.port1.close();

    const next = await connect("child-next");
    const nextWorker = FakeWorker.instances[FakeWorker.instances.length - 1]!;
    next.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: { type: "init", protocol: 1, sceneId: "child-next", canvas: {} },
    });
    await vi.waitFor(() => expect(nextWorker.messages).toHaveLength(1));
    next.channel.port1.postMessage({
      type: "native-public-worker-message",
      message: {
        type: "scene",
        scene: { ...scene("child-next", 1), definitions: [{ id: "forged" }] },
      },
    });
    expect((await next.take()).data).toMatchObject({
      type: "native-public-worker-failure",
      code: "worker-public-scene-denied",
    });
    expect(nextWorker.messages).toContainEqual({
      type: "dispose",
      sceneId: (nextWorker.messages[0] as { sceneId: string }).sceneId,
    });
    next.cleanup();
    next.channel.port1.close();
  });

  it.each([
    [
      "unbounded unknown scene field",
      (id: string) => ({
        type: "scene",
        scene: { ...scene(id, 1), extra: new Array(50_000).fill(1) },
      }),
    ],
    [
      "cyclic unknown message field",
      (id: string) => {
        const extra: unknown[] = [];
        extra.push(extra);
        return { type: "scene", scene: scene(id, 1), extra };
      },
    ],
    [
      "cyclic nested records",
      (id: string) => {
        const cyclic: unknown[] = [];
        cyclic.push(cyclic);
        return { type: "scene", scene: { ...scene(id, 1), records: cyclic } };
      },
    ],
    [
      "oversized named input asset binding",
      (id: string) => ({
        type: "scene",
        scene: {
          ...scene(id, 1),
          targets: [{ inputAssetIds: { noise: "x".repeat(4097) } }],
        },
      }),
    ],
    [
      "undersized float asset",
      (id: string) => ({
        type: "asset",
        sceneId: id,
        generation: 1,
        revision: 0,
        assetId: "undercharged",
        kind: "rgba16float",
        width: 4,
        height: 4,
        data: new ArrayBuffer(1),
      }),
    ],
  ])(
    "rejects %s before forwarding to the shared worker",
    async (_case, create) => {
      const child = await connect("child-invalid");
      const worker = FakeWorker.instances[0]!;
      child.channel.port1.postMessage({
        type: "native-public-worker-message",
        message: {
          type: "init",
          protocol: 1,
          sceneId: "child-invalid",
          canvas: {},
        },
      });
      await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
      child.channel.port1.postMessage({
        type: "native-public-worker-message",
        message: create("child-invalid"),
      });
      expect((await child.take()).data).toMatchObject({
        type: "native-public-worker-failure",
        code: expect.stringMatching(/^worker-public-/),
      });
      expect(worker.messages).toHaveLength(2);
      expect(worker.messages[1]).toMatchObject({ type: "dispose" });
      child.cleanup();
      child.channel.port1.close();
    },
  );
});
