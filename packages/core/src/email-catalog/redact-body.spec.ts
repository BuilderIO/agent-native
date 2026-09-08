import { describe, expect, it } from "vitest";

import { redactSensitiveEmailBodyContent } from "./redact-body.js";

describe("redactSensitiveEmailBodyContent", () => {
  it("redacts a magic-link URL", () => {
    const html =
      '<a href="https://app.example.com/magic-link/abc123?token=super-secret-one-time-token">Sign in</a>';
    const redacted = redactSensitiveEmailBodyContent(html);
    expect(redacted).not.toContain("super-secret-one-time-token");
    expect(redacted).not.toContain("magic-link");
    expect(redacted).toContain("[REDACTED LINK]");
    expect(redacted).toContain("Sign in");
  });

  it("redacts a password-reset link", () => {
    const text =
      "Reset your password: https://app.example.com/reset-password?code=xyz9876543";
    const redacted = redactSensitiveEmailBodyContent(text);
    expect(redacted).not.toContain("xyz9876543");
    expect(redacted).not.toContain("reset-password");
    expect(redacted).toContain("[REDACTED LINK]");
    expect(redacted).toContain("Reset your password:");
  });

  it("redacts an OTP/verification code", () => {
    const text = "Your verification code is 482913. It expires in 10 minutes.";
    const redacted = redactSensitiveEmailBodyContent(text);
    expect(redacted).not.toContain("482913");
    expect(redacted).toContain(
      "Your verification code is [REDACTED]. It expires in 10 minutes.",
    );
  });

  it("redacts a code stated before the OTP keyword", () => {
    const text = "739201 is your one-time password.";
    const redacted = redactSensitiveEmailBodyContent(text);
    expect(redacted).not.toContain("739201");
    expect(redacted).toContain("[REDACTED] is your one-time password.");
  });

  it("redacts a JWT-shaped token", () => {
    const text =
      "Session token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const redacted = redactSensitiveEmailBodyContent(text);
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toContain("Session token:");
  });

  it("leaves ordinary content and non-sensitive links untouched", () => {
    const html =
      "<p>Thanks for your order #48213! Track it at " +
      '<a href="https://app.example.com/orders/48213">this link</a>. ' +
      "Our support number is 555-0199.</p>";
    const redacted = redactSensitiveEmailBodyContent(html);
    expect(redacted).toBe(html);
  });

  it("does not redact an unrelated 6-digit number with no OTP keyword nearby", () => {
    const text = "Invoice #482913 is attached for your records.";
    const redacted = redactSensitiveEmailBodyContent(text);
    expect(redacted).toBe(text);
  });
});
