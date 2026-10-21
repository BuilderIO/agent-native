import { describe, expect, it } from "vitest";

import {
  isNativePreviewViewportRequest,
  isNativePreviewViewportResponse,
  isTrustedOpaquePreviewViewportRequest,
  isTrustedOpaquePreviewViewportPortResponse,
  trustedOpaquePreviewParentOrigin,
  type NativePreviewViewportRequest,
  type NativePreviewViewportResponse,
} from "./native-preview-viewport-transport";

const request: NativePreviewViewportRequest = {
  type: "native-preview-viewport-request",
  schemaVersion: 1,
  nonce: "viewport_nonce_123456",
  width: 800,
  height: 600,
};

const response: NativePreviewViewportResponse = {
  type: "native-preview-viewport",
  schemaVersion: 1,
  nonce: request.nonce,
  width: request.width,
  height: request.height,
  viewport: { x: 0, y: 40, width: 800, height: 560 },
  maxViewportWidth: 800,
  maxViewportHeight: 600,
  displayScale: 1.5,
};

describe("opaque preview viewport transport", () => {
  it("accepts bounded geometry requests and rejects invalid dimensions or nonces", () => {
    expect(isNativePreviewViewportRequest(request)).toBe(true);
    expect(
      isNativePreviewViewportRequest({
        ...request,
        width: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
    expect(isNativePreviewViewportRequest({ ...request, width: 16_385 })).toBe(
      false,
    );
    expect(isNativePreviewViewportRequest({ ...request, nonce: "short" })).toBe(
      false,
    );
  });

  it("publishes only for requests from the exact opaque iframe", () => {
    expect(
      isTrustedOpaquePreviewViewportRequest({
        eventSourceIsFrame: true,
        eventOrigin: "null",
        hasOneTransferredPort: true,
        request,
      }),
    ).toBe(true);
    expect(
      isTrustedOpaquePreviewViewportRequest({
        eventSourceIsFrame: false,
        eventOrigin: "null",
        hasOneTransferredPort: true,
        request,
      }),
    ).toBe(false);
    expect(
      isTrustedOpaquePreviewViewportRequest({
        eventSourceIsFrame: true,
        eventOrigin: "https://design.example.test",
        hasOneTransferredPort: true,
        request,
      }),
    ).toBe(false);
    expect(
      isTrustedOpaquePreviewViewportRequest({
        eventSourceIsFrame: true,
        eventOrigin: "null",
        hasOneTransferredPort: false,
        request,
      }),
    ).toBe(false);
  });

  it("derives only a concrete HTTP(S) parent origin from the browser referrer", () => {
    expect(
      trustedOpaquePreviewParentOrigin("https://design.example.test/path"),
    ).toBe("https://design.example.test");
    expect(() => trustedOpaquePreviewParentOrigin("")).toThrow();
    expect(() =>
      trustedOpaquePreviewParentOrigin("data:text/html,preview"),
    ).toThrow();
  });

  it("accepts a channel response only for the active nonce", () => {
    const trusted = {
      nonce: request.nonce,
      response,
    };
    expect(isTrustedOpaquePreviewViewportPortResponse(trusted)).toBe(true);
    expect(
      isTrustedOpaquePreviewViewportPortResponse({
        ...trusted,
        nonce: "another_nonce_123456",
      }),
    ).toBe(false);
  });

  it("rejects unbounded response geometry and carries typed host failures", () => {
    expect(isNativePreviewViewportResponse(response)).toBe(true);
    expect(
      isNativePreviewViewportResponse({
        ...response,
        viewport: { x: -1, y: 0, width: 800, height: 600 },
      }),
    ).toBe(false);
    expect(
      isNativePreviewViewportResponse({
        ...response,
        viewport: { x: 0, y: 0, width: Number.NaN, height: 600 },
      }),
    ).toBe(false);
    expect(
      isNativePreviewViewportResponse({
        ...response,
        maxViewportWidth: 799,
      }),
    ).toBe(false);
    expect(
      isNativePreviewViewportResponse({
        ...response,
        viewport: null,
        maxViewportWidth: 800,
        maxViewportHeight: 600,
      }),
    ).toBe(false);
    expect(
      isNativePreviewViewportResponse({
        ...response,
        viewport: null,
        maxViewportWidth: null,
        maxViewportHeight: null,
        error: {
          code: "preview-viewport-unreadable",
          message: "The host transform is unsupported.",
        },
      }),
    ).toBe(true);
  });
});
