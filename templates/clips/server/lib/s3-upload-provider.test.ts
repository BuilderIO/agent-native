import { createRequire } from "node:module";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mockResolveSecret = vi.fn();
const mockPrefetchSecrets = vi.fn();
const mockReadAppSecret = vi.fn();
const mockGetRequestOrgId = vi.fn();
const mockSsrfSafeFetch = vi.fn();
const mockIsBlockedExtensionUrlWithDns = vi.fn();
let hostedEndpoint = "https://hosted-s3.example.com";
let lookupFailure: Error | undefined;

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: (...args: any[]) => mockGetRequestOrgId(...args),
  prefetchSecrets: (...args: any[]) => mockPrefetchSecrets(...args),
  resolveSecret: (...args: any[]) => mockResolveSecret(...args),
  // A value that matches the deployment's env came from env; any other value
  // was saved by the workspace.
  resolveSecretDetailed: async (key: string) => {
    const value = await mockResolveSecret(key);
    // A self-hosted runtime answers a failed lookup with the env value.
    if (lookupFailure) {
      return value
        ? { value, lookupFailed: true, cause: lookupFailure, source: "env" }
        : { value: null, lookupFailed: true, cause: lookupFailure };
    }
    if (!value) return { value: null, lookupFailed: false };
    return process.env[key] === value
      ? { value, lookupFailed: false, source: "env" }
      : { value, lookupFailed: false, source: "workspace", scopeId: "org-1" };
  },
  getAppConfig: () => ({
    clips: {
      hostedStorage: {
        enabled: false,
        endpoint: hostedEndpoint,
        bucket: "hosted-clips",
        accessKeyId: "hosted-access",
        secretAccessKey: "hosted-secret",
        region: "auto",
      },
    },
  }),
  resolveClipsHostedStorageConfig: (config: Record<string, unknown>) =>
    config.enabled ? config : null,
}));
vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns: (...args: any[]) =>
    mockIsBlockedExtensionUrlWithDns(...args),
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));
// Staging references go to a real (in-memory PGlite) table; chunk bytes go
// through the mocked S3 fetch like every other object.
const stagingDb = vi.hoisted(() => ({
  client: null as null | {
    query: (
      sql: string,
      args?: unknown[],
    ) => Promise<{ rows: unknown[]; affectedRows?: number }>;
    exec: (sql: string) => Promise<unknown>;
  },
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async ({ sql, args = [] }: { sql: string; args?: unknown[] }) => {
      if (!stagingDb.client) throw new Error("staging test db not ready");
      const result = await stagingDb.client.query(sql, args);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  }),
}));

import {
  withMediaUploadCheckpoint,
  type ProducedMediaReference,
} from "./recording-media-production-context.js";
import {
  clipsOrganizationLogoPrivateBlobProvider,
  deleteS3ObjectByUrl,
  deleteS3MediaForCleanup,
  s3MediaCleanupFingerprint,
  fetchS3OrganizationLogoByLegacyUrl,
  fetchS3ObjectByUrl,
  openS3Recording,
  isS3ObjectUrlBoundToRecording,
  s3FileUploadProvider,
  s3ObjectSizeBytesByUrl,
  sweepS3MultipartStaging,
} from "./s3-upload-provider.js";

// Mirrors multipart_staging_parts in server/plugins/db.ts (migration v103).
const STAGING_DDL = `
  CREATE TABLE multipart_staging_parts (
    staging_key TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    byte_offset BIGINT NOT NULL,
    byte_length INTEGER NOT NULL,
    object_key TEXT NOT NULL,
    target_key TEXT NOT NULL,
    storage_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (staging_key, upload_id, byte_offset)
  );
  CREATE INDEX multipart_staging_parts_sweep_idx
    ON multipart_staging_parts (storage_fingerprint, updated_at);
`;

beforeAll(async () => {
  const client = await PGlite.create("memory://");
  await client.exec(STAGING_DDL);
  stagingDb.client = client;
}, 60_000);

beforeEach(async () => {
  await stagingDb.client?.exec(`DELETE FROM multipart_staging_parts`);
});

afterAll(async () => {
  await (stagingDb.client as { close?: () => Promise<void> } | null)?.close?.();
});

/**
 * An in-memory S3 bucket behind the stubbed fetch: objects, multipart uploads
 * and their parts, enough for the resumable relay end to end.
 */
