import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderMagicLinkEmail,
  renderVerifySignupEmail,
} from "./email-templates";

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

  it("uses a custom package name when app branding is not configured", () => {
    vi.stubEnv("npm_package_name", "try-marisco");

    const rendered = renderVerifySignupEmail({
      email: "reader@example.com",
      verifyUrl: "https://example.com/verify?token=abc",
    });

    expect(rendered.subject).toBe("Verify your email for Try Marisco");
    expect(rendered.html).toContain('alt="Try Marisco"');
    expect(rendered.html).not.toContain("Agent-Native");
    expect(rendered.appSender).toBeUndefined();
  });

  it("keeps first-party template branding and the embedded logo", () => {
    vi.stubEnv("npm_package_name", "slides");

    const rendered = renderVerifySignupEmail({
      email: "reader@example.com",
      verifyUrl: "https://example.com/verify?token=abc",
    });

    expect(rendered.subject).toBe("Verify your email for Agent-Native Slides");
    expect(rendered.html).toContain('src="cid:agent-native-logo"');
    expect(rendered.appSender).toMatchObject({
      name: "Agent-Native Slides",
      slug: "slides",
    });
  });

  it("keeps a same-named custom scaffold off first-party branding", () => {
    vi.stubEnv("npm_package_name", "slides");
    vi.stubEnv("VITE_AGENT_NATIVE_TEMPLATE", "chat");

    const rendered = renderVerifySignupEmail({
      email: "reader@example.com",
      verifyUrl: "https://example.com/verify?token=abc",
    });

    expect(rendered.subject).toBe("Verify your email for Slides");
    expect(rendered.html).not.toContain("Agent-Native");
    expect(rendered.appSender).toBeUndefined();
  });

  it("uses a configured custom logo in auth email branding", () => {
    vi.stubEnv("APP_NAME", "Try Marisco");
    vi.stubEnv("APP_LOGO_URL", "https://cdn.example.com/try-marisco.png");

    const rendered = renderVerifySignupEmail({
      email: "reader@example.com",
      verifyUrl: "https://example.com/verify?token=abc",
    });

    expect(rendered.html).toContain(
      'src="https://cdn.example.com/try-marisco.png"',
    );
    expect(rendered.html).not.toContain('src="cid:agent-native-logo"');
  });
});

describe("renderMagicLinkEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the one-time sign-in link with the app brand", () => {
    vi.stubEnv("APP_NAME", "Acme Portal");

    const rendered = renderMagicLinkEmail({
      email: "reader@example.com",
      magicLinkUrl: "https://example.com/magic-link?token=abc",
    });

    expect(rendered.subject).toBe("Your sign-in link for Acme Portal");
    expect(rendered.html).toContain("Sign in securely");
    expect(rendered.html).toContain("expires in 5 minutes");
    expect(rendered.text).toContain("https://example.com/magic-link?token=abc");
    expect(rendered.appSender).toBeUndefined();
  });
});
