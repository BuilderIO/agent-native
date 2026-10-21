// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NativePublicAssetPreviewError,
  connectNativePublicAssetPreview,
  prepareNativePublicAssetPreviewDocument,
} from "./native-public-asset-preview";

const manifest =
  '<script type="application/x-agent-native-effects">{}</script>';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("opaque public asset preparation", () => {
  it("indexes exact same-origin image, srcset, and CSS URLs without exposing other origins", () => {
    const html = `<!doctype html><html><head><style>
      .card { background-image: url('/textures/fold.png'); }
    </style></head><body>
      <picture><source srcset="/images/one.png 1x, /images/two.png 2x"></picture>
      <img src="/images/one.png" srcset="data:image/png;base64,a,b 1x, /images/three.png 2x">
      <div style="border-image-source:url('/images/border.webp')"></div>
      <img src="https://elsewhere.example/private.png">
      ${manifest}
    </body></html>`;
    const prepared = prepareNativePublicAssetPreviewDocument(
      html,
      "https://design.example.test/editor",
    );

    expect(prepared.urls).toEqual([
      "https://design.example.test/textures/fold.png",
      "https://design.example.test/images/one.png",
      "https://design.example.test/images/two.png",
      "https://design.example.test/images/three.png",
      "https://design.example.test/images/border.webp",
    ]);
    expect(prepared.nonce).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    expect(prepared.html).toContain(
      `<meta name="an-native-public-asset-nonce" content="${prepared.nonce}">`,
    );
    expect(
      prepared.html.replace(
        `<meta name="an-native-public-asset-nonce" content="${prepared.nonce}">`,
        "",
      ),
    ).toBe(html);
  });

  it("does not add a channel when no eligible public asset exists", () => {
    const html =
      '<img src="https://elsewhere.example/image.png"><img src="data:image/png;base64,AA==">';
    expect(
      prepareNativePublicAssetPreviewDocument(
        html,
        "https://design.example.test/editor",
      ),
    ).toEqual({
      html,
      urls: [],
      origin: "https://design.example.test",
      nonce: null,
    });
  });

  it("rejects malformed image URLs instead of treating them as absent", () => {
    expect(() =>
      prepareNativePublicAssetPreviewDocument(
        `${manifest}<img src="http://[invalid">`,
        "https://design.example.test/editor",
      ),
    ).toThrowError(NativePublicAssetPreviewError);
  });

  it("leaves ordinary documents unchanged regardless of image count or base", () => {
    const html =
      '<base href="https://elsewhere.example/">' +
      Array.from(
        { length: 129 },
        (_, index) => `<img src="${index}.png">`,
      ).join("") +
      '<script>const example = "application/x-agent-native-effects";</script>' +
      `<template>${manifest}</template>`;
    expect(
      prepareNativePublicAssetPreviewDocument(
        html,
        "https://design.example.test/editor",
      ),
    ).toEqual({
      html,
      urls: [],
      origin: "https://design.example.test",
      nonce: null,
    });
  });

  it("indexes relative images against the document base and rejects a foreign base", () => {
    const html = `<html><head><base href="/assets/"></head><body><img src="paint.png">${manifest}</body></html>`;
    expect(
      prepareNativePublicAssetPreviewDocument(
        html,
        "https://design.example.test/editor/board",
      ).urls,
    ).toEqual(["https://design.example.test/assets/paint.png"]);
    expect(() =>
      prepareNativePublicAssetPreviewDocument(
        `<base href="https://elsewhere.example/"><img src="paint.png">${manifest}`,
        "https://design.example.test/editor/board",
      ),
    ).toThrowError(NativePublicAssetPreviewError);
  });

  it("fails instead of partially indexing an oversized asset set", () => {
    const html =
      manifest +
      Array.from(
        { length: 129 },
        (_, index) => `<img src="/images/${index}.png">`,
      ).join("");
    expect(() =>
      prepareNativePublicAssetPreviewDocument(
        html,
        "https://design.example.test/editor",
      ),
    ).toThrowError(NativePublicAssetPreviewError);
  });

  it("only serves an allowlisted public image to the exact iframe and nonce", async () => {
    const prepared = prepareNativePublicAssetPreviewDocument(
      `${manifest}<img src="/images/public.png">`,
      "https://design.example.test/editor",
    );
    const frame = document.createElement("iframe");
    frame.srcdoc = prepared.html;
    document.body.append(frame);
    const bitmap = { width: 2, height: 2, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );
    const fetchImage = vi.fn(async () => {
      const response = new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
      Object.defineProperty(response, "url", { value: prepared.urls[0] });
      return response;
    });
    vi.stubGlobal("fetch", fetchImage);
    const cleanup = connectNativePublicAssetPreview(frame, prepared);
    const wrong = new MessageChannel();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: {
          type: "native-public-asset-ready",
          nonce: "wrong-nonce-01234567",
        },
        ports: [wrong.port2],
      }),
    );
    expect(fetchImage).not.toHaveBeenCalled();
    const channel = new MessageChannel();
    const connected = new Promise<MessageEvent>((resolve) => {
      channel.port1.onmessage = resolve;
      channel.port1.start();
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "native-public-asset-ready", nonce: prepared.nonce },
        ports: [channel.port2],
      }),
    );
    expect((await connected).data).toMatchObject({
      type: "native-public-asset-connect",
      nonce: prepared.nonce,
      urls: prepared.urls,
    });
    const result = new Promise<MessageEvent>((resolve) => {
      channel.port1.onmessage = resolve;
    });
    channel.port1.postMessage({
      type: "native-public-asset-request",
      requestId: 1,
      index: 0,
    });
    expect((await result).data).toMatchObject({
      type: "native-public-asset-result",
      requestId: 1,
      blob: { type: "image/png" },
    });
    expect(fetchImage).toHaveBeenCalledWith(prepared.urls[0], {
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    });
    expect(bitmap.close).toHaveBeenCalledOnce();
    cleanup();
    channel.port1.close();
    wrong.port1.close();
    wrong.port2.close();
  });

  it("retries a failed image, deduplicates its success, and rolls back rejected byte charges", async () => {
    const prepared = prepareNativePublicAssetPreviewDocument(
      `${manifest}${Array.from(
        { length: 6 },
        (_, index) => `<img src="/images/${index}.png">`,
      ).join("")}`,
      "https://design.example.test/editor",
    );
    const frame = document.createElement("iframe");
    frame.srcdoc = prepared.html;
    document.body.append(frame);

    const OriginalBlob = globalThis.Blob;
    let reportedBlobSize = 0;
    vi.stubGlobal(
      "Blob",
      class extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          Object.defineProperty(this, "size", { value: reportedBlobSize });
        }
      },
    );
    const imageSizes = [13, 13, 13, 13, 16, 12].map(
      (megabytes) => megabytes * 1024 * 1024,
    );
    let fetchAttempt = 0;
    const fetchImage = vi.fn(async (url: string) => {
      fetchAttempt += 1;
      if (fetchAttempt === 1) throw new Error("temporary network failure");
      reportedBlobSize = imageSizes[fetchAttempt - 2]!;
      const response = new Response(new Uint8Array([1]), {
        headers: { "content-type": "image/png" },
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    vi.stubGlobal("fetch", fetchImage);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
    );

    const cleanup = connectNativePublicAssetPreview(frame, prepared);
    const channel = new MessageChannel();
    const connected = new Promise<MessageEvent>((resolve) => {
      channel.port1.onmessage = resolve;
      channel.port1.start();
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "native-public-asset-ready", nonce: prepared.nonce },
        ports: [channel.port2],
      }),
    );
    await connected;

    const request = (requestId: number, index: number) =>
      new Promise<MessageEvent>((resolve) => {
        channel.port1.onmessage = resolve;
        channel.port1.postMessage({
          type: "native-public-asset-request",
          requestId,
          index,
        });
      });
    expect((await request(1, 0)).data).toMatchObject({
      type: "native-public-asset-result",
      requestId: 1,
      error: { code: "source-public-asset-unavailable" },
    });
    expect((await request(2, 0)).data).toMatchObject({
      type: "native-public-asset-result",
      requestId: 2,
      blob: { type: "image/png" },
    });
    expect((await request(3, 0)).data).toMatchObject({
      type: "native-public-asset-result",
      requestId: 3,
      blob: { type: "image/png" },
    });
    expect(fetchImage).toHaveBeenCalledTimes(2);

    for (const index of [1, 2, 3]) {
      const result = await request(index + 3, index);
      expect(result.data).toMatchObject({
        type: "native-public-asset-result",
        blob: { type: "image/png" },
      });
    }
    expect((await request(7, 4)).data).toMatchObject({
      type: "native-public-asset-result",
      requestId: 7,
      error: { code: "source-public-asset-too-large" },
    });
    expect((await request(8, 5)).data).toMatchObject({
      type: "native-public-asset-result",
      requestId: 8,
      blob: { type: "image/png" },
    });
    expect(fetchImage).toHaveBeenCalledTimes(7);

    cleanup();
    channel.port1.close();
    channel.port2.close();
  });

  it("aborts an in-flight public fetch when the preview is replaced", async () => {
    const prepared = prepareNativePublicAssetPreviewDocument(
      `${manifest}<img src="/images/slow.png">`,
      "https://design.example.test/editor",
    );
    const frame = document.createElement("iframe");
    frame.srcdoc = prepared.html;
    document.body.append(frame);
    let requestSignal: AbortSignal | undefined;
    let notifyFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        notifyFetchStarted?.();
        return new Promise<Response>((_, reject) => {
          requestSignal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
    const cleanup = connectNativePublicAssetPreview(frame, prepared);
    const channel = new MessageChannel();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "native-public-asset-ready", nonce: prepared.nonce },
        ports: [channel.port2],
      }),
    );
    channel.port1.postMessage({
      type: "native-public-asset-request",
      requestId: 1,
      index: 0,
    });
    await fetchStarted;
    cleanup();
    expect(requestSignal?.aborted).toBe(true);
    channel.port1.close();
  });
});
