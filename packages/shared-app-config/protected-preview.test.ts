import { describe, expect, it } from "vitest";

import {
  authorizeProtectedPreviewLaunch,
  normalizeProtectedPreviewOrigin,
  resolveFrameOAuthCallbackTarget,
  resolveProtectedPreviewOAuthRelay,
} from "./protected-preview.js";

const previewOrigin = "https://candidate.example.test";
describe("protected preview launch authorization", () => {
  it("accepts only the exact origin already bound to encrypted access", () => {
    expect(
      authorizeProtectedPreviewLaunch(`${previewOrigin}/review`, previewOrigin),
    ).toBe(previewOrigin);
    expect(
      authorizeProtectedPreviewLaunch(
        "https://sibling.example.test",
        previewOrigin,
      ),
    ).toBeNull();
    expect(
      authorizeProtectedPreviewLaunch("http://localhost:3334", previewOrigin),
    ).toBeNull();
  });
});

describe("protected preview OAuth relay", () => {
  const requestUrl =
    `${previewOrigin}/_agent-native/google/auth-url` +
    "?return=%2Farticles&desktop=1&flow_id=flow-123&redirect=1";

  it("binds the exact preview starter to one loopback app gateway", () => {
    expect(
      resolveProtectedPreviewOAuthRelay({
        requestUrl,
        configuredOrigin: previewOrigin,
        doorwayOrigin: "http://localhost:8080",
        exchangeOrigin: "http://127.0.0.1:8083",
      }),
    ).toEqual({
      starterUrl:
        "http://localhost:8080/_agent-native/google/auth-url" +
        "?return=%2Farticles&desktop=1&flow_id=flow-123&redirect=1",
      exchangeUrl:
        "http://127.0.0.1:8083/_agent-native/auth/desktop-exchange?flow_id=flow-123",
      flowId: "flow-123",
    });
  });

  it("rejects sibling previews and near-match starter paths", () => {
    expect(
      resolveProtectedPreviewOAuthRelay({
        requestUrl: requestUrl.replace(
          previewOrigin,
          "https://sibling.example.test",
        ),
        configuredOrigin: previewOrigin,
        doorwayOrigin: "http://localhost:8080",
        exchangeOrigin: "http://localhost:8083",
      }),
    ).toBeNull();
    expect(
      resolveProtectedPreviewOAuthRelay({
        requestUrl: requestUrl.replace("/auth-url", "/auth-url/collect"),
        configuredOrigin: previewOrigin,
        doorwayOrigin: "http://localhost:8080",
        exchangeOrigin: "http://localhost:8083",
      }),
    ).toBeNull();
  });

  it("rejects non-loopback brokers and incomplete native flows", () => {
    expect(
      resolveProtectedPreviewOAuthRelay({
        requestUrl,
        configuredOrigin: previewOrigin,
        doorwayOrigin: "https://broker.example.test",
        exchangeOrigin: "http://localhost:8083",
      }),
    ).toBeNull();
    expect(
      resolveProtectedPreviewOAuthRelay({
        requestUrl: requestUrl.replace("&flow_id=flow-123", ""),
        configuredOrigin: previewOrigin,
        doorwayOrigin: "http://localhost:8080",
        exchangeOrigin: "http://localhost:8083",
      }),
    ).toBeNull();
  });
});

describe("normalizeProtectedPreviewOrigin", () => {
  it("accepts HTTPS and rejects loopback, credentials, and other schemes", () => {
    expect(normalizeProtectedPreviewOrigin(`${previewOrigin}/path?q=1`)).toBe(
      previewOrigin,
    );
    expect(normalizeProtectedPreviewOrigin("http://localhost:3334")).toBeNull();
    expect(
      normalizeProtectedPreviewOrigin(
        "https://user:password@candidate.example.test",
      ),
    ).toBeNull();
    expect(normalizeProtectedPreviewOrigin("file:///tmp/candidate")).toBeNull();
  });
});

describe("resolveFrameOAuthCallbackTarget", () => {
  it("routes both supported Frame callback variants to the exact app base", () => {
    expect(
      resolveFrameOAuthCallbackTarget({
        appBaseUrl: `${previewOrigin}/mounted`,
        callbackUrl:
          "http://localhost:3334/_agent-native/google/callback?code=example",
      }),
    ).toBe(
      `${previewOrigin}/mounted/_agent-native/google/callback?code=example`,
    );
    expect(
      resolveFrameOAuthCallbackTarget({
        appBaseUrl: previewOrigin,
        callbackUrl: "http://127.0.0.1:3334/api/google/callback?code=example",
      }),
    ).toBe(`${previewOrigin}/api/google/callback?code=example`);
  });

  it("rejects callbacks from another origin or outside the Google routes", () => {
    expect(
      resolveFrameOAuthCallbackTarget({
        appBaseUrl: previewOrigin,
        callbackUrl:
          "https://attacker.example.test/_agent-native/google/callback",
      }),
    ).toBeNull();
    expect(
      resolveFrameOAuthCallbackTarget({
        appBaseUrl: previewOrigin,
        callbackUrl: "http://localhost:3334/collect",
      }),
    ).toBeNull();
  });
});
