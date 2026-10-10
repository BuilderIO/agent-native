// @vitest-environment happy-dom

import type { NativeInstancePreviewSet } from "@shared/native-instance-preview-contract";
import { expect, it, vi } from "vitest";

import {
  readNativeInstancePreviewResult,
  sendNativeInstancePreviewMessage,
} from "./native-instance-preview-client";

const message: NativeInstancePreviewSet = {
  type: "native-effect-set-instance",
  schemaVersion: 1,
  requestId: "scrub_1",
  sequence: 1,
  runtimeEpoch: "epoch_1",
  instanceId: "instance-1",
  nodeId: "node-1",
  baseExecutionHash: "a".repeat(64),
  baseInstanceSignature: "b".repeat(64),
  transform: { scale: [1.25, 1] },
  opacity: 0.75,
};
const ready = {
  type: "native-effect-instance-result",
  schemaVersion: 1,
  requestId: message.requestId,
  sequence: message.sequence,
  runtimeEpoch: message.runtimeEpoch,
  instanceId: message.instanceId,
  nodeId: message.nodeId,
  status: "ready",
  displayed: "preview",
} as const;

function emit(source: Window, origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { source, origin, data }));
}

it("accepts only the selected frame, origin, request sequence and instance", async () => {
  const target = { postMessage: vi.fn() } as unknown as Window;
  const other = { postMessage: vi.fn() } as unknown as Window;
  const promise = sendNativeInstancePreviewMessage({
    targetWindow: target,
    message,
  });
  expect(target.postMessage).toHaveBeenCalledWith(
    message,
    window.location.origin,
  );
  emit(other, window.location.origin, ready);
  emit(target, "https://wrong.example", ready);
  emit(target, window.location.origin, { ...ready, requestId: "old" });
  emit(target, window.location.origin, {
    ...ready,
    status: "pending",
    displayed: "preview",
  });
  emit(target, window.location.origin, ready);
  await expect(promise).resolves.toEqual(ready);
});

it("rejects malformed matching replies and aborts without a false ready state", async () => {
  expect(
    readNativeInstancePreviewResult({ ...ready, sequence: -1 }),
  ).toBeNull();
  expect(
    readNativeInstancePreviewResult({ ...ready, displayed: "invented" }),
  ).toBeNull();
  const target = { postMessage: vi.fn() } as unknown as Window;
  const unreadable = sendNativeInstancePreviewMessage({
    targetWindow: target,
    message,
  });
  emit(target, window.location.origin, { ...ready, sequence: 2 });
  await expect(unreadable).rejects.toMatchObject({ code: "reply-unreadable" });
  const controller = new AbortController();
  const canceled = sendNativeInstancePreviewMessage({
    targetWindow: target,
    message,
    signal: controller.signal,
  });
  controller.abort();
  emit(target, window.location.origin, ready);
  await expect(canceled).rejects.toMatchObject({ code: "request-aborted" });
});
