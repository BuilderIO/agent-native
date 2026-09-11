import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveSecret = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  resolveSecret: (...args: any[]) => mockResolveSecret(...args),
}));

import { s3FileUploadProvider } from "./s3-upload-provider.js";

describe("s3FileUploadProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    for (const key of [
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_PUBLIC_BASE_URL",
      "R2_BUCKET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_ENDPOINT",
      "R2_REGION",
      "R2_PUBLIC_BASE_URL",
    ]) {
      delete process.env[key];
    }
  });

  it("reports configured from request-scoped DB secrets", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "replays",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });

    expect(s3FileUploadProvider.isConfigured()).toBe(false);
    await expect(s3FileUploadProvider.isConfiguredForRequest?.()).resolves.toBe(
      true,
    );
  });

  it("keeps sync env configuration as a legacy runtime signal", () => {
    process.env.S3_BUCKET = "replays";
    process.env.S3_ACCESS_KEY_ID = "access";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_ENDPOINT = "https://s3.example.com";

    expect(s3FileUploadProvider.isConfigured()).toBe(true);
  });

  it("stores replay objects under the replays/ key prefix", async () => {
    process.env.S3_BUCKET = "replays";
    process.env.S3_ACCESS_KEY_ID = "access";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_ENDPOINT = "https://s3.example.com";
    mockResolveSecret.mockImplementation(async (key: string) => {
      return process.env[key] ?? null;
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await s3FileUploadProvider.upload({
        data: new Uint8Array([1, 2, 3]),
        filename: "session.json",
        mimeType: "application/json",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(requestedUrl).toContain("/replays/");
      expect(result.url).toContain("/replays/");
      expect(result.provider).toBe("s3");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
