import { describe, expect, it } from "vitest";

import { HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT } from "./embedded-auth-ui";

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
});
