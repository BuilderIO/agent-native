import { afterEach, describe, expect, it, vi } from "vitest";

import { renderVerifySignupEmail } from "./email-templates";

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
