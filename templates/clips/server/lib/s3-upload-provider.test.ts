import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveSecret = vi.fn();
const mockReadAppSecret = vi.fn();
const mockGetRequestOrgId = vi.fn();
const mockSsrfSafeFetch = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: (...args: any[]) => mockGetRequestOrgId(...args),
  resolveSecret: (...args: any[]) => mockResolveSecret(...args),
}));
vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

import {
  clipsOrganizationLogoPrivateBlobProvider,
  deleteS3ObjectByUrl,
  fetchS3OrganizationLogoByLegacyUrl,
  fetchS3ObjectByUrl,
  isS3ObjectUrlBoundToRecording,
  s3FileUploadProvider,
} from "./s3-upload-provider.js";

describe("s3FileUploadProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAppSecret.mockReset().mockResolvedValue(null);
    mockGetRequestOrgId.mockReset().mockReturnValue("org-1");
    mockSsrfSafeFetch.mockImplementation((url: string, init: RequestInit) =>
      fetch(url, init),
    );
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

  it("reads a stable private logo handle from the currently configured bucket", async () => {
    const requestValues: Record<string, string> = {
      S3_BUCKET: "user-bucket",
      S3_ACCESS_KEY_ID: "user-access",
      S3_SECRET_ACCESS_KEY: "user-secret",
      S3_ENDPOINT: "https://user-s3.example.com",
      S3_REGION: "us-east-1",
    };
    const workspaceValues: Record<string, string> = {
      S3_BUCKET: "old-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "us-east-1",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return requestValues[key] ?? null;
    });
    mockReadAppSecret.mockImplementation(
      async ({ key, scope, scopeId }: Record<string, string>) => {
        if (scope !== "workspace" || scopeId !== "org-1") return null;
        return workspaceValues[key] ? { value: workspaceValues[key] } : null;
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response("logo-bytes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const handle = await clipsOrganizationLogoPrivateBlobProvider.put({
      data: new TextEncoder().encode("logo-bytes"),
      mimeType: "image/png",
      metadata: {
        organizationId: "org-1",
        purpose: "organization-brand-logo",
      },
    });
    expect(handle).toMatchObject({
      provider: "clips-s3-organization-logos",
      opaque: true,
      encrypted: false,
      mimeType: "image/png",
    });
    expect(handle.id).toMatch(
      /^clips\/organization-branding\/b3JnLTE\/[0-9a-f-]{36}\.png$/,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://s3.example.com/old-bucket/${handle.id}`,
    );

    workspaceValues.S3_BUCKET = "new-bucket";
    await expect(
      clipsOrganizationLogoPrivateBlobProvider.read(handle),
    ).resolves.toMatchObject({
      data: new TextEncoder().encode("logo-bytes"),
      handle,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://s3.example.com/new-bucket/${handle.id}`,
    );
    expect(mockResolveSecret).not.toHaveBeenCalled();
  });

  it("does not configure organization-logo storage from user-only credentials", async () => {
    const requestValues: Record<string, string> = {
      S3_BUCKET: "user-bucket",
      S3_ACCESS_KEY_ID: "user-access",
      S3_SECRET_ACCESS_KEY: "user-secret",
      S3_ENDPOINT: "https://user-s3.example.com",
    };
    mockResolveSecret.mockImplementation(
      async (key: string) => requestValues[key] ?? null,
    );

    await expect(
      clipsOrganizationLogoPrivateBlobProvider.isConfiguredForRequest?.(),
    ).resolves.toBe(false);
    await expect(
      clipsOrganizationLogoPrivateBlobProvider.put({
        data: new TextEncoder().encode("logo-bytes"),
        mimeType: "image/png",
        metadata: {
          organizationId: "org-1",
          purpose: "organization-brand-logo",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockResolveSecret).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("reads private logos with the owning workspace's S3 credentials anonymously", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "org-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "us-east-1",
    };
    mockResolveSecret.mockResolvedValue(null);
    mockReadAppSecret.mockImplementation(
      async ({ key, scope, scopeId }: Record<string, string>) => {
        if (scope !== "workspace" || scopeId !== "org-1") return null;
        return values[key] ? { value: values[key] } : null;
      },
    );
    const fetchMock = vi.fn(async () => new Response("logo-bytes"));
    vi.stubGlobal("fetch", fetchMock);

    const handle = {
      id: "clips/organization-branding/b3JnLTE/00000000-0000-4000-8000-000000000001.png",
      provider: "clips-s3-organization-logos",
      opaque: true,
      encrypted: false,
      mimeType: "image/png",
      metadata: {
        organizationId: "org-1",
        purpose: "organization-brand-logo",
      },
    } as const;

    await expect(
      clipsOrganizationLogoPrivateBlobProvider.read(handle),
    ).resolves.toMatchObject({ data: new TextEncoder().encode("logo-bytes") });
    expect(mockResolveSecret).not.toHaveBeenCalled();
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "S3_BUCKET",
      scope: "workspace",
      scopeId: "org-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/org-bucket/clips/organization-branding/"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://s3.example.com/org-bucket/"),
      expect.objectContaining({ method: "GET" }),
      { followRedirects: false, requireDispatcher: true },
    );

    const workspaceReadCount = mockReadAppSecret.mock.calls.length;
    await expect(
      clipsOrganizationLogoPrivateBlobProvider.read({
        ...handle,
        metadata: { ...handle.metadata, organizationId: "org-2" },
      }),
    ).rejects.toThrow("Clips organization logo handle is invalid");
    expect(mockReadAppSecret).toHaveBeenCalledTimes(workspaceReadCount);
  });

  it("uses current S3 credentials for a legacy logo key and preserves missing-object status", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "current-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "us-east-1",
    };
    mockReadAppSecret.mockImplementation(
      async ({ key, scope, scopeId }: Record<string, string>) => {
        if (scope !== "workspace" || scopeId !== "org-1") return null;
        return values[key] ? { value: values[key] } : null;
      },
    );
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchS3OrganizationLogoByLegacyUrl(
      "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png",
      "org-1",
    );

    expect(result?.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3.example.com/current-bucket/clips/logo-abc123/1722720000000-abcd1234.png",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails loudly when a recognized legacy logo URL has no current storage config", async () => {
    mockResolveSecret.mockResolvedValue(null);

    await expect(
      fetchS3OrganizationLogoByLegacyUrl(
        "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png",
        "org-1",
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
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

  it("reads configured public URLs with scoped credentials and forwards byte ranges", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "us-east-1",
      S3_PUBLIC_BASE_URL: "https://clips.example.com/api/storage",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const fetchMock = vi.fn(
      async () =>
        new Response("media", {
          status: 206,
          headers: { "content-range": "bytes 0-31/100" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchS3ObjectByUrl(
        "https://clips.example.com/api/storage/clips/recording.webm",
        { range: "bytes=0-31", recordingId: "recording" },
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 206 }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3.example.com/clips-bucket/clips/recording.webm",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining(
            "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date",
          ),
          range: "bytes=0-31",
        }),
      }),
    );
  });

  it("does not expose multipart staging objects through signed reads", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_PUBLIC_BASE_URL: "https://clips.example.com/api/storage",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchS3ObjectByUrl(
        "https://clips.example.com/api/storage/clips/.multipart/recording.webm.pending",
        { recordingId: "recording" },
      ),
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only signs media keys bound to the requested recording", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_PUBLIC_BASE_URL: "https://clips.example.com/api/storage",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const fetchMock = vi.fn(async () => new Response("media"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchS3ObjectByUrl(
        "https://clips.example.com/api/storage/clips/other-recording/video.webm",
        { recordingId: "rec_1" },
      ),
    ).resolves.toBeNull();
    await expect(
      fetchS3ObjectByUrl(
        "https://clips.example.com/api/storage/clips/rec.1.webm",
        { recordingId: "rec" },
      ),
    ).resolves.toBeNull();
    await expect(
      fetchS3ObjectByUrl(
        "https://clips.example.com/api/storage/clips/rec_1/video.webm",
        { recordingId: "rec_1" },
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 200 }));
    await expect(
      fetchS3ObjectByUrl(
        "https://clips.example.com/api/storage/clips/rec.1.webm",
        { recordingId: "rec.1" },
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 200 }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows only explicitly authorized legacy unscoped recording keys", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_PUBLIC_BASE_URL: "https://clips.example.com/api/storage",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const fetchMock = vi.fn(async () => new Response("legacy media"));
    vi.stubGlobal("fetch", fetchMock);
    const legacyUrl =
      "https://clips.example.com/api/storage/clips/1722720000000-abc123xy.webm";

    await expect(
      fetchS3ObjectByUrl(legacyUrl, { recordingId: "rec_1" }),
    ).resolves.toBeNull();
    await expect(
      fetchS3ObjectByUrl(legacyUrl, {
        recordingId: "rec_1",
        allowLegacyObjectKey: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 200 }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates recording-bound S3 URLs without reading the object", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_PUBLIC_BASE_URL: "https://clips.example.com/api/storage",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });

    await expect(
      isS3ObjectUrlBoundToRecording(
        "https://clips.example.com/api/storage/clips/rec_1/video.mp4",
        "rec_1",
      ),
    ).resolves.toBe(true);
    await expect(
      isS3ObjectUrlBoundToRecording(
        "https://clips.example.com/api/storage/clips/other/video.mp4",
        "rec_1",
      ),
    ).resolves.toBe(false);
    await expect(
      isS3ObjectUrlBoundToRecording(
        "https://builder.io/uploads/video.mp4",
        "rec_1",
      ),
    ).resolves.toBeNull();
  });

  it("preserves timeout classification for signed reads", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

    await expect(
      fetchS3ObjectByUrl(
        "https://s3.example.com/clips-bucket/clips/recording.webm",
        { timeoutMs: 25, recordingId: "recording" },
      ),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      message: expect.stringContaining("S3 request timed out after 25ms"),
    });
  });

  it("coalesces Netlify-safe chunks into valid S3 multipart parts", async () => {
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

    const firstChunk = new Uint8Array(3 * 1024 * 1024).fill(1);
    const secondChunk = new Uint8Array(3 * 1024 * 1024).fill(2);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("?uploads=")) {
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>upload-example</UploadId></InitiateMultipartUploadResult>",
        );
      }
      if (init?.method === "GET") return new Response(firstChunk);
      if (url.includes("partNumber=1&uploadId=upload-example")) {
        return new Response(null, {
          status: 200,
          headers: { ETag: '"part-1-example"' },
        });
      }
      if (url.endsWith("?uploadId=upload-example")) {
        return new Response("<CompleteMultipartUploadResult />");
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resumable = s3FileUploadProvider.resumable!;
    let session = await resumable.startSession(
      "recording-example.webm",
      "video/webm",
      20 * 1024 * 1024,
    );
    const first = await resumable.relayChunk(
      session,
      `bytes 0-${firstChunk.byteLength - 1}/*`,
      firstChunk,
    );
    expect(first.updatedMeta).toEqual({ pendingBytes: firstChunk.byteLength });
    session = { ...session, meta: { ...session.meta, ...first.updatedMeta } };

    const second = await resumable.relayChunk(
      session,
      `bytes ${firstChunk.byteLength}-${firstChunk.byteLength + secondChunk.byteLength - 1}/*`,
      secondChunk,
    );
    expect(second.updatedMeta).toEqual({
      pendingBytes: 0,
      parts: [
        {
          partNumber: 1,
          etag: '"part-1-example"',
          sizeBytes: firstChunk.byteLength + secondChunk.byteLength,
        },
      ],
    });
    session = { ...session, meta: { ...session.meta, ...second.updatedMeta } };

    await expect(
      resumable.completeSession(session, "recording-example.webm"),
    ).resolves.toBe(
      "https://cdn.example.com/media/clips/recording-example.webm",
    );

    const partCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("partNumber=1&uploadId=upload-example"),
    );
    expect(partCall?.[1]).toEqual(
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Length": String(
            firstChunk.byteLength + secondChunk.byteLength,
          ),
        }),
      }),
    );
    const completeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("?uploadId=upload-example"),
    );
    expect(
      new TextDecoder().decode(completeCall?.[1]?.body as ArrayBuffer),
    ).toContain("<ETag>&quot;part-1-example&quot;</ETag>");
  });

  it("commits a staged final part and aborts incomplete multipart uploads", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const chunk = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("?uploads=")) {
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>upload-example</UploadId></InitiateMultipartUploadResult>",
        );
      }
      if (init?.method === "GET") return new Response(chunk);
      if (url.includes("partNumber=1&uploadId=upload-example")) {
        return new Response(null, { headers: { ETag: '"final-example"' } });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resumable = s3FileUploadProvider.resumable!;
    let session = await resumable.startSession(
      "recording-example.webm",
      "video/webm",
      1024,
    );
    const staged = await resumable.relayChunk(session, "bytes 0-2/*", chunk);
    session = { ...session, meta: { ...session.meta, ...staged.updatedMeta } };
    const closed = await resumable.relayChunk(
      session,
      "bytes */3",
      new Uint8Array(0),
    );
    expect(closed.updatedMeta).toEqual({
      pendingBytes: 0,
      parts: [
        { partNumber: 1, etag: '"final-example"', sizeBytes: chunk.byteLength },
      ],
    });

    await expect(resumable.abortSession!(session)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("?uploadId=upload-example"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("recovers a completed multipart upload when a retry receives NoSuchUpload", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/media",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    let completeAttempts = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("uploadId=upload-example")) {
        completeAttempts += 1;
        if (completeAttempts === 1) {
          return new Response("<CompleteMultipartUploadResult />");
        }
        return new Response(
          "<Error><Code>NoSuchUpload</Code><Message>The upload does not exist</Message></Error>",
          { status: 404 },
        );
      }
      if (init?.method === "HEAD" && url.endsWith("/clips/recording.webm")) {
        return new Response(null, {
          status: 200,
          headers: { "content-length": "3" },
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = {
      sessionId: "upload-example",
      meta: {
        objectKey: "clips/recording.webm",
        stagingKey: "clips/.multipart/recording.webm.pending",
        mimeType: "video/webm",
        maxBytes: 1024,
        pendingBytes: 0,
        parts: [{ partNumber: 1, etag: '"part-example"', sizeBytes: 3 }],
      },
    };
    const resumable = s3FileUploadProvider.resumable!;

    await expect(
      resumable.completeSession(session, "recording.webm"),
    ).resolves.toBe("https://cdn.example.com/media/clips/recording.webm");
    // Simulate finalize failing after S3 completion but before it could delete
    // the persisted resumable session, then retrying with the same upload id.
    await expect(
      resumable.completeSession(session, "recording.webm"),
    ).resolves.toBe("https://cdn.example.com/media/clips/recording.webm");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3.example.com/clips-bucket/clips/recording.webm",
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("rejects resumable chunks beyond the session byte limit", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<InitiateMultipartUploadResult><UploadId>upload-example</UploadId></InitiateMultipartUploadResult>",
          ),
      ),
    );

    const resumable = s3FileUploadProvider.resumable!;
    const session = await resumable.startSession(
      "recording-example.webm",
      "video/webm",
      3,
    );
    await expect(
      resumable.relayChunk(session, "bytes 0-3/*", new Uint8Array(4)),
    ).rejects.toThrow("exceeds its 3 byte limit");
  });
});
