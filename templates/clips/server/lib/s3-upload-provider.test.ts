import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveSecret = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  resolveSecret: (...args: any[]) => mockResolveSecret(...args),
}));

import {
  deleteS3ObjectByUrl,
  s3FileUploadProvider,
} from "./s3-upload-provider.js";

describe("s3FileUploadProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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
      S3_BUCKET: "clips",
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
    process.env.S3_BUCKET = "clips";
    process.env.S3_ACCESS_KEY_ID = "access";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_ENDPOINT = "https://s3.example.com";

    expect(s3FileUploadProvider.isConfigured()).toBe(true);
  });

  it("deletes objects that match the configured public base URL", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "us-east-1",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/media",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteS3ObjectByUrl(
        "https://cdn.example.com/media/clips/123-thumb.jpg?cacheBust=1",
      ),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3.example.com/clips-bucket/clips/123-thumb.jpg",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("AWS4-HMAC-SHA256"),
        }),
      }),
    );
  });

  it("skips URLs that do not belong to the configured S3 bucket", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteS3ObjectByUrl("https://loom.com/share/not-owned"),
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
