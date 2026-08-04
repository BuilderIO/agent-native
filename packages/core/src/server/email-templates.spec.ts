import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderResetPasswordEmail,
  renderVerifySignupEmail,
} from "./email-templates";

describe("renderResetPasswordEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps app branding in the content without overriding the sender", () => {
    vi.stubEnv("APP_NAME", "calendar");

    const rendered = renderResetPasswordEmail({
      email: "reader@example.com",
      resetUrl: "https://example.com/reset?token=abc",
    });

    expect(rendered.subject).toBe("Reset your calendar password");
    expect(rendered.appSender).toBeUndefined();
  });
});

describe("renderVerifySignupEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not mint an agent-native.com mailbox for an unrecognized app", () => {
    vi.stubEnv("APP_NAME", "Acme Portal");

    const rendered = renderVerifySignupEmail({
      email: "reader@example.com",
      verifyUrl: "https://example.com/verify?token=abc",
    });

    // No slug means sendEmail keeps the deployment's configured sender rather
    // than branding a third-party app onto the first-party domain.
    expect(rendered.appSender).toBeUndefined();
  });

  it("does not present an unrecognized app as an Agent-Native app", () => {
    vi.stubEnv("APP_NAME", "Acme Portal");

    const rendered = renderVerifySignupEmail({
      email: "reader@example.com",
      verifyUrl: "https://example.com/verify?token=abc",
    });

    expect(rendered.subject).toBe("Verify your email for Acme Portal");
    expect(rendered.html).not.toContain("Agent-Native Acme Portal");
  });
});
