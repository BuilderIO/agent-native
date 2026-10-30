import { mockEvent } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trustedUiReturnUrl, uiReturnHandler } from "./ui-return.js";

async function run(url: string, method = "GET"): Promise<Response> {
  const result = await uiReturnHandler(mockEvent(new Request(url, { method })));
  if (result instanceof Response) return result;
  throw new Error(`expected a redirect, got ${JSON.stringify(result)}`);
}

describe("UI sign-in return", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forwards only to origins trusted with credentialed responses", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "app.example.com");
    expect(trustedUiReturnUrl("https://app.example.com/inbox?x=1#t")).toBe(
      "https://app.example.com/inbox?x=1#t",
    );
    for (const target of [
      "https://evil.example/inbox",
      "http://app.example.com/inbox",
      "https://user:pw@app.example.com/",
      "javascript:alert(1)",
      "/inbox",
      undefined,
      ["https://app.example.com/"],
    ]) {
      expect(trustedUiReturnUrl(target)).toBeNull();
    }
  });

  it("redirects a trusted target and refuses an untrusted one", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://app.example.com");
    const ok = await run(
      `https://api.example.com/_agent-native/auth/ui-return?to=${encodeURIComponent("https://app.example.com/inbox")}`,
    );
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("https://app.example.com/inbox");

    const refused = await uiReturnHandler(
      mockEvent(
        new Request(
          `https://api.example.com/_agent-native/auth/ui-return?to=${encodeURIComponent("https://evil.example/")}`,
        ),
      ),
    );
    expect(refused).toMatchObject({
      error: expect.stringContaining("CORS_ALLOWED_ORIGINS"),
    });
  });
});
