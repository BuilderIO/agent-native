import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identityEnabled: true,
  requestOrigin: "https://beta.design.agent-native.com",
}));

vi.mock("../server/lib/builder-identity-enabled.js", () => ({
  isBuilderIdentityEnabled: () => mocks.identityEnabled,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => ({ requestOrigin: mocks.requestOrigin }),
}));
vi.mock("@agent-native/core/server", () => ({ signShortLivedToken: vi.fn() }));
vi.mock("@agent-native/core/visual-edit-bridge-capability", () => ({
  createLocalhostBridgeAudience: vi.fn(),
  issueLocalhostBridgeOperationCapability: vi.fn(),
}));
vi.mock("./motion-localhost-relay.js", () => ({
  ensureMotionLocalhostRelayChain: vi.fn(),
  motionLocalhostRelayIdentity: vi.fn(),
}));

import { isSameOriginVisualEditBrowserRequest } from "./visual-edit-browser-request.js";

function request(headers: Record<string, string>) {
  return {
    caller: "frontend" as const,
    requestHeaders: new Headers(headers),
  };
}

describe("isSameOriginVisualEditBrowserRequest", () => {
  beforeEach(() => {
    mocks.identityEnabled = true;
    mocks.requestOrigin = "https://beta.design.agent-native.com";
  });

  it("accepts the service's own origin", () => {
    expect(
      isSameOriginVisualEditBrowserRequest(
        request({
          origin: "https://beta.design.agent-native.com",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("accepts a same-origin Builder host page behind the proxy", () => {
    for (const origin of [
      "https://beta.builder.io",
      "https://www.builder.io",
      "https://builder.io",
    ]) {
      expect(
        isSameOriginVisualEditBrowserRequest(
          request({ origin, "sec-fetch-site": "same-origin" }),
        ),
      ).toBe(true);
    }
  });

  it("rejects a Builder host origin that is not same-origin", () => {
    for (const site of ["cross-site", "same-site", "none", undefined]) {
      expect(
        isSameOriginVisualEditBrowserRequest(
          request({
            origin: "https://beta.builder.io",
            ...(site ? { "sec-fetch-site": site } : {}),
          }),
        ),
      ).toBe(false);
    }
  });

  it("rejects other origins and lookalike hosts", () => {
    for (const origin of [
      "https://evil.example",
      "https://builder.io.evil.example",
      "https://notbuilder.io",
      "http://beta.builder.io",
    ]) {
      expect(
        isSameOriginVisualEditBrowserRequest(
          request({ origin, "sec-fetch-site": "same-origin" }),
        ),
      ).toBe(false);
    }
  });

  it("rejects a Builder host origin when Builder identity is off", () => {
    mocks.identityEnabled = false;
    expect(
      isSameOriginVisualEditBrowserRequest(
        request({
          origin: "https://beta.builder.io",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(false);
  });
});
