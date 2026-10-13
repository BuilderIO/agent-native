import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  verifyTwoFactor,
} from "./two-factor.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("two-factor client responses", () => {
  it("rejects an incomplete successful setup response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ method: "totp" })),
    );

    await expect(enableTwoFactor()).rejects.toThrow("invalid response");
  });

  it("rejects an incomplete successful verification response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));

    await expect(verifyTwoFactor("123456")).rejects.toThrow("invalid response");
  });

  it("rejects an incomplete successful disable response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));

    await expect(disableTwoFactor()).rejects.toThrow("invalid response");
  });

  it("rejects an incomplete successful status response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));

    await expect(getTwoFactorStatus()).rejects.toThrow(
      "Could not load two-factor settings.",
    );
  });
});
