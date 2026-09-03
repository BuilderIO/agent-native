import { describe, expect, it } from "vitest";

import {
  HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT,
  isEmbeddedIdentitySsoHiddenForLoad,
} from "./embedded-auth-ui";

describe("embedded auth UI", () => {
  it("removes the app-owned SSO button and keeps ordinary auth controls untouched", () => {
    expect(HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT).toContain(
      'const selector = "#identity-sso-btn"',
    );
    expect(HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT).toContain("element.remove()");
    expect(HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT).toContain("MutationObserver");
    expect(HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT).not.toContain("#google-btn");
    expect(HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT).not.toContain("#login-form");
    expect(HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT).not.toContain("#signup-form");
  });

  it("treats a same-URL reload as a new identity-button hide boundary", () => {
    const state = {
      url: "https://mail.agent-native.com/inbox",
      loadGeneration: 3,
    };

    expect(
      isEmbeddedIdentitySsoHiddenForLoad(
        state,
        "https://mail.agent-native.com/inbox",
        3,
      ),
    ).toBe(true);
    expect(
      isEmbeddedIdentitySsoHiddenForLoad(
        state,
        "https://mail.agent-native.com/inbox",
        4,
      ),
    ).toBe(false);
  });
});
