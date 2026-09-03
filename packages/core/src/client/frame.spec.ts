// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

function parentWindow() {
  return {
    postMessage: vi.fn(),
  } as unknown as Window;
}

function setParent(parent: Window): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
}

function dispatchFrameOrigin(origin: string, parent: Window, payload = origin) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "agentNative.frameOrigin", origin: payload },
      origin,
      source: parent,
    }),
  );
}

async function loadFrame() {
  vi.resetModules();
  return import("./frame.js");
}

describe("frame bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    setParent(window);
  });

  it("handshakes with URL-origin parents", async () => {
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("https://host.example", parent);

    expect(frame.getFrameOrigin()).toBe("https://host.example");
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "agentNative.embeddedAppReady" },
      "https://host.example",
    );
  });

  it("handshakes with opaque sandbox parents", async () => {
    const parent = parentWindow();
    setParent(parent);
    const frame = await loadFrame();

    dispatchFrameOrigin("null", parent, "https://chatgpt-sandbox.example");

    expect(frame.getFrameOrigin()).toBe("null");
    expect(frame.getFramePostMessageTargetOrigin()).toBe("*");
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "agentNative.embeddedAppReady" },
      "*",
    );
    expect(
      frame.isTrustedFrameMessage(
        new MessageEvent("message", {
          data: { type: "agentNative.ping" },
          origin: "null",
          source: parent,
        }),
      ),
    ).toBe(true);

    frame.sendToFrame("agentNative.test", { ok: true });

    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "agentNative.test", data: { ok: true } },
      "*",
    );
  });
});
