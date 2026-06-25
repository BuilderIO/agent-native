import { describe, expect, it, vi } from "vitest";

import { createEmbeddedAppBridge, sendEmbeddedAppMessage } from "./bridge.js";

function fakeWindow(
  referrer = "http://127.0.0.1:8080/design",
  href = "http://127.0.0.1:8080/assets/library",
): Window {
  return {
    document: { referrer },
    location: { href },
    parent: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window;
}

describe("Embedded app bridge", () => {
  it("fails closed instead of downgrading target origin after postMessage errors", () => {
    // An opaque parent rejects a specific target origin. We do NOT silently
    // retry with "*" — that would broadcast the payload to any origin. Callers
    // opt into wildcard explicitly (see below) or via the MCP chat bridge param.
    const target = {
      postMessage: vi.fn().mockImplementation(() => {
        throw new DOMException(
          "Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('http://127.0.0.1:8080') does not match the recipient window's origin ('null').",
        );
      }),
    } as unknown as Window;

    expect(() =>
      sendEmbeddedAppMessage(
        "chooseAsset",
        { assetId: "asset-1" },
        {
          currentWindow: fakeWindow(),
          targetWindow: target,
        },
      ),
    ).toThrow(DOMException);

    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(target.postMessage).mock.calls[0][1]).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("allows callers to explicitly target opaque parents with wildcard origin", () => {
    const target = {
      postMessage: vi.fn(),
    } as unknown as Window;

    expect(
      sendEmbeddedAppMessage(
        "chooseAsset",
        { assetId: "asset-1" },
        {
          currentWindow: fakeWindow(),
          parentOrigin: "*",
          targetWindow: target,
        },
      ),
    ).toBe(true);

    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(target.postMessage).mock.calls[0][1]).toBe("*");
  });

  it("uses wildcard target origin for MCP chat bridge child frames", () => {
    const target = {
      postMessage: vi.fn(),
    } as unknown as Window;

    const bridge = createEmbeddedAppBridge({
      currentWindow: fakeWindow(
        "http://127.0.0.1:8080/design",
        "http://127.0.0.1:8080/assets/library?__an_mcp_chat_bridge=1",
      ),
      targetWindow: target,
    });

    expect(bridge.parentOrigin).toBe("*");
    expect(bridge.postMessage("chooseAsset", { assetId: "asset-1" })).toBe(
      true,
    );
    expect(target.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ name: "chooseAsset" }),
      "*",
    );
  });
});
