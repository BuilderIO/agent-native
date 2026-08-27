import { afterEach, describe, expect, it, vi } from "vitest";

import { stopGoogleDocsWatchChannel } from "./google-docs-poller.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Docs watch channel cleanup", () => {
  it("only reports success for an accepted stop request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      stopGoogleDocsWatchChannel("access-token", "channel-1", "resource-1"),
    ).resolves.toBe(true);
    await expect(
      stopGoogleDocsWatchChannel("access-token", "channel-2", "resource-2"),
    ).resolves.toBe(false);
  });

  it("treats a network failure as an unsuccessful stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );

    await expect(
      stopGoogleDocsWatchChannel("access-token", "channel-1", "resource-1"),
    ).resolves.toBe(false);
  });
});
