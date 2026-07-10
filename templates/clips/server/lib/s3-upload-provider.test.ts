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
