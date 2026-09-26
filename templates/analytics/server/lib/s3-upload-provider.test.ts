import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveSecretDetailed = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  resolveSecretDetailed: (...args: any[]) => mockResolveSecretDetailed(...args),
}));

import { s3FileUploadProvider } from "./s3-upload-provider.js";

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
      S3_BUCKET: "replays",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecretDetailed.mockImplementation(async (key: string) => {
      const value = values[key] ?? null;
      return {
        value,
        lookupFailed: false,
        ...(value ? { source: "user", scopeId: "user@example.test" } : {}),
      };
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
    mockResolveSecretDetailed.mockImplementation(async (key: string) => {
      const value = process.env[key] ?? null;
      return {
        value,
        lookupFailed: false,
        ...(value ? { source: "env" } : {}),
      };
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

  it.each(["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const)(
    "rejects a member endpoint when %s belongs to another scope before fetching",
    async (mismatchedKey) => {
      const values: Record<string, unknown> = {
        S3_BUCKET: {
          value: "replays",
          lookupFailed: false,
          source: "org",
          scopeId: "org-1",
        },
        S3_ACCESS_KEY_ID: {
          value: "access",
          lookupFailed: false,
          source: "user",
          scopeId: "user@example.test",
        },
        S3_SECRET_ACCESS_KEY: {
          value: "secret",
          lookupFailed: false,
          source: "user",
          scopeId: "user@example.test",
        },
        S3_ENDPOINT: {
          value: "https://member-storage.example.test",
          lookupFailed: false,
          source: "user",
          scopeId: "user@example.test",
        },
      };
      values[mismatchedKey] = {
        value: "other-scope-credential",
        lookupFailed: false,
        source: "org",
        scopeId: "org-1",
      };
      mockResolveSecretDetailed.mockImplementation(
        async (key: string) =>
          values[key] ?? { value: null, lookupFailed: false },
      );
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        s3FileUploadProvider.upload({
          data: new Uint8Array([1, 2, 3]),
          filename: "session.json",
          mimeType: "application/json",
        }),
      ).rejects.toThrow(
        new RegExp(`${mismatchedKey}.*user-scoped endpoint`, "i"),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
