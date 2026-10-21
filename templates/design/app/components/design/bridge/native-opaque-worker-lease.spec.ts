// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireOpaqueNativeWorkerLease } from "./native-opaque-worker-lease";

const nonce = "opaque-worker-nonce-123456";

beforeEach(() => {
  document.head.innerHTML = `<meta name="an-native-public-worker-nonce" content="${nonce}">`;
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: "https://design.example.test/viewer",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.head.replaceChildren();
});

describe("opaque public worker lease", () => {
  it("queues only init until the parent capability connects, then routes a scene response", async () => {
    const post = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => {});
    const message = vi.fn();
    const failure = vi.fn();
    const lease = acquireOpaqueNativeWorkerLease("child-scene", {
      message,
      failure,
    });
    const init = {
      type: "init" as const,
      sceneId: "child-scene",
      protocol: 1 as const,
      canvas: {} as OffscreenCanvas,
    };
    lease.post(init);
    expect(() =>
      lease.post({ type: "visibility", sceneId: "child-scene", visible: true }),
    ).toThrow();
    window.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const transfers = post.mock.calls as unknown as Array<
      [unknown, string, MessagePort[]]
    >;
    const parentPort = transfers[0]![2][0]!;
    expect(post.mock.calls[0]?.[1]).toBe("https://design.example.test");
    const inbound: unknown[] = [];
    parentPort.onmessage = (event) => inbound.push(event.data);
    parentPort.start();
    parentPort.postMessage({
      type: "native-public-worker-connect",
      nonce,
      sceneId: "child-scene",
    });
    await vi.waitFor(() => expect(inbound).toHaveLength(1));
    expect(inbound[0]).toMatchObject({
      type: "native-public-worker-message",
      message: init,
    });
    parentPort.postMessage({
      type: "native-public-worker-message",
      message: { type: "ready", sceneId: "child-scene", protocol: 1 },
    });
    await vi.waitFor(() => expect(message).toHaveBeenCalledOnce());
    expect(failure).not.toHaveBeenCalled();
    lease.release();
    parentPort.close();
  });

  it("cancels a pending init on dispose without reporting a worker failure", async () => {
    const post = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => {});
    const failure = vi.fn();
    const lease = acquireOpaqueNativeWorkerLease("child-scene", {
      message: vi.fn(),
      failure,
    });
    lease.post({
      type: "init",
      sceneId: "child-scene",
      protocol: 1,
      canvas: {} as OffscreenCanvas,
    });
    lease.post({ type: "dispose", sceneId: "child-scene" });
    window.dispatchEvent(new Event("load"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(post).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it("reports a typed timeout and closes an unconnected channel", async () => {
    vi.useFakeTimers();
    const post = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => {});
    const failure = vi.fn();
    const lease = acquireOpaqueNativeWorkerLease("child-scene", {
      message: vi.fn(),
      failure,
    });
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(8_001);
    expect(post).toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(
      "worker-public-connect-timeout",
      expect.any(String),
    );
    lease.release();
  });
});
