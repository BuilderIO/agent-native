import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import type { PrivateBlobHandle } from "./types.js";

const resolveSecretDetailedMock = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackMock = vi.hoisted(() => vi.fn());
const readAppSecretsMock = vi.hoisted(() => vi.fn());
const s3FetchMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  resolveSecretDetailed: resolveSecretDetailedMock,
  canUseDeployCredentialFallbackForRequest: canUseDeployCredentialFallbackMock,
}));
vi.mock("../secrets/storage.js", () => ({
  readAppSecrets: readAppSecretsMock,
}));
vi.mock("../extensions/url-safety.js", () => ({
  isBlockedExtensionUrlWithDns: vi.fn(async () => false),
  ssrfSafeFetch: s3FetchMock,
}));

const ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_PUBLIC_BASE_URL",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_REGION",
  "R2_PUBLIC_BASE_URL",
];
const originalEnv = { ...process.env };

/** An in-memory S3 bucket keyed by request path. */
function fakeBucket() {
  const objects = new Map<string, { body: Uint8Array; type: string }>();
  const requests: Array<{ method: string; url: string; headers: Headers }> = [];
  s3FetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    requests.push({ method, url, headers });
    const path = new URL(url).pathname;
    if (method === "PUT") {
      objects.set(path, {
        body: new Uint8Array(init.body as ArrayBuffer),
        type: headers.get("content-type") ?? "",
      });
      return new Response(null, { status: 200 });
    }
    const object = objects.get(path);
    if (method === "DELETE") {
      objects.delete(path);
      return new Response(null, { status: object ? 204 : 404 });
    }
    if (!object) return new Response("NoSuchKey", { status: 404 });
    const range = headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return new Response(object.body, { status: 200 });
    const size = object.body.byteLength;
    const start = Number(range[1]);
    if (start >= size) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    }
    const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
    return new Response(object.body.slice(start, end + 1), {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${size}` },
    });
  });
  return { objects, requests };
}

function useEnvBucket(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    S3_ENDPOINT: "https://acct.r2.example.test",
    S3_BUCKET: "env-bucket",
    S3_ACCESS_KEY_ID: "env-access",
    S3_SECRET_ACCESS_KEY: "env-secret",
    ...extra,
  });
  resolveSecretDetailedMock.mockImplementation(async (key: string) =>
    process.env[key]
      ? { value: process.env[key], lookupFailed: false, source: "env" }
      : { value: null, lookupFailed: false },
  );
}

const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe("S3 private blob providers", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, SECRETS_ENCRYPTION_KEY: "s3-private-test" };
    for (const key of ENV_KEYS) delete process.env[key];
    resetAppConfigForTests();
    resolveSecretDetailedMock.mockReset();
    resolveSecretDetailedMock.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    canUseDeployCredentialFallbackMock.mockReset();
    canUseDeployCredentialFallbackMock.mockReturnValue(true);
    readAppSecretsMock.mockReset();
    readAppSecretsMock.mockResolvedValue(new Map());
    s3FetchMock.mockReset();
  });

  afterEach(async () => {
    const registry = await import("./registry.js");
    for (const provider of registry.listPrivateBlobProviders()) {
      registry.unregisterPrivateBlobProvider(provider.id);
    }
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("stores blobs in the workspace bucket behind an opaque handle", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    const { objects } = fakeBucket();
    useEnvBucket();

    expect(s3PrivateBlobProvider.isConfigured()).toBe(true);
    const handle = await s3PrivateBlobProvider.put({
      data: new TextEncoder().encode("dashboard screenshot"),
      mimeType: "image/png",
    });

    expect(handle).toMatchObject({
      provider: "s3-private",
      opaque: true,
      encrypted: false,
      mimeType: "image/png",
      size: 20,
    });
    expect(handle.id).toMatch(/^s3:v1:/);
    expect(handle.id).not.toContain("env-bucket");
    expect(handle.id).not.toContain("private-blobs");
    const [[path, stored]] = [...objects.entries()];
    expect(path).toMatch(/^\/env-bucket\/private-blobs\/[0-9a-f-]{36}$/);
    expect(stored).toEqual({
      body: new TextEncoder().encode("dashboard screenshot"),
      type: "image/png",
    });

    const read = await s3PrivateBlobProvider.read(handle);
    expect(text(read.data)).toBe("dashboard screenshot");
  });

  it("reads ranges natively and reports ranges past the end", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    const { PrivateBlobRangeError } = await import("./errors.js");
    const { requests } = fakeBucket();
    useEnvBucket();
    const handle = await s3PrivateBlobProvider.put({
      data: new TextEncoder().encode("0123456789"),
    });

    const part = await s3PrivateBlobProvider.readRange!(handle, {
      start: 2,
      end: 5,
    });
    expect(text(part.data)).toBe("2345");
    expect(part.range).toEqual({ start: 2, end: 5, size: 10 });
    expect(requests.at(-1)?.headers.get("range")).toBe("bytes=2-5");

    const error = await s3PrivateBlobProvider.readRange!(handle, {
      start: 10,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrivateBlobRangeError);
    expect(error).toMatchObject({ size: 10 });
  });

  it("signs expiring read links for buckets without a public URL", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    fakeBucket();
    useEnvBucket();
    const handle = await s3PrivateBlobProvider.put({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });

    const link = await s3PrivateBlobProvider.getReadUrl!(handle, {
      expiresInSeconds: 300,
      contentDisposition: "inline",
    });
    const url = new URL(link!.url);
    expect(url.origin).toBe("https://acct.r2.example.test");
    expect(url.pathname).toMatch(/^\/env-bucket\/private-blobs\//);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-type")).toBe("image/png");
    expect(url.searchParams.get("response-cache-control")).toBe(
      "private, max-age=300",
    );
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(link!.expiresAt) - Date.now()).toBeGreaterThan(290_000);
  });

  it("encrypts blobs and withholds read links when the bucket has a public URL", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    const { objects } = fakeBucket();
    useEnvBucket({ S3_PUBLIC_BASE_URL: "https://files.example.test" });

    const handle = await s3PrivateBlobProvider.put({
      data: new TextEncoder().encode("internal dashboard"),
      mimeType: "image/png",
    });

    expect(handle.encrypted).toBe(true);
    const [stored] = [...objects.values()];
    expect(stored.type).toBe("application/octet-stream");
    expect(text(stored.body)).not.toContain("internal dashboard");
    expect(text((await s3PrivateBlobProvider.read(handle)).data)).toBe(
      "internal dashboard",
    );
    const part = await s3PrivateBlobProvider.readRange!(handle, {
      start: 9,
    });
    expect(text(part.data)).toBe("dashboard");
    await expect(
      s3PrivateBlobProvider.getReadUrl!(handle, { expiresInSeconds: 60 }),
    ).resolves.toBeNull();
  });

  it("reads a workspace bucket blob without the uploader's request", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    const { objects } = fakeBucket();
    const orgSecrets = new Map(
      Object.entries({
        S3_ENDPOINT: "https://org.storage.example.test",
        S3_BUCKET: "org-bucket",
        S3_ACCESS_KEY_ID: "org-access",
        S3_SECRET_ACCESS_KEY: "org-secret",
        S3_REGION: "us-east-2",
      }).map(([key, value]) => [key, { value }]),
    );
    readAppSecretsMock.mockImplementation(
      async (args: { scope: string; scopeId: string }) =>
        args.scope === "org" && args.scopeId === "org-1"
          ? orgSecrets
          : new Map(),
    );
    resolveSecretDetailedMock.mockResolvedValue({
      value: "org-bucket",
      lookupFailed: false,
      source: "org",
      scopeId: "org-1",
    });
    const handle = await s3PrivateBlobProvider.put({
      data: new TextEncoder().encode("org image"),
    });
    expect([...objects.keys()][0]).toMatch(/^\/org-bucket\//);

    // An anonymous reader of a public page resolves no credentials itself.
    resolveSecretDetailedMock.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    expect(text((await s3PrivateBlobProvider.read(handle)).data)).toBe(
      "org image",
    );
    expect(readAppSecretsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "org", scopeId: "org-1" }),
    );
  });

  it("rejects handles that weren't issued by this deployment", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    fakeBucket();
    useEnvBucket();
    const forged: PrivateBlobHandle = {
      id: `s3:v1:${Buffer.from(
        JSON.stringify({ key: "private-blobs/other" }),
      ).toString("base64")}`,
      provider: "s3-private",
      opaque: true,
      encrypted: false,
    };

    await expect(s3PrivateBlobProvider.read(forged)).rejects.toMatchObject({
      kind: "corrupt",
    });
    await expect(
      s3PrivateBlobProvider.read({ ...forged, id: "private-blobs/other" }),
    ).rejects.toMatchObject({ kind: "corrupt" });
  });

  it("treats a missing object as already deleted", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    const { objects } = fakeBucket();
    useEnvBucket();
    const handle = await s3PrivateBlobProvider.put({
      data: new Uint8Array([1]),
    });

    await expect(s3PrivateBlobProvider.delete(handle)).resolves.toEqual({
      deleted: true,
      provider: "s3-private",
    });
    expect(objects.size).toBe(0);
    await expect(s3PrivateBlobProvider.delete(handle)).resolves.toMatchObject({
      deleted: true,
    });
    await expect(s3PrivateBlobProvider.read(handle)).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("doesn't use the deployment's bucket when this request may not", async () => {
    const { s3PrivateBlobProvider } = await import("./s3-private.js");
    useEnvBucket();
    canUseDeployCredentialFallbackMock.mockReturnValue(false);

    expect(s3PrivateBlobProvider.isConfigured()).toBe(false);
  });

  it("stores in the hosted bucket while enabled and still reads after it's off", async () => {
    const { hostedPrivateBlobProvider } = await import("./s3-private.js");
    const { objects } = fakeBucket();
    expect(hostedPrivateBlobProvider.isConfigured()).toBe(false);

    const hostedStorage = {
      endpoint: "https://hosted.example.test",
      bucket: "hosted-private",
      accessKeyId: "hosted-access",
      secretAccessKey: "hosted-secret",
      region: "auto",
    };
    defineAppConfig({ hostedStorage: { enabled: true, ...hostedStorage } });
    expect(hostedPrivateBlobProvider.isConfigured()).toBe(true);
    const handle = await hostedPrivateBlobProvider.put({
      data: new TextEncoder().encode("hosted image"),
    });
    expect(handle.provider).toBe("hosted-private");
    expect([...objects.keys()][0]).toMatch(/^\/hosted-private\//);

    resetAppConfigForTests();
    defineAppConfig({ hostedStorage: { enabled: false, ...hostedStorage } });
    expect(hostedPrivateBlobProvider.isConfigured()).toBe(false);
    expect(text((await hostedPrivateBlobProvider.read(handle)).data)).toBe(
      "hosted image",
    );
  });

  it("registers the workspace bucket ahead of the hosted bucket, once", async () => {
    const { ensureS3PrivateBlobProviders } = await import("./s3-private.js");
    const registry = await import("./registry.js");

    ensureS3PrivateBlobProviders();
    ensureS3PrivateBlobProviders();

    expect(registry.listPrivateBlobProviders().map((p) => p.id)).toEqual([
      "s3-private",
      "hosted-private",
    ]);
  });
});
