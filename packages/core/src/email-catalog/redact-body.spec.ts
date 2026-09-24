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

  it("redacts a protocol-relative sensitive link", () => {
    const html =
      '<a href="//app.example.com/verify?token=abc123def456">Verify</a>';
    const redacted = redactSensitiveEmailBodyContent(html);
    expect(redacted).not.toContain("abc123def456");
    expect(redacted).toContain("[REDACTED LINK]");
    expect(redacted).toContain("Verify");
  });

  it("redacts a link whose separator is HTML-escaped as an entity", () => {
    const html =
      '<a href="https://app.example.com/dashboard?ref=weekly&amp;token=super-secret-otp-token">Open</a>';
    const redacted = redactSensitiveEmailBodyContent(html);
    expect(redacted).not.toContain("super-secret-otp-token");
    expect(redacted).toContain("[REDACTED LINK]");
  });

  it("redacts an OAuth-style token carried in a URL fragment", () => {
    const text =
      "Continue here: https://app.example.com/auth/callback#access_token=super-secret-access-token&token_type=bearer";
    const redacted = redactSensitiveEmailBodyContent(text);
    expect(redacted).not.toContain("super-secret-access-token");
    expect(redacted).toContain("[REDACTED LINK]");
  });

  it("redacts links using id_token, oobCode, and resetToken param names", () => {
    const idToken = redactSensitiveEmailBodyContent(
      "https://app.example.com/callback?id_token=super-secret-id-token-value",
    );
    expect(idToken).not.toContain("super-secret-id-token-value");

    const oobCode = redactSensitiveEmailBodyContent(
      "https://app.example.com/action?mode=resetPassword&oobCode=super-secret-oob-code-value",
    );
    expect(oobCode).not.toContain("super-secret-oob-code-value");

    const resetToken = redactSensitiveEmailBodyContent(
      "https://app.example.com/reset?resetToken=super-secret-reset-token-value",
    );
    expect(resetToken).not.toContain("super-secret-reset-token-value");
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

  it("redacts an OTP code even when a tag splits the keyword phrase", () => {
    const html = "Your <strong>verification</strong> code is 482913.";
    const redacted = redactSensitiveEmailBodyContent(html);
    expect(redacted).not.toContain("482913");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts an OTP code when an entity splits the keyword phrase", () => {
    const html = "Your verification&nbsp;code is 592014.";
    const redacted = redactSensitiveEmailBodyContent(html);
    expect(redacted).not.toContain("592014");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts a JWT-shaped token", () => {
    const fakeJwt = [
      Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: "example-user" })).toString(
        "base64url",
      ),
      Buffer.from("not-a-signature").toString("base64url"),
    ].join(".");
    const text = `Session token: ${fakeJwt}`;
    const redacted = redactSensitiveEmailBodyContent(text);
    expect(redacted).not.toContain(fakeJwt);
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
