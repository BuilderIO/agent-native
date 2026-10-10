import type { NativeInstancePreviewRequest } from "@shared/native-instance-preview-contract";
import { describe, expect, it, vi } from "vitest";

import { NativeInstanceScrubSession } from "./native-instance-scrub-session";

const identity = {
  runtimeEpoch: "epoch_1",
  instanceId: "instance-1",
  nodeId: "node-1",
  baseExecutionHash: "a".repeat(64),
  baseInstanceSignature: "b".repeat(64),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("native instance scrub session", () => {
  it("skips stale previews while identity is pending and sends the last clear", async () => {
    const pending = deferred<typeof identity>();
    const requests: NativeInstancePreviewRequest[] = [];
    const session = new NativeInstanceScrubSession(
      pending.promise,
      async (request) => {
        requests.push(request);
        return {
          type: "native-effect-instance-result",
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: request.sequence,
          runtimeEpoch: request.runtimeEpoch,
          instanceId: request.instanceId,
          nodeId: request.nodeId,
          status: "ready",
          displayed: "published",
        };
      },
      vi.fn(),
    );
    session.preview({ transform: { scale: [1.2, 1] }, opacity: 1 });
    session.preview({ transform: { scale: [1.4, 1] }, opacity: 1 });
    session.clear();
    pending.resolve(identity);
    await pending.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    expect(requests[0].type).toBe("native-effect-clear-instance");
  });

  it("aborts a prior in-flight preview and fences its late failure after a newer clear", async () => {
    const requests: NativeInstancePreviewRequest[] = [];
    const signals: AbortSignal[] = [];
    const onFailure = vi.fn();
    const session = new NativeInstanceScrubSession(
      Promise.resolve(identity),
      async (request, signal) => {
        requests.push(request);
        signals.push(signal);
        if (request.type === "native-effect-set-instance")
          return await new Promise(() => {});
        return {
          type: "native-effect-instance-result",
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: request.sequence,
          runtimeEpoch: request.runtimeEpoch,
          instanceId: request.instanceId,
          nodeId: request.nodeId,
          status: "ready",
          displayed: "published",
        };
      },
      onFailure,
    );
    session.preview({ transform: null, opacity: 0.5 });
    await Promise.resolve();
    session.clear();
    await Promise.resolve();
    expect(requests.map((request) => request.type)).toEqual([
      "native-effect-set-instance",
      "native-effect-clear-instance",
    ]);
    expect(signals[0].aborted).toBe(true);
    expect(requests[1].sequence).toBeGreaterThan(requests[0].sequence);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
