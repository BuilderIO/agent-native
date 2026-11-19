import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveSecretDetailed = vi.fn();
const mockSsrfSafeFetch = vi.fn();
const mockIsBlockedExtensionUrlWithDns = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  resolveSecretDetailed: (...args: any[]) => mockResolveSecretDetailed(...args),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns: (...args: unknown[]) =>
    mockIsBlockedExtensionUrlWithDns(...args),
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

import { s3FileUploadProvider } from "./s3-upload-provider.js";

describe("s3FileUploadProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(false);
    mockSsrfSafeFetch.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
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

  function resolveFromEnv() {
    mockResolveSecretDetailed.mockImplementation(async (key: string) => {
      const value = process.env[key] ?? null;
      return {
        value,
        lookupFailed: false,
        ...(value ? { source: "env" } : {}),
      };
    });
  }

  function resolveFromSettings(values: Record<string, string>) {
    mockResolveSecretDetailed.mockImplementation(async (key: string) => {
      const value = values[key] ?? null;
      return {
        value,
        lookupFailed: false,
        ...(value ? { source: "workspace", scopeId: "org-1" } : {}),
      };
    });
  }

  const upload = () =>
    s3FileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "session.json",
      mimeType: "application/json",
    });

  it("stores replay objects under the replays/ key prefix", async () => {
    process.env.S3_BUCKET = "replays";
    process.env.S3_ACCESS_KEY_ID = "access";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_ENDPOINT = "https://s3.example.com";
    resolveFromEnv();

    const result = await upload();

    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(1);
    const replayUrl =
      /^https:\/\/s3\.example\.com\/replays\/replays\/\d+-[a-z0-9]+\.json$/;
    expect(String(mockSsrfSafeFetch.mock.calls[0]?.[0])).toMatch(replayUrl);
    expect(result.url).toMatch(replayUrl);
    expect(result.provider).toBe("s3");
  });

  it("keeps an endpoint's base path in the request and the returned URL", async () => {
    resolveFromSettings({
      S3_BUCKET: "files",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://proj.storage.supabase.co/storage/v1/s3/",
    });

    const result = await upload();

    const [url, init] = mockSsrfSafeFetch.mock.calls[0] ?? [];
    expect(String(url)).toMatch(
      /^https:\/\/proj\.storage\.supabase\.co\/storage\/v1\/s3\/files\/replays\/\d+-[a-z0-9]+\.json$/,
    );
    expect(init.headers.Authorization).toContain("AWS4-HMAC-SHA256");
    expect(result.url).toBe(String(url));
  });

  it("returns the public URL when one is set", async () => {
    resolveFromSettings({
      S3_BUCKET: "files",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://proj.storage.supabase.co/storage/v1/s3",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/media/",
    });

    await expect(upload()).resolves.toMatchObject({
      url: expect.stringMatching(
        /^https:\/\/cdn\.example\.com\/media\/replays\/\d+-[a-z0-9]+\.json$/,
      ),
    });
  });

  it("reports the endpoint's error", async () => {
    resolveFromSettings({
      S3_BUCKET: "files",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    });
    mockSsrfSafeFetch.mockImplementation(
      async () =>
        new Response("<Code>SignatureDoesNotMatch</Code>", { status: 403 }),
    );

    await expect(upload()).rejects.toThrow(
      "S3 PutObject failed (403): <Code>SignatureDoesNotMatch</Code>",
    );
  });

  it("refuses a plain-HTTP endpoint saved in settings", async () => {
    resolveFromSettings({
      S3_BUCKET: "files",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "http://s3.example.com",
    });

    await expect(upload()).rejects.toThrow(
      "Storage endpoints saved in settings must use HTTPS",
    );
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("refuses a private-address endpoint saved in settings", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    resolveFromSettings({
      S3_BUCKET: "files",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://10.0.0.12:9000",
    });

    await expect(upload()).rejects.toThrow(
      "SSRF blocked: refusing to fetch private/internal S3 endpoint",
    );
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("allows the deployment's own env endpoint on localhost", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    process.env.S3_BUCKET = "files";
    process.env.S3_ACCESS_KEY_ID = "access";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_ENDPOINT = "http://127.0.0.1:9000";
    resolveFromEnv();

    await upload();

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:9000/files/replays/"),
      expect.objectContaining({ method: "PUT" }),
      expect.objectContaining({
        allowedPrivateOrigins: ["http://127.0.0.1:9000"],
      }),
    );
  });

  it("refuses a workspace that reuses the env endpoint with its own keys", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    process.env.S3_ENDPOINT = "http://127.0.0.1:9000";
    process.env.S3_ACCESS_KEY_ID = "deployment-access";
    process.env.S3_SECRET_ACCESS_KEY = "deployment-secret";
    resolveFromSettings({
      S3_BUCKET: "files",
      S3_ACCESS_KEY_ID: "workspace-access",
      S3_SECRET_ACCESS_KEY: "workspace-secret",
      S3_ENDPOINT: "http://127.0.0.1:9000",
    });

    await expect(upload()).rejects.toThrow(
      "Storage endpoints saved in settings must use HTTPS",
    );
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
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

      await expect(
        s3FileUploadProvider.upload({
          data: new Uint8Array([1, 2, 3]),
          filename: "session.json",
          mimeType: "application/json",
        }),
      ).rejects.toThrow(
        new RegExp(`${mismatchedKey}.*user-controlled endpoint`, "i"),
      );
      expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    },
  );
});
