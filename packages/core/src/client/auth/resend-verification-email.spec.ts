import { afterEach, describe, expect, it, vi } from "vitest";

import { resendVerificationEmail } from "./resend-verification-email.js";

afterEach(() => vi.unstubAllGlobals());

describe("resendVerificationEmail", () => {
  it("requests verification for the supplied email and callback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: true }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await resendVerificationEmail("person@example.com", "https://app.example/");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/auth/ba/send-verification-email"),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "person@example.com",
          callbackURL: "https://app.example/",
        }),
      },
    );
  });

  it("rejects unsuccessful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(resendVerificationEmail("person@example.com")).rejects.toThrow(
      "verification email request failed",
    );
  });

  it("rejects a successful HTTP response without a successful resend status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ status: false })),
    );

    await expect(resendVerificationEmail("person@example.com")).rejects.toThrow(
      "verification email request failed",
    );
  });

  it("rejects an unreadable successful response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );

    await expect(resendVerificationEmail("person@example.com")).rejects.toThrow(
      "verification email request failed",
    );
  });
});
