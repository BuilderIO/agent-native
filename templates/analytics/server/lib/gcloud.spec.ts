import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCredential } from "./credentials.js";
import { getAccessToken, fetchGoogleWithRetry } from "./gcloud.js";

vi.mock("./credentials.js", () => ({
  resolveCredential: vi.fn(),
}));

vi.mock("./credentials-context.js", () => ({
  credentialCacheScope: vi.fn(() => "test-scope"),
  requireRequestCredentialContext: vi.fn(() => ({})),
  scopedCredentialCacheKey: vi.fn(() => "test-scope"),
}));

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

  it("aborts an in-flight retry request when the caller deadline expires", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchGoogleWithRetry(
      "https://example.test",
      {},
      "test request",
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
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

describe("getAccessToken", () => {
  it("stops waiting on credential resolution when the caller deadline expires", async () => {
    let resolveCredentials!: (value: string) => void;
    const credentialRead = new Promise<string>((resolve) => {
      resolveCredentials = resolve;
    });
    vi.mocked(resolveCredential).mockReturnValueOnce(credentialRead);

    const controller = new AbortController();
    const pending = getAccessToken(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveCredentials("{}");
  });
});
