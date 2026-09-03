import { afterEach, describe, expect, it, vi } from "vitest";

import action from "./upload-image.js";

afterEach(() => vi.restoreAllMocks());

describe("upload-image action SSRF guard", () => {
  it("refuses to fetch internal/metadata URLs (no network call made)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      action.run({ url: "http://169.254.169.254/latest/meta-data/" }),
    ).rejects.toThrow(/SSRF blocked/i);
    await expect(
      action.run({ url: "http://127.0.0.1:9/avatar.png" }),
    ).rejects.toThrow(/SSRF blocked/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a remote URL that redirects to a private address", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/" },
      }),
    );
    // 93.184.216.34 is a public IP literal — passes the pre-flight check, so
    // the only way it fails is the redirect re-validation inside ssrfSafeFetch.
    await expect(
      action.run({ url: "http://93.184.216.34/logo.png" }),
    ).rejects.toThrow(/SSRF blocked/i);
  });
});