function useFakeS3() {
  const values: Record<string, string> = {
    S3_BUCKET: "clips-bucket",
    S3_ACCESS_KEY_ID: "access",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_ENDPOINT: "https://s3.example.com",
  };
  mockResolveSecret.mockImplementation(
    async (key: string) => values[key] ?? null,
  );
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const uploads = new Map<string, Map<number, Uint8Array<ArrayBuffer>>>();
  let nextUpload = 0;
  const noSuchUpload = () =>
    new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
  const fetchMock = vi.fn(async (rawUrl: string, init?: RequestInit) => {
    const url = new URL(rawUrl);
    const key = decodeURIComponent(
      url.pathname.replace(/^\/clips-bucket\//, ""),
    );
    const method = init?.method ?? "GET";
    const uploadId = url.searchParams.get("uploadId");
    const body = init?.body
      ? new Uint8Array(init.body as ArrayBuffer).slice()
      : new Uint8Array(0);
    if (method === "POST" && url.searchParams.has("uploads")) {
      const id = `fake-upload-${++nextUpload}`;
      uploads.set(id, new Map());
      return new Response(
        `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
      );
    }
    if (uploadId) {
      const parts = uploads.get(uploadId);
      if (!parts) return noSuchUpload();
      if (method === "PUT") {
        const partNumber = Number(url.searchParams.get("partNumber"));
        parts.set(partNumber, body);
        return new Response(null, { headers: { ETag: `"p${partNumber}"` } });
      }
      if (method === "GET") return new Response("<ListPartsResult />");
      if (method === "DELETE") {
        uploads.delete(uploadId);
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        const ordered = [...parts].sort(([a], [b]) => a - b);
        const size = ordered.reduce((n, [, p]) => n + p.byteLength, 0);
        const out = new Uint8Array(size);
        let at = 0;
        for (const [, p] of ordered) {
          out.set(p, at);
          at += p.byteLength;
        }
        objects.set(key, out);
        uploads.delete(uploadId);
        return new Response("<CompleteMultipartUploadResult />");
      }
    }
    if (method === "PUT") {
      objects.set(key, body);
      return new Response(null, { status: 200 });
    }
    if (method === "GET" || method === "HEAD") {
      const object = objects.get(key);
      if (!object) return new Response(null, { status: 404 });
      return new Response(method === "GET" ? object : null, {
        headers: { "content-length": String(object.byteLength) },
      });
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 400 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { objects, uploads, fetch: fetchMock };
}

describe("s3FileUploadProvider", () => {
  const originalEnv = { ...process.env };
  it.each([false, true])(
    "checkpoints a resumable upload's original bucket and refuses a changed bucket (%s)",
    async (changed) => {
      const values: Record<string, string> = {
        S3_BUCKET: "bucket-a",
        S3_ACCESS_KEY_ID: "fake-access",
        S3_SECRET_ACCESS_KEY: "fake-secret",
        S3_ENDPOINT: "https://s3.example.test",
        S3_PUBLIC_BASE_URL: "https://cdn.example.test/media",
      };
      mockResolveSecret.mockImplementation(
        async (key: string) => values[key] ?? null,
      );
      const journal: ProducedMediaReference[] = [];
      mockSsrfSafeFetch.mockImplementation(
        async (url: string, init: RequestInit) => {
          if (url.includes("?uploads="))
            return new Response(
              "<InitiateMultipartUploadResult><UploadId>fake-upload</UploadId></InitiateMultipartUploadResult>",
            );
          if (init.method === "POST")
            expect(journal[0]).toMatchObject({
              storageFingerprint: session.meta.storageFingerprint,
              uploadConfirmed: false,
            });
          return new Response(null, { status: 200 });
        },
      );
      const resumable = s3FileUploadProvider.resumable;
      if (!resumable) throw new Error("Missing resumable provider");
      const session = await resumable.startSession(
        "rec_1.webm",
        "video/webm",
        100,
      );
      session.meta.parts = [{ partNumber: 1, etag: "fake-part", sizeBytes: 1 }];
      if (changed) values.S3_BUCKET = "bucket-b";
      const completion = withMediaUploadCheckpoint(
        async (output) => {
          journal.push(output);
        },
        () => resumable.completeSession(session, "rec_1.webm"),
      );
      if (changed) await expect(completion).rejects.toThrow(/binding|bucket/i);
      else {
        await expect(completion).resolves.toBe(
          "https://cdn.example.test/media/clips/rec_1.webm",
        );
        expect(journal[1]).toMatchObject({
          storageFingerprint: expect.any(String),
          uploadConfirmed: true,
        });
      }
    },
  );
  it("pins an actual buffered upload to its bucket before PUT and refuses a changed bucket behind the same public URL", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "bucket-a",
      S3_ACCESS_KEY_ID: "fake-access",
      S3_SECRET_ACCESS_KEY: "fake-secret",
      S3_ENDPOINT: "https://s3.example.com",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/media",
    };
    mockResolveSecret.mockImplementation(
      async (key: string) => values[key] ?? null,
    );
    const journal: ProducedMediaReference[] = [];
    mockSsrfSafeFetch.mockImplementation(async () => {
      expect(journal[0]).toMatchObject({
        uploadConfirmed: false,
        storageFingerprint: expect.any(String),
      });
      return new Response(null, { status: 200 });
    });
    const output = await withMediaUploadCheckpoint(
      async (reference) => {
        journal.push(reference);
      },
      () =>
        s3FileUploadProvider.upload({
          data: new Uint8Array([1]),
          filename: "rec_1.mp4",
        }),
    );
    expect(journal[1]).toMatchObject({
      url: output.url,
      uploadConfirmed: true,
    });
    expect(output.url).toMatch(/\/rec_1\/\d+-[0-9a-f-]{36}\.mp4$/);
    expect(await s3MediaCleanupFingerprint(output.url, "own")).toBe(
      journal[0]?.storageFingerprint,
    );
    values.S3_BUCKET = "bucket-b";
    const calls = mockSsrfSafeFetch.mock.calls.length;
    expect(
      await deleteS3MediaForCleanup(
        output.url,
        {
          recordingId: "rec_1",
          storageMode: "own",
          objectKey:
            "s3:" + new URL(output.url).pathname.slice("/media/".length),
          fingerprint:
            journal.find((entry) => entry.uploadConfirmed === false)
              ?.storageFingerprint ?? null,
        },
        vi.fn(),
      ),
    ).toMatchObject({ phase: "blocked", reason: "credential_space_mismatch" });
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(calls);
    expect(await s3MediaCleanupFingerprint(output.url, "own")).not.toBe(
      journal[0]?.storageFingerprint,
    );
  });

  it("keeps a successful DELETE unconfirmed when bytes still exist or versions cannot be excluded", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips",
      S3_ACCESS_KEY_ID: "fake-access",
      S3_SECRET_ACCESS_KEY: "fake-secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(
      async (key: string) => values[key] ?? null,
    );
    const url = "https://s3.example.com/clips/clips/rec_1/clip.mp4";
    const binding = {
      recordingId: "rec_1",
      storageMode: "own" as const,
      objectKey: "s3:clips/rec_1/clip.mp4",
      fingerprint: await s3MediaCleanupFingerprint(url, "own"),
    };
    mockSsrfSafeFetch.mockImplementation(
      async (_url: string, init: RequestInit) =>
        new Response(null, { status: init.method === "DELETE" ? 204 : 200 }),
    );
    expect(await deleteS3MediaForCleanup(url, binding, vi.fn())).toMatchObject({
      phase: "pending",
      reason: "still_stored",
    });
    mockSsrfSafeFetch.mockImplementation(
      async (_url: string, init: RequestInit) =>
        new Response(null, {
          status:
            init.method === "DELETE" ? 204 : init.method === "HEAD" ? 404 : 403,
        }),
    );
    expect(await deleteS3MediaForCleanup(url, binding, vi.fn())).toMatchObject({
      phase: "blocked",
      reason: "versioning_unconfirmed",
    });
    mockSsrfSafeFetch.mockImplementation(
      async (_url: string, init: RequestInit) =>
        init.method === "GET"
          ? new Response(
              "<VersioningConfiguration></VersioningConfiguration>",
              { status: 200 },
            )
          : new Response(null, {
              status: init.method === "DELETE" ? 204 : 404,
            }),
    );
    expect(await deleteS3MediaForCleanup(url, binding, vi.fn())).toMatchObject({
      phase: "complete",
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefetchSecrets.mockReset().mockResolvedValue(undefined);
    mockReadAppSecret.mockReset().mockResolvedValue(null);
    mockIsBlockedExtensionUrlWithDns.mockReset().mockResolvedValue(false);
    mockGetRequestOrgId.mockReset().mockReturnValue("org-1");
    hostedEndpoint = "https://hosted-s3.example.com";
    lookupFailure = undefined;
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

  it("binds a range reader to one recording and one resolved storage configuration", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips",
      S3_ACCESS_KEY_ID: "fake-access",
      S3_SECRET_ACCESS_KEY: "fake-secret",
      S3_ENDPOINT: "https://s3.example.test",
    };
    mockResolveSecret.mockImplementation(
      async (key: string) => values[key] ?? null,
    );
    mockSsrfSafeFetch.mockImplementation(
      async () => new Response("x", { status: 206 }),
    );
    const url = "https://s3.example.test/clips/clips/rec-1/video.mp4";
    expect(
      await openS3Recording(url, { recordingId: "other", storageMode: "own" }),
    ).toBeNull();
    const reader = await openS3Recording(url, {
      recordingId: "rec-1",
      storageMode: "own",
    });
    expect(reader).not.toBeNull();
    values.S3_ENDPOINT = "https://different.example.test";
    mockPrefetchSecrets.mockClear();
    if (!reader) throw new Error("missing scoped reader");
    await (await reader("bytes=0-0", 1000)).body?.cancel();
    await (await reader("bytes=2-2", 1000)).body?.cancel();
    expect(mockPrefetchSecrets).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(2);
    for (const [requestUrl] of mockSsrfSafeFetch.mock.calls) {
      expect(requestUrl).toBe(
        "https://s3.example.test/clips/clips/rec-1/video.mp4",
      );
    }
  });

  it("forwards recording range cancellation to the storage request", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips",
      S3_ACCESS_KEY_ID: "fake-access",
      S3_SECRET_ACCESS_KEY: "fake-secret",
      S3_ENDPOINT: "https://s3.example.test",
    };
    mockResolveSecret.mockImplementation(
      async (key: string) => values[key] ?? null,
    );
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let upstreamSignal: AbortSignal | null | undefined;
    mockSsrfSafeFetch.mockImplementation((_url: string, init: RequestInit) => {
      upstreamSignal = init.signal;
      started();
      return new Promise((_resolve, reject) =>
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        ),
      );
    });
    const reader = await openS3Recording(
      "https://s3.example.test/clips/clips/rec-1/video.mp4",
      { recordingId: "rec-1", storageMode: "own" },
    );
    if (!reader) throw new Error("missing scoped reader");
    const controller = new AbortController();
    const request = reader("bytes=0-0", 5_000, controller.signal);
    const rejected = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await fetchStarted;
    controller.abort();
    await rejected;
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("does not start credential lookups after a stalled prefetch passes the deadline", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      mockPrefetchSecrets.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const request = openS3Recording(
        "https://s3.example.test/clips/clips/rec-1/video.mp4",
        {
          recordingId: "rec-1",
          storageMode: "own",
          deadline: Date.now() + 100,
        },
      );
      const rejected = expect(request).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(101);
      finish();
      await rejected;
      expect(mockResolveSecret).not.toHaveBeenCalled();
      expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for all deadline-bound credential lookups even when one fails", async () => {
    let finish!: () => void;
    const stalled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mockResolveSecret.mockImplementation(async (key: string) => {
      if (key === "S3_BUCKET") throw new Error("lookup failed");
      if (key === "S3_ACCESS_KEY_ID") await stalled;
      return null;
    });
    let settled = false;
    const request = openS3Recording(
      "https://s3.example.test/clips/clips/rec-1/video.mp4",
      {
        recordingId: "rec-1",
        storageMode: "own",
        deadline: Date.now() + 10_000,
      },
    );
    const result = request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    await result;
    await expect(request).rejects.toThrow("lookup failed");
  });

  it("prefetches the S3 and R2 request secrets before resolving them", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });

    await expect(s3FileUploadProvider.isConfiguredForRequest?.()).resolves.toBe(
      true,
    );

    expect(mockPrefetchSecrets).toHaveBeenCalledOnce();
    expect(mockPrefetchSecrets).toHaveBeenCalledWith([
      "S3_BUCKET",
      "R2_BUCKET",
      "S3_ACCESS_KEY_ID",
      "R2_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "R2_SECRET_ACCESS_KEY",
      "S3_ENDPOINT",
      "R2_ENDPOINT",
      "S3_REGION",
      "R2_REGION",
      "S3_PUBLIC_BASE_URL",
      "R2_PUBLIC_BASE_URL",
    ]);
    expect(mockPrefetchSecrets.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveSecret.mock.invocationCallOrder[0]!,
    );
  });

  it("never mixes a workspace's saved storage with the deployment's", async () => {
    const deployment: Record<string, string | undefined> = {
      S3_BUCKET: "deploy-bucket",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
      S3_ENDPOINT: "https://deploy-s3.example.com",
    };
    Object.assign(process.env, deployment);
    let saved: Record<string, string | undefined> = {};
    mockResolveSecret.mockImplementation(
      async (key: string) => saved[key] ?? deployment[key] ?? null,
    );
    mockSsrfSafeFetch.mockReset();
    const upload = () =>
      s3FileUploadProvider.upload({
        data: new Uint8Array([1]),
        filename: "recording.webm",
        mimeType: "video/webm",
      });

    // Only an endpoint saved: the deployment's keys must not go there.
    saved = { S3_ENDPOINT: "https://workspace-s3.example.com" };
    await expect(s3FileUploadProvider.isConfiguredForRequest?.()).resolves.toBe(
      false,
    );
    await expect(upload()).rejects.toThrow();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();

    // Nothing saved: the deployment's own settings, all together.
    saved = {};
    mockSsrfSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));
    await upload();
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://deploy-s3.example.com/deploy-bucket/"),
      expect.objectContaining({ method: "PUT" }),
      expect.anything(),
    );
  });

  it("fails instead of using env values a failed lookup fell back to", async () => {
    Object.assign(process.env, {
      S3_BUCKET: "deploy-bucket",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
      S3_ENDPOINT: "https://deploy-s3.example.com",
      S3_REGION: "auto",
      S3_PUBLIC_BASE_URL: "https://files.example.com",
    });
    // Every setting has an env value under both names, so no lookup comes
    // back empty.
    mockResolveSecret.mockImplementation(
      async (key: string) => process.env[key.replace(/^R2_/, "S3_")] ?? null,
    );
    lookupFailure = new Error("database unavailable");
    mockSsrfSafeFetch.mockReset();

    await expect(
      s3FileUploadProvider.upload({
        data: new Uint8Array([1]),
        filename: "recording.webm",
        mimeType: "video/webm",
      }),
    ).rejects.toBe(lookupFailure);
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
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

  it("claims only organization logo uploads", () => {
    const { handles } = clipsOrganizationLogoPrivateBlobProvider;
    if (!handles) throw new Error("The logo provider should filter puts");

    expect(
      handles({
        mimeType: "image/png",
        metadata: {
          organizationId: "org-1",
          purpose: "organization-brand-logo",
        },
      }),
    ).toBe(true);
    // App-activity captures are general private blobs, so the logo
    // provider must not take them even when S3 is configured.
    expect(
      handles({
        mimeType: "application/json",
        metadata: { purpose: "clips-app-activity", recordingId: "rec-1" },
      }),
    ).toBe(false);
    expect(handles({ mimeType: "image/png" })).toBe(false);
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

  it("never mixes a workspace's saved logo storage with the deployment's", async () => {
    Object.assign(process.env, {
      S3_BUCKET: "deploy-bucket",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
      S3_ENDPOINT: "https://deploy-s3.example.com",
    });
    let saved: Record<string, string | undefined> = {
      S3_ENDPOINT: "https://workspace-s3.example.com",
    };
    mockReadAppSecret.mockImplementation(
      async ({
        key,
        scope,
        scopeId,
      }: {
        key: string;
        scope: string;
        scopeId: string;
      }) => {
        const value = saved[key];
        return scope === "workspace" && scopeId === "org-1" && value
          ? { value }
          : null;
      },
    );
    const logo = () =>
      clipsOrganizationLogoPrivateBlobProvider.put({
        data: new TextEncoder().encode("logo-bytes"),
        mimeType: "image/png",
        metadata: {
          organizationId: "org-1",
          purpose: "organization-brand-logo",
        },
      });

    // Only an endpoint saved: the deployment's keys must not go there.
    await expect(
      clipsOrganizationLogoPrivateBlobProvider.isConfiguredForRequest?.(),
    ).resolves.toBe(false);
    await expect(logo()).rejects.toMatchObject({ statusCode: 503 });
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();

    // Nothing saved: the deployment's own settings, all together.
    saved = {};
    mockSsrfSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(logo()).resolves.toMatchObject({
      provider: "clips-s3-organization-logos",
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://deploy-s3.example.com/deploy-bucket/"),
      expect.objectContaining({ method: "PUT" }),
      expect.anything(),
    );
  });

  it("doesn't take unreadable logo settings for unsaved ones", async () => {
    Object.assign(process.env, {
      S3_BUCKET: "deploy-bucket",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
      S3_ENDPOINT: "https://deploy-s3.example.com",
    });
    // The workspace saved a bucket this process can't decrypt.
    mockReadAppSecret.mockImplementation(
      async ({ key, scope, scopeId }: Record<string, string>) => {
        if (
          key === "S3_BUCKET" &&
          scope === "workspace" &&
          scopeId === "org-1"
        ) {
          throw Object.assign(new Error("unreadable"), {
            errorCode: "app_secret_unreadable",
          });
        }
        return null;
      },
    );
    mockSsrfSafeFetch.mockReset();

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
      {
        followRedirects: false,
        requireDispatcher: true,
        allowedPrivateOrigins: [],
      },
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

  it("rejects workspace S3 endpoints that resolve to private addresses", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    const values: Record<string, string> = {
      S3_BUCKET: "current-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://10.0.0.12:9000/minio/",
      S3_REGION: "us-east-1",
    };
    mockReadAppSecret.mockImplementation(
      async ({ key, scope, scopeId }: Record<string, string>) => {
        if (scope !== "workspace" || scopeId !== "org-1") return null;
        return values[key] ? { value: values[key] } : null;
      },
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchS3OrganizationLogoByLegacyUrl(
        "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png",
        "org-1",
      ),
    ).rejects.toThrow(
      "SSRF blocked: refusing to fetch private/internal S3 endpoint",
    );

    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows private S3 endpoints explicitly configured for deployment", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    process.env.S3_BUCKET = "current-bucket";
    process.env.S3_ACCESS_KEY_ID = "access";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_ENDPOINT = "http://10.0.0.12:9000/minio/";
    process.env.S3_REGION = "us-east-1";
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchS3OrganizationLogoByLegacyUrl(
      "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png",
      "org-1",
    );

    expect(result?.status).toBe(404);
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://10.0.0.12:9000/minio/current-bucket/"),
      expect.objectContaining({ method: "GET" }),
      {
        followRedirects: false,
        requireDispatcher: true,
        allowedPrivateOrigins: ["http://10.0.0.12:9000"],
      },
    );
  });

  it("rejects workspace private endpoints outside the deployment endpoint path", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    process.env.S3_ENDPOINT = "https://10.0.0.12:9000/minio/";
    const workspaceValues: Record<string, string> = {
      S3_BUCKET: "workspace-bucket",
      S3_ACCESS_KEY_ID: "workspace-access",
      S3_SECRET_ACCESS_KEY: "workspace-secret",
      S3_ENDPOINT: "https://10.0.0.12:9000/other-service",
      S3_REGION: "us-east-1",
    };
    mockReadAppSecret.mockImplementation(
      async ({ key, scope, scopeId }: Record<string, string>) => {
        if (scope !== "workspace" || scopeId !== "org-1") return null;
        return workspaceValues[key] ? { value: workspaceValues[key] } : null;
      },
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchS3OrganizationLogoByLegacyUrl(
        "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png",
        "org-1",
      ),
    ).rejects.toThrow(
      "SSRF blocked: refusing to fetch private/internal S3 endpoint",
    );

    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses plain HTTP endpoints saved in workspace settings", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "http://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });

    await expect(
      s3FileUploadProvider.upload({
        data: new Uint8Array([1]),
        filename: "recording.webm",
        mimeType: "video/webm",
      }),
    ).rejects.toThrow("Storage endpoints saved in settings must use HTTPS");
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("lets the hosted bucket use the deployment's private HTTP endpoint", async () => {
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(true);
    hostedEndpoint = "http://10.0.0.20:9000";
    mockSsrfSafeFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const url = "http://10.0.0.20:9000/hosted-clips/clips/rec_1/clip.mp4";

    await expect(
      deleteS3ObjectByUrl(url, {
        storageMode: "hosted",
        recordingId: "rec_1",
      }),
    ).resolves.toBe(true);
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: "DELETE" }),
      expect.objectContaining({
        allowedPrivateOrigins: ["http://10.0.0.20:9000"],
      }),
    );
  });

  it("rejects bucket dot segments before using a trusted private endpoint", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "..",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "http://10.0.0.12:9000/minio/",
      S3_PUBLIC_BASE_URL: "https://clips.example.com/media",
    };
    // The deployment's own settings, so plain HTTP is allowed.
    Object.assign(process.env, values);
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });

    await expect(
      fetchS3ObjectByUrl(
        "https://clips.example.com/media/clips/recording/video.webm",
        { recordingId: "recording" },
      ),
    ).rejects.toThrow("S3 object path contains an unsafe URL path segment");

    expect(mockIsBlockedExtensionUrlWithDns).not.toHaveBeenCalled();
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
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

  it("requires hosted deletes to match the recording id in the object key", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    mockSsrfSafeFetch.mockImplementation((url: string, init: RequestInit) =>
      fetchMock(url, init),
    );
    const url =
      "https://hosted-s3.example.com/hosted-clips/clips/rec_1/clip.mp4";

    await expect(
      deleteS3ObjectByUrl(url, { storageMode: "hosted" }),
    ).resolves.toBe(false);
    await expect(
      deleteS3ObjectByUrl(url, {
        storageMode: "hosted",
        recordingId: "victim_1",
      }),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      deleteS3ObjectByUrl(url, {
        storageMode: "hosted",
        recordingId: "rec_1",
      }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each(["PUT", "DELETE"] as const)(
    "cancels successful %s response bodies that callers do not read",
    async (method) => {
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
      const cancelBody = vi.fn();
      mockSsrfSafeFetch.mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel: cancelBody }), {
          status: 200,
        }),
      );

      if (method === "PUT") {
        await s3FileUploadProvider.upload({
          data: new Uint8Array([1]),
          filename: "recording.webm",
          mimeType: "video/webm",
        });
      } else {
        await expect(
          deleteS3ObjectByUrl(
            "https://cdn.example.com/media/clips/recording/video.webm",
          ),
        ).resolves.toBe(true);
      }

      expect(cancelBody).toHaveBeenCalledOnce();
    },
  );

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

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://s3.example.com/clips-bucket/clips/recording.webm",
      expect.objectContaining({ method: "GET" }),
      {
        followRedirects: false,
        requireDispatcher: true,
        allowedPrivateOrigins: [],
      },
    );
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

  it("reads an object's stored size from a one-byte range, and reports a missing object as unknown", async () => {
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("m", {
          status: 206,
          headers: { "content-range": "bytes 0-0/4096" },
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://clips.example.com/api/storage/clips/recording.webm";

    await expect(
      s3ObjectSizeBytesByUrl(url, { recordingId: "recording" }),
    ).resolves.toBe(4096);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ range: "bytes=0-0" }),
    });
    await expect(
      s3ObjectSizeBytesByUrl(url, { recordingId: "recording" }),
    ).resolves.toBeNull();
  });

  it("fails closed when a public S3 request cannot create its dispatcher", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockSsrfSafeFetch.mockRejectedValueOnce(
      new Error(
        "SSRF protection is unavailable because the server dispatcher could not be loaded.",
      ),
    );

    await expect(
      fetchS3ObjectByUrl(
        "https://s3.example.com/clips-bucket/clips/recording/video.webm",
        { recordingId: "recording" },
      ),
    ).rejects.toThrow("SSRF protection is unavailable");

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://s3.example.com/clips-bucket/clips/recording/video.webm",
      expect.objectContaining({ method: "GET" }),
      {
        followRedirects: false,
        requireDispatcher: true,
        allowedPrivateOrigins: [],
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includes endpoint DNS validation in the S3 request timeout", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    mockIsBlockedExtensionUrlWithDns.mockReturnValueOnce(
      new Promise<boolean>(() => {}),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchS3ObjectByUrl(
        "https://s3.example.com/clips-bucket/clips/recording/video.webm",
        { recordingId: "recording", timeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });

    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start SSRF dispatch when DNS validation finishes after timeout", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    let resolveDns!: (blocked: boolean) => void;
    const dnsValidation = new Promise<boolean>((resolve) => {
      resolveDns = resolve;
    });
    mockIsBlockedExtensionUrlWithDns.mockReturnValueOnce(dnsValidation);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchS3ObjectByUrl(
      "https://s3.example.com/clips-bucket/clips/recording/video.webm",
      { recordingId: "recording", timeoutMs: 10 },
    );
    await expect(request).rejects.toMatchObject({ name: "TimeoutError" });

    resolveDns(false);
    await dnsValidation;
    await Promise.resolve();

    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the request timeout active while consuming the S3 response body", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const requestSignals: AbortSignal[] = [];
    mockSsrfSafeFetch.mockImplementation(
      async (_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        requestSignals.push(signal);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              signal.addEventListener(
                "abort",
                () => streamController.error(signal.reason),
                { once: true },
              );
            },
          }),
        );
      },
    );

    const response = await fetchS3ObjectByUrl(
      "https://s3.example.com/clips-bucket/clips/recording/video.webm",
      { recordingId: "recording", timeoutMs: 25 },
    );

    expect(response?.status).toBe(200);
    expect(requestSignals[0]?.aborted).toBe(false);
    await expect(response!.arrayBuffer()).rejects.toMatchObject({
      name: "TimeoutError",
      message: expect.stringContaining("S3 request timed out after 25ms"),
    });
    expect(requestSignals[0]?.aborted).toBe(true);
  });

  it("times out a successful S3 response body that callers never read", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const requestSignals: AbortSignal[] = [];
    mockSsrfSafeFetch.mockImplementation(
      async (_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        requestSignals.push(signal);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              signal.addEventListener(
                "abort",
                () => streamController.error(signal.reason),
                { once: true },
              );
            },
          }),
        );
      },
    );

    const response = await fetchS3ObjectByUrl(
      "https://s3.example.com/clips-bucket/clips/recording/video.webm",
      { recordingId: "recording", timeoutMs: 25 },
    );

    expect(response?.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(requestSignals[0]?.aborted).toBe(true);
    await expect(response!.arrayBuffer()).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("lets progressing S3 playback streams outlast the idle timeout", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const requestSignals: AbortSignal[] = [];
    mockSsrfSafeFetch.mockImplementation(
      async (_url: string, init: RequestInit) => {
        requestSignals.push(init.signal as AbortSignal);
        let chunk = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(streamController) {
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (chunk === 3) {
                streamController.close();
              } else {
                streamController.enqueue(new Uint8Array([chunk++]));
              }
            },
          }),
        );
      },
    );

    const startedAt = Date.now();
    const response = await fetchS3ObjectByUrl(
      "https://s3.example.com/clips-bucket/clips/recording/video.webm",
      { recordingId: "recording", timeoutMs: 25 },
    );

    await expect(response!.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0, 1, 2]).buffer,
    );
    expect(Date.now() - startedAt).toBeGreaterThan(25);
    expect(requestSignals[0]?.aborted).toBe(false);
  });

  it("aborts an S3 response body when playback stops pulling chunks", async () => {
    const values: Record<string, string> = {
      S3_BUCKET: "clips-bucket",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_ENDPOINT: "https://s3.example.com",
    };
    mockResolveSecret.mockImplementation(async (key: string) => {
      return values[key] ?? null;
    });
    const requestSignals: AbortSignal[] = [];
    mockSsrfSafeFetch.mockImplementation(
      async (_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        requestSignals.push(signal);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              streamController.enqueue(new Uint8Array([1]));
              signal.addEventListener(
                "abort",
                () => streamController.error(signal.reason),
                { once: true },
              );
            },
          }),
        );
      },
    );

    const response = await fetchS3ObjectByUrl(
      "https://s3.example.com/clips-bucket/clips/recording/video.webm",
      { recordingId: "recording", timeoutMs: 25 },
    );
    const reader = response!.body!.getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: new Uint8Array([1]),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(requestSignals[0]?.aborted).toBe(true);
    await expect(reader.read()).rejects.toMatchObject({
      name: "TimeoutError",
    });
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
    const fetchMock = vi.fn(async () => new Response(null));
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
    const fetchMock = vi.fn(async () => new Response(null));
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

    // The pending chunk was written once as its own object and read back once;
    // no staging object was downloaded and re-uploaded per chunk.
    const stagingCalls = (method: string) =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes(".multipart/") &&
          (init as RequestInit | undefined)?.method === method,
      );
    expect(stagingCalls("PUT")).toHaveLength(1);
    expect(stagingCalls("GET")).toHaveLength(1);
    const partBody = new Uint8Array(
      fetchMock.mock.calls.find(([url]) =>
        String(url).includes("partNumber=1&uploadId=upload-example"),
      )?.[1]?.body as ArrayBuffer,
    );
    expect(partBody.byteLength).toBe(
      firstChunk.byteLength + secondChunk.byteLength,
    );
    expect(partBody[0]).toBe(1);
    expect(partBody[partBody.byteLength - 1]).toBe(2);

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
      }),
    );
    expect(partCall?.[1]?.headers).not.toHaveProperty("Content-Length");
    const completeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("?uploadId=upload-example"),
    );
    expect(
      new TextDecoder().decode(completeCall?.[1]?.body as ArrayBuffer),
    ).toContain("<ETag>&quot;part-1-example&quot;</ETag>");
  });

  it("rebuilds the same part when a retried chunk follows a lost session write", async () => {
    const s3 = useFakeS3();
    const mib = 1024 * 1024;
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the S3 provider always defines resumable
    const resumable = s3FileUploadProvider.resumable!;
    let session = await resumable.startSession(
      "recording-retry.webm",
      "video/webm",
      20 * mib,
    );
    for (let i = 0; i < 4; i++) {
      const res = await resumable.relayChunk(
        session,
        `bytes ${i * mib}-${(i + 1) * mib - 1}/*`,
        new Uint8Array(mib).fill(i + 1),
      );
      session = { ...session, meta: { ...session.meta, ...res.updatedMeta } };
    }
    const fifth = new Uint8Array(mib).fill(5);
    const range = `bytes ${4 * mib}-${5 * mib - 1}/*`;
    const first = await resumable.relayChunk(session, range, fifth);
    // The session write for `first` is lost; the client retries the chunk.
    const retried = await resumable.relayChunk(session, range, fifth);
    expect(retried.updatedMeta).toEqual(first.updatedMeta);
    const parts = s3.fetch.mock.calls.filter(([url]) =>
      String(url).includes("partNumber=1&"),
    );
    expect(parts).toHaveLength(2);
    for (const [, init] of parts) {
      const body = new Uint8Array((init as RequestInit).body as ArrayBuffer);
      expect(body.byteLength).toBe(5 * mib);
      expect(body[0]).toBe(1);
      expect(body[5 * mib - 1]).toBe(5);
    }
  });

  it("finishes uploads that staged pending bytes in one bucket object before chunk staging", async () => {
    const s3 = useFakeS3();
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the S3 provider always defines resumable
    const resumable = s3FileUploadProvider.resumable!;
    let session = await resumable.startSession(
      "recording-legacy.webm",
      "video/webm",
      1024,
    );
    const legacyKey = "clips/.multipart/recording-legacy.webm.pending";
    s3.objects.set(legacyKey, new Uint8Array([7, 7, 7]));
    session = { ...session, meta: { ...session.meta, pendingBytes: 3 } };
    const next = await resumable.relayChunk(
      session,
      "bytes 3-4/*",
      new Uint8Array([8, 8]),
    );
    expect(next.updatedMeta).toEqual({ pendingBytes: 5 });
    session = { ...session, meta: { ...session.meta, ...next.updatedMeta } };
    const closed = await resumable.relayChunk(
      session,
      "bytes */5",
      new Uint8Array(0),
    );
    expect(closed.updatedMeta).toMatchObject({
      pendingBytes: 0,
      parts: [{ partNumber: 1, sizeBytes: 5 }],
    });
    session = { ...session, meta: { ...session.meta, ...closed.updatedMeta } };
    await resumable.completeSession(session, "recording-legacy.webm");
    expect([...(s3.objects.get("clips/recording-legacy.webm") ?? [])]).toEqual([
      7, 7, 7, 8, 8,
    ]);
    // Only the first chunk after deploy read the old staging object.
    expect(
      s3.fetch.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith(legacyKey) &&
          (init as RequestInit | undefined)?.method === "GET",
      ),
    ).toHaveLength(1);
    expect(s3.objects.has(legacyKey)).toBe(false);
  });

  describe("staged multipart chunks", () => {
    const mib = 1024 * 1024;
    const day = 24 * 60 * 60 * 1000;
    const stagingRows = async () => {
      const client = stagingDb.client;
      if (!client) throw new Error("staging test db not ready");
      const { rows } = await client.query(
        `SELECT * FROM multipart_staging_parts ORDER BY byte_offset`,
      );
      return rows as Record<string, unknown>[];
    };

    async function stageTwoChunks(filename: string) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the S3 provider always defines resumable
      const resumable = s3FileUploadProvider.resumable!;
      let session = await resumable.startSession(
        filename,
        "video/webm",
        20 * mib,
      );
      for (let i = 0; i < 2; i++) {
        const res = await resumable.relayChunk(
          session,
          `bytes ${i * mib}-${(i + 1) * mib - 1}/*`,
          new Uint8Array(mib).fill(i + 1),
        );
        session = { ...session, meta: { ...session.meta, ...res.updatedMeta } };
      }
      return { resumable, session };
    }

    it("writes chunk bytes to storage and keeps only references in SQL", async () => {
      const s3 = useFakeS3();
      const { session } = await stageTwoChunks("recording-refs.webm");
      expect(session.meta.pendingBytes).toBe(2 * mib);

      const rows = await stagingRows();
      expect(rows).toHaveLength(2);
      for (const [i, row] of rows.entries()) {
        expect(Object.keys(row).sort()).toEqual([
          "byte_length",
          "byte_offset",
          "created_at",
          "object_key",
          "staging_key",
          "storage_fingerprint",
          "target_key",
          "updated_at",
          "upload_id",
        ]);
        expect(Number(row.byte_offset)).toBe(i * mib);
        expect(row.byte_length).toBe(mib);
        expect(row.upload_id).toBe(session.sessionId);
        expect(String(row.object_key)).toMatch(
          /^clips\/\.multipart\/recording-refs\.webm\.pending\//,
        );
        // No column holds anything near a chunk's size.
        for (const value of Object.values(row)) {
          expect(String(value).length).toBeLessThan(200);
        }
        const stored = s3.objects.get(String(row.object_key));
        expect(stored?.byteLength).toBe(mib);
        expect(stored?.[0]).toBe(i + 1);
      }
    });

    it("keeps a paused upload's chunks past three days while its session can resume, then completes it", async () => {
      const s3 = useFakeS3();
      const staged = await stageTwoChunks("recording-paused.webm");
      let session = staged.session;
      const { resumable } = staged;

      // The recorder pauses; the sweep runs well after the old 3-day window.
      const swept = await sweepS3MultipartStaging("own", Date.now() + 4 * day);
      expect(swept).toEqual({ checked: 1, cleared: 0 });
      expect(await stagingRows()).toHaveLength(2);

      // Resume: the next chunks fill a part with the bytes staged before.
      for (let i = 2; i < 5; i++) {
        const res = await resumable.relayChunk(
          session,
          `bytes ${i * mib}-${(i + 1) * mib - 1}/*`,
          new Uint8Array(mib).fill(i + 1),
        );
        session = { ...session, meta: { ...session.meta, ...res.updatedMeta } };
      }
      const tail = await resumable.relayChunk(
        session,
        `bytes ${5 * mib}-${5 * mib + 9}/${5 * mib + 10}`,
        new Uint8Array(10).fill(6),
      );
      session = { ...session, meta: { ...session.meta, ...tail.updatedMeta } };
      await expect(
        resumable.completeSession(session, "recording-paused.webm"),
      ).resolves.toMatch(/clips\/recording-paused\.webm$/);

      const video = s3.objects.get("clips/recording-paused.webm");
      expect(video?.byteLength).toBe(5 * mib + 10);
      for (let i = 0; i < 5; i++) expect(video?.[i * mib]).toBe(i + 1);
      expect(video?.[5 * mib + 9]).toBe(6);
      // Completion leaves no staged chunks behind.
      expect(await stagingRows()).toEqual([]);
      expect(
        [...s3.objects.keys()].filter((k) => k.includes(".multipart/")),
      ).toEqual([]);
    });

    it("deletes an expired session's chunks from storage and their references from SQL", async () => {
      const s3 = useFakeS3();
      const live = await stageTwoChunks("recording-live.webm");
      const expired = await stageTwoChunks("recording-expired.webm");
      // A bucket lifecycle rule expires the second multipart upload.
      s3.uploads.delete(expired.session.sessionId);

      // A recently touched upload is not even probed.
      expect(await sweepS3MultipartStaging("own")).toEqual({
        checked: 0,
        cleared: 0,
      });

      const swept = await sweepS3MultipartStaging(
        "own",
        Date.now() + 2 * 60 * 60 * 1000,
      );
      expect(swept).toEqual({ checked: 2, cleared: 1 });
      const rows = await stagingRows();
      expect(rows.map((row) => row.upload_id)).toEqual([
        live.session.sessionId,
        live.session.sessionId,
      ]);
      const stagedKeys = [...s3.objects.keys()].filter((k) =>
        k.includes(".multipart/"),
      );
      expect(stagedKeys).toHaveLength(2);
      expect(stagedKeys.every((k) => k.includes("recording-live.webm"))).toBe(
        true,
      );
    });

    it("drops an aborted session's chunks with the session", async () => {
      const s3 = useFakeS3();
      const { resumable, session } = await stageTwoChunks(
        "recording-abort.webm",
      );
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the S3 provider always defines abortSession
      await resumable.abortSession!(session);
      expect(await stagingRows()).toEqual([]);
      expect(
        [...s3.objects.keys()].filter((k) => k.includes(".multipart/")),
      ).toEqual([]);
    });
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

  describe("abortSession after the session was already consumed", () => {
    async function abortWithHead(headStatus: number) {
      const values: Record<string, string> = {
        S3_BUCKET: "clips-bucket",
        S3_ACCESS_KEY_ID: "access",
        S3_SECRET_ACCESS_KEY: "secret",
        S3_ENDPOINT: "https://s3.example.com",
      };
      mockResolveSecret.mockImplementation(async (key: string) => {
        return values[key] ?? null;
      });
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE" && url.includes("uploadId=")) {
          return new Response("<Error><Code>NoSuchUpload</Code></Error>", {
            status: 404,
          });
        }
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: headStatus,
            headers: { "content-length": "3" },
          });
        }
        return new Response(null, { status: 204 });
      });
      vi.stubGlobal("fetch", fetchMock);
      await s3FileUploadProvider.resumable!.abortSession!({
        sessionId: "upload-example",
        meta: {
          objectKey: "clips/recording.webm",
          stagingKey: "clips/.multipart/recording.webm.pending",
          mimeType: "video/webm",
          maxBytes: 1024,
          pendingBytes: 0,
          parts: [{ partNumber: 1, etag: '"e"', sizeBytes: 3 }],
        },
      });
      return fetchMock;
    }
    const objectDeletes = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          (init as RequestInit)?.method === "DELETE" &&
          String(url).endsWith("/clips/recording.webm"),
      );

    it("deletes the completed object that the 404 hid", async () => {
      expect(objectDeletes(await abortWithHead(200))).toHaveLength(1);
    });

    it("leaves the object key alone when nothing was completed", async () => {
      expect(objectDeletes(await abortWithHead(404))).toHaveLength(0);
    });
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
    await expect(
      resumable.completeSession(session, "recording.webm"),
    ).resolves.toBe("https://cdn.example.com/media/clips/recording.webm");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3.example.com/clips-bucket/clips/recording.webm",
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("reconciles a multipart completion whose response body is lost", async () => {
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
    let headStatus = 200;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("uploadId=upload-example")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("socket reset"));
            },
          }),
        );
      }
      if (init?.method === "HEAD" && url.endsWith("/clips/recording.webm")) {
        return new Response(null, {
          status: headStatus,
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

    headStatus = 404;
    await expect(
      resumable.completeSession(session, "recording.webm"),
    ).rejects.toThrow(/CompleteMultipartUpload failed.*socket reset/);
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
