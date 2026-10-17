import { describe, expect, it } from "vitest";

import { requestForwardedOrigin } from "./origin-allowlist.js";

describe("requestForwardedOrigin", () => {
  it("derives the origin from x-forwarded-proto/x-forwarded-host", () => {
    const request = new Request(
      "http://127.0.0.1:3000/_agent-native/auth/ba/sign-up/email",
      {
        method: "POST",
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "cloud-branch.example.com",
        },
      },
    );
    expect(requestForwardedOrigin(request)).toBe(
      "https://cloud-branch.example.com",
    );
  });

  it("falls back to the Host header when no x-forwarded-host is set", () => {
    const request = new Request("http://127.0.0.1:3000/sign-up", {
      method: "POST",
      headers: {
        "x-forwarded-proto": "https",
        host: "cloud-branch.example.com",
      },
    });
    expect(requestForwardedOrigin(request)).toBe(
      "https://cloud-branch.example.com",
    );
  });

  it("falls back to the request URL's own scheme and host when nothing is forwarded", () => {
    const request = new Request("http://localhost:3000/sign-up", {
      method: "POST",
    });
    expect(requestForwardedOrigin(request)).toBe("http://localhost:3000");
  });

  it("never echoes the client-supplied Origin header", () => {
    const request = new Request("http://127.0.0.1:3000/sign-up", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(requestForwardedOrigin(request)).not.toBe(
      "https://evil.example.com",
    );
    expect(requestForwardedOrigin(request)).toBe("http://127.0.0.1:3000");
  });

  it("returns undefined for an undefined request", () => {
    expect(requestForwardedOrigin(undefined)).toBeUndefined();
  });
});
