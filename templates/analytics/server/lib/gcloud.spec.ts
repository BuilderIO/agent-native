import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGoogleWithRetry } from "./gcloud.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGoogleWithRetry", () => {
  it("retries transient network failures within a bounded attempt count", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoogleWithRetry("https://example.test", {}, "test request"),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns permanent HTTP errors without retrying them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoogleWithRetry("https://example.test", {}, "test request"),
    ).resolves.toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("labels an exhausted network failure with the operation and attempt count", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoogleWithRetry("https://example.test", {}, "BigQuery insertAll"),
    ).rejects.toThrow(
      "Google BigQuery insertAll failed after 4 attempt(s): TypeError: fetch failed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
