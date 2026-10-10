// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { awaitNativeReady } from "./native-scene-export-client";

const instance = [{ instanceId: "effect-1", nodeId: "image-1" }];

function status(
  requestId: string,
  state: "ready" | "error" | "unavailable",
  code?: string,
) {
  return {
    type: "native-shader-status",
    schemaVersion: 1,
    runtimeEpoch: "epoch-1",
    instanceId: "effect-1",
    nodeId: "image-1",
    requestId,
    status: state,
    backend: state === "unavailable" ? "unavailable" : "webgpu",
    ...(code ? { code, message: code } : {}),
    frames: state === "ready" ? 1 : 0,
    sourceCaptures: 0,
    estimatedResourceBytes: 0,
  };
}

function target(
  reply?: (requestId: string) => ReturnType<typeof status>,
  delayMs = 0,
): Window {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const windowTarget = frame.contentWindow!;
  vi.spyOn(windowTarget, "postMessage").mockImplementation((message) => {
    const requestId = (message as { requestId: string }).requestId;
    if (!reply) return;
    const dispatch = () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: windowTarget,
          data: reply(requestId),
        }),
      );
    if (delayMs) setTimeout(dispatch, delayMs);
    else queueMicrotask(dispatch);
  });
  return windowTarget;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("native export status readiness", () => {
  it("preserves an exact reported renderer failure", async () => {
    await expect(
      awaitNativeReady(
        target((requestId) =>
          status(requestId, "error", "input-asset-cross-origin"),
        ),
        instance,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "native-not-ready",
      message: expect.stringContaining("error/input-asset-cross-origin"),
    });
  });

  it("retains the last typed unavailable cause when initialization never completes", async () => {
    vi.useFakeTimers();
    const pending = awaitNativeReady(
      target(
        (requestId) => status(requestId, "unavailable", "instance-not-mounted"),
        500,
      ),
      instance,
      new AbortController().signal,
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: "native-not-ready",
      message: expect.stringContaining(
        "unavailable/instance-not-mounted after",
      ),
    });
    await vi.advanceTimersByTimeAsync(16_000);
    await rejection;
  });

  it("distinguishes a frame that never replies from renderer failure", async () => {
    vi.useFakeTimers();
    const pending = awaitNativeReady(
      target(),
      instance,
      new AbortController().signal,
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: "native-not-ready",
      message: expect.stringContaining("no readable status"),
    });
    await vi.advanceTimersByTimeAsync(16_000);
    await rejection;
  });
});
