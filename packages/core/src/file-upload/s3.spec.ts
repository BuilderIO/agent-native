import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveSecretMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  resolveSecret: (...args: unknown[]) => resolveSecretMock(...args),
}));

import { s3FileUploadProvider } from "./s3.js";

describe("s3FileUploadProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of [
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_REGION",
      "S3_PUBLIC_BASE_URL",
    ]) {
      delete process.env[key];
    }
    resolveSecretMock.mockReset();
    resolveSecretMock.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is unavailable until all public URL and credential values exist", async () => {
    expect(s3FileUploadProvider.isConfigured()).toBe(false);
    await expect(s3FileUploadProvider.isConfiguredForRequest?.()).resolves.toBe(
      false,
    );
  });

  it("uploads through a request-scoped S3-compatible bucket and returns a stable URL", async () => {
    const secrets: Record<string, string> = {
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "uploads-example",
      S3_ACCESS_KEY_ID: "access-example",
      S3_SECRET_ACCESS_KEY: "secret-example",
      S3_REGION: "us-east-1",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/assets",
    };
    resolveSecretMock.mockImplementation(
      async (key: string) => secrets[key] ?? null,
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(s3FileUploadProvider.isConfiguredForRequest?.()).resolves.toBe(
      true,
    );
    const result = await s3FileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "hero image.png",
      mimeType: "image/png",
    });

    expect(result.provider).toBe("s3");
    expect(result.url).toMatch(
      /^https:\/\/cdn\.example\.com\/assets\/uploads\/\d+-[a-z0-9]+-hero_image\.png$/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toMatch(
      /^https:\/\/s3\.example\.com\/uploads-example\/uploads\/\d+-[a-z0-9]+-hero_image\.png$/,
    );
    expect(requestInit).toMatchObject({
      method: "PUT",
      headers: expect.objectContaining({
        Authorization: expect.stringContaining("Credential=access-example/"),
        "content-type": "image/png",
      }),
    });
  });
});
