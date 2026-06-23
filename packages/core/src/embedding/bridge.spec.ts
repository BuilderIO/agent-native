import { describe, expect, it, vi } from "vitest";
import { sendEmbeddedAppMessage } from "./bridge.js";

function fakeWindow(referrer = "http://127.0.0.1:8080/design"): Window {
  return {
    document: { referrer },
    parent: null,
  } as unknown as Window;
}

describe("Embedded app bridge", () => {
  it("retries postMessage with wildcard target origin for opaque srcdoc parents", () => {
    const target = {
      postMessage: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new DOMException(
            "Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('http://127.0.0.1:8080') does not match the recipient window's origin ('null').",
          );
        })
        .mockImplementationOnce(() => undefined),
    } as unknown as Window;

    expect(
      sendEmbeddedAppMessage(
        "chooseAsset",
        { assetId: "asset-1" },
        {
          currentWindow: fakeWindow(),
          targetWindow: target,
        },
      ),
    ).toBe(true);

    expect(target.postMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(target.postMessage).mock.calls[0][1]).toBe(
      "http://127.0.0.1:8080",
    );
    expect(vi.mocked(target.postMessage).mock.calls[1][1]).toBe("*");
  });

  it("retries when the browser throws a DOMException-like object", () => {
    const target = {
      postMessage: vi
        .fn()
        .mockImplementationOnce(() => {
          throw {
            message:
              "Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('http://127.0.0.1:8080') does not match the recipient window's origin ('null').",
          };
        })
        .mockImplementationOnce(() => undefined),
    } as unknown as Window;

    expect(
      sendEmbeddedAppMessage(
        "chooseAsset",
        { assetId: "asset-1" },
        {
          currentWindow: fakeWindow(),
          targetWindow: target,
        },
      ),
    ).toBe(true);

    expect(target.postMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(target.postMessage).mock.calls[1][1]).toBe("*");
  });
});
