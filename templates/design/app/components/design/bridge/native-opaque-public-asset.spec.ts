// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeOpaquePublicAssets,
  isOpaquePublicAssetPreview,
  NativeOpaquePublicAssetError,
  opaquePublicAssetUrl,
  resolveOpaquePublicAsset,
} from "./native-opaque-public-asset";
import { nativeDocumentOrigin } from "./native-source-provider";

const pageWindow = window;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("opaque public source assets", () => {
  it("keeps the ordinary source path unchanged", () => {
    vi.stubGlobal("location", { origin: "https://design.example.test" });
    expect(isOpaquePublicAssetPreview()).toBe(false);
    expect(resolveOpaquePublicAsset("/images/paint.png")).toBe(
      "/images/paint.png",
    );
  });

  it("accepts only the verified parent origin for public network images", () => {
    vi.stubGlobal("document", {
      baseURI: "https://design.example.test/editor",
      referrer: "https://design.example.test/viewer",
    });
    expect(opaquePublicAssetUrl("/images/paint.png")).toBe(
      "https://design.example.test/images/paint.png",
    );
    expect(() =>
      opaquePublicAssetUrl("https://other.example.test/private.png"),
    ).toThrowError(NativeOpaquePublicAssetError);
  });

  it("uses an accessible parent origin before the opaque referrer fallback", () => {
    vi.stubGlobal("location", { origin: "null" });
    vi.stubGlobal("window", {
      frameElement: {
        ownerDocument: {
          defaultView: { location: { origin: "https://design.example.test" } },
        },
      },
    });
    vi.stubGlobal("document", { referrer: "" });
    expect(nativeDocumentOrigin()).toBe("https://design.example.test");
    vi.stubGlobal("window", {
      frameElement: null,
      parent: {
        location: {
          get origin() {
            throw new DOMException("opaque", "SecurityError");
          },
        },
      },
    });
    vi.stubGlobal("document", {
      referrer: "https://design.example.test/editor",
    });
    expect(nativeDocumentOrigin()).toBe("https://design.example.test");
  });

  it("fails a disconnected opaque channel within the bounded handshake deadline", async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    vi.stubGlobal("location", { origin: "null" });
    vi.stubGlobal("window", {
      frameElement: null,
      parent: { postMessage },
    });
    vi.stubGlobal("document", {
      baseURI: "https://design.example.test/editor",
      referrer: "https://design.example.test/viewer",
      querySelector: () => ({
        content: "01234567-89ab-4cde-8fab-0123456789ab",
      }),
    });
    const result = resolveOpaquePublicAsset(
      "https://design.example.test/images/paint.png",
    );
    expect(result).toBeInstanceOf(Promise);
    await vi.advanceTimersByTimeAsync(8_001);
    await expect(result).rejects.toMatchObject({
      code: "source-public-asset-unavailable",
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "native-public-asset-ready" }),
      "https://design.example.test",
      expect.any(Array),
    );
  });

  it("cancels an in-flight handshake and its retries when the page closes", async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    vi.stubGlobal("location", { origin: "null" });
    vi.stubGlobal("window", {
      frameElement: null,
      parent: { postMessage },
    });
    vi.stubGlobal("document", {
      baseURI: "https://design.example.test/editor",
      referrer: "https://design.example.test/viewer",
      querySelector: () => ({
        content: "01234567-89ab-4cde-8fab-0123456789ab",
      }),
    });
    const result = resolveOpaquePublicAsset(
      "https://design.example.test/images/paint.png",
    );
    expect(postMessage).toHaveBeenCalledOnce();
    closeOpaquePublicAssets();
    await expect(result).rejects.toMatchObject({
      code: "source-public-asset-disposed",
    });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(postMessage).toHaveBeenCalledOnce();
    expect(() =>
      resolveOpaquePublicAsset("https://design.example.test/images/paint.png"),
    ).toThrowError(NativeOpaquePublicAssetError);
  });

  it("keeps its authorized channel through BFCache and closes it on final pagehide", async () => {
    vi.resetModules();
    const {
      resolveOpaquePublicAsset: resolveImage,
      NativeOpaquePublicAssetError: OpaqueAssetError,
    } = await import("./native-opaque-public-asset");
    const nonce = "01234567-89ab-4cde-8fab-0123456789ab";
    const urls = [
      "https://design.example.test/images/one.png",
      "https://design.example.test/images/two.png",
    ];
    let hostPort: MessagePort | undefined;
    const postMessage = vi.fn(
      (_message: unknown, _origin: string, ports: MessagePort[]) => {
        hostPort = ports[0];
      },
    );
    vi.stubGlobal("location", { origin: "null" });
    vi.stubGlobal("window", {
      frameElement: null,
      parent: { postMessage },
    });
    vi.stubGlobal("document", {
      baseURI: "https://design.example.test/editor",
      referrer: "https://design.example.test/viewer",
      querySelector: () => ({ content: nonce }),
    });
    const firstImage = resolveImage(urls[0]!);
    expect(hostPort).toBeDefined();
    let requestCount = 0;
    hostPort!.onmessage = (event) => {
      if (event.data?.type !== "native-public-asset-request") return;
      requestCount += 1;
      hostPort!.postMessage({
        type: "native-public-asset-result",
        requestId: event.data.requestId,
        error: {
          code: "source-public-asset-unavailable",
          message: "The test parent did not load the image.",
        },
      });
    };
    hostPort!.start();
    hostPort!.postMessage({
      type: "native-public-asset-connect",
      nonce,
      urls,
    });
    await expect(firstImage).rejects.toMatchObject({
      code: "source-public-asset-unavailable",
    });

    const pageTransition = (
      type: "pagehide" | "pageshow",
      persisted: boolean,
    ) => {
      const event = new Event(type);
      Object.defineProperty(event, "persisted", { value: persisted });
      pageWindow.dispatchEvent(event);
    };
    pageTransition("pagehide", true);
    pageTransition("pageshow", true);
    await expect(resolveImage(urls[1]!)).rejects.toMatchObject({
      code: "source-public-asset-unavailable",
    });
    expect(postMessage).toHaveBeenCalledOnce();
    expect(requestCount).toBe(2);

    pageTransition("pagehide", false);
    expect(() => resolveImage(urls[1]!)).toThrowError(OpaqueAssetError);
    hostPort?.close();
  });
});
