import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveSecretDetailedMock = vi.hoisted(() => vi.fn());
const prefetchSecretsMock = vi.hoisted(() => vi.fn());
const isBlockedUrlMock = vi.hoisted(() => vi.fn());
const ssrfSafeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  // Core's throws only for outages and undecryptable secrets.
  assertCredentialStoreReadable: (result: { lookupFailed: boolean }) => {
    if (result.lookupFailed) throw new Error("credential store unavailable");
  },
  prefetchSecrets: (...args: unknown[]) => prefetchSecretsMock(...args),
  readDeployCredentialEnv: (key: string) => process.env[key] || undefined,
  resolveSecret: async (key: string) =>
    (await resolveSecretDetailedMock(key)).value,
  resolveSecretDetailed: (...args: unknown[]) =>
    resolveSecretDetailedMock(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  isBlockedExtensionUrlWithDns: isBlockedUrlMock,
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import {
  listFileUploadProviders,
  registerFileUploadProvider,
  unregisterFileUploadProvider,
} from "./registry.js";
import { ensureS3FileUploadProvider, s3FileUploadProvider } from "./s3.js";
import type { FileUploadProvider } from "./types.js";

type Place = { source: "env" } | { source: "workspace"; scopeId: string };
const workspace: Place = { source: "workspace", scopeId: "org-1" };

/** Settings saved in one place; other keys are unset. */
function useSecrets(secrets: Record<string, string>, place: Place = workspace) {
  resolveSecretDetailedMock.mockImplementation(async (key: string) =>
    secrets[key]
      ? { value: secrets[key], lookupFailed: false, ...place }
      : { value: null, lookupFailed: false },
  );
}

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
      "R2_ENDPOINT",
      "R2_BUCKET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_REGION",
      "R2_PUBLIC_BASE_URL",
    ]) {
      delete process.env[key];
    }
    resolveSecretDetailedMock.mockReset();
    resolveSecretDetailedMock.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    prefetchSecretsMock.mockReset();
    prefetchSecretsMock.mockResolvedValue(undefined);
    isBlockedUrlMock.mockReset();
    isBlockedUrlMock.mockResolvedValue(false);
    ssrfSafeFetchMock.mockReset();
    ssrfSafeFetchMock.mockImplementation((url: string, init: RequestInit) =>
      fetch(url, init),
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("batches every storage key into one prefetch before resolving them", async () => {
    const order: string[] = [];
    prefetchSecretsMock.mockImplementation(async () => {
      order.push("prefetch");
    });
    resolveSecretDetailedMock.mockImplementation(async (key: string) => {
      order.push(key);
      return { value: null, lookupFailed: false };
    });

    await s3FileUploadProvider.isConfiguredForRequest?.();

    expect(prefetchSecretsMock).toHaveBeenCalledTimes(1);
    const [prefetched] = prefetchSecretsMock.mock.calls[0] as [string[]];
    const resolved = order.slice(1);
    expect(order[0]).toBe("prefetch");
    expect(new Set(prefetched)).toEqual(new Set(resolved));
    expect(resolved).toHaveLength(12);
  });

  it("fails instead of using env values a failed lookup fell back to", async () => {
    Object.assign(process.env, {
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "deploy-bucket",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
      S3_REGION: "auto",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com",
    });
    // A self-hosted runtime answers a failed lookup with the env value, here
    // under both the S3_ and R2_ names of every setting.
    resolveSecretDetailedMock.mockImplementation(async (key: string) => ({
      value: process.env[key.replace(/^R2_/, "S3_")],
      lookupFailed: true,
      cause: new Error("database unavailable"),
      source: "env",
    }));

    await expect(
      s3FileUploadProvider.upload({
        data: new Uint8Array([1]),
        filename: "hero.png",
        mimeType: "image/png",
      }),
    ).rejects.toThrow("credential store unavailable");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
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
    useSecrets(secrets);
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
    expect(result.id).toMatch(/^uploads\/\d+-[a-z0-9]+-hero_image\.png$/);
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

    await expect(
      s3FileUploadProvider.delete!({ url: result.url, id: result.id }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] ?? [];
    expect(deleteUrl).toContain(`/uploads-example/${result.id}`);
    expect(deleteInit).toMatchObject({
      method: "DELETE",
      headers: expect.objectContaining({
        Authorization: expect.stringContaining("Credential=access-example/"),
      }),
    });
  });

  it("treats a missing S3 object as already deleted", async () => {
    const secrets: Record<string, string> = {
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "uploads-example",
      S3_ACCESS_KEY_ID: "access-example",
      S3_SECRET_ACCESS_KEY: "secret-example",
      S3_REGION: "us-east-1",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/assets",
    };
    useSecrets(secrets);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      })),
    );

    await expect(
      s3FileUploadProvider.delete!({
        url: "https://cdn.example.com/assets/uploads/missing.mp4",
        id: "uploads/missing.mp4",
      }),
    ).resolves.toBe(true);
  });

  it("never mixes a workspace's saved storage with the deployment's", async () => {
    const deployment: Record<string, string> = {
      S3_ENDPOINT: "https://deploy-s3.example.com",
      S3_BUCKET: "deploy-bucket",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
      S3_PUBLIC_BASE_URL: "https://cdn.deploy.example.com",
    };
    Object.assign(process.env, deployment);
    // A saved key resolves from the workspace; the rest fall back to env.
    let saved: Record<string, string> = {};
    resolveSecretDetailedMock.mockImplementation(async (key: string) =>
      saved[key]
        ? { value: saved[key], lookupFailed: false, ...workspace }
        : deployment[key]
          ? { value: deployment[key], lookupFailed: false, source: "env" }
          : { value: null, lookupFailed: false },
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const upload = async () => {
      fetchMock.mockClear();
      const result = await s3FileUploadProvider.upload({
        data: new Uint8Array([1]),
        filename: "a.png",
        mimeType: "image/png",
      });
      const [url, init] = (fetchMock.mock.calls[0] ?? []) as unknown as [
        string,
        { headers: Record<string, string> },
      ];
      return { result, url, auth: init.headers.Authorization };
    };

    // Only an endpoint saved, or a bucket and endpoint without keys: the
    // deployment's keys stay on the deployment's endpoint.
    for (const partial of [
      { S3_ENDPOINT: "https://workspace-s3.example.com" },
      {
        S3_BUCKET: "workspace-bucket",
        S3_ENDPOINT: "https://workspace-s3.example.com",
      },
    ]) {
      saved = partial;
      const { result, url, auth } = await upload();
      expect(url).toMatch(
        /^https:\/\/deploy-s3\.example\.com\/deploy-bucket\//,
      );
      expect(auth).toContain("Credential=deploy-access/");
      expect(result.url).toMatch(/^https:\/\/cdn\.deploy\.example\.com\//);
    }

    // A complete saved set is used as a whole.
    saved = {
      S3_ENDPOINT: "https://workspace-s3.example.com",
      S3_BUCKET: "workspace-bucket",
      S3_ACCESS_KEY_ID: "workspace-access",
      S3_SECRET_ACCESS_KEY: "workspace-secret",
      S3_PUBLIC_BASE_URL: "https://cdn.workspace.example.com",
    };
    const { result, url, auth } = await upload();
    expect(url).toMatch(
      /^https:\/\/workspace-s3\.example\.com\/workspace-bucket\//,
    );
    expect(auth).toContain("Credential=workspace-access/");
    expect(result.url).toMatch(/^https:\/\/cdn\.workspace\.example\.com\//);
  });

  it("uploads through environment-backed storage when scoped secrets are absent", async () => {
    Object.assign(process.env, {
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "uploads-example",
      S3_ACCESS_KEY_ID: "access-example",
      S3_SECRET_ACCESS_KEY: "secret-example",
      S3_REGION: "us-east-1",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/assets",
    });
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
    await expect(
      s3FileUploadProvider.upload({
        data: new Uint8Array([1, 2, 3]),
        filename: "env-backed.txt",
        mimeType: "text/plain",
      }),
    ).resolves.toMatchObject({ provider: "s3" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("s3FileUploadProvider endpoint safety", () => {
  const originalEnv = { ...process.env };
  const bucket = {
    S3_BUCKET: "uploads-example",
    S3_ACCESS_KEY_ID: "access-example",
    S3_SECRET_ACCESS_KEY: "secret-example",
    S3_REGION: "us-east-1",
    S3_PUBLIC_BASE_URL: "https://cdn.example.com/assets",
  };
  const upload = () =>
    s3FileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "a.png",
      mimeType: "image/png",
    });

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const prefix of ["S3", "R2"]) {
      for (const field of [
        "ENDPOINT",
        "BUCKET",
        "ACCESS_KEY_ID",
        "SECRET_ACCESS_KEY",
        "REGION",
        "PUBLIC_BASE_URL",
      ]) {
        delete process.env[`${prefix}_${field}`];
      }
    }
    resolveSecretDetailedMock.mockReset();
    resolveSecretDetailedMock.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    prefetchSecretsMock.mockReset();
    prefetchSecretsMock.mockResolvedValue(undefined);
    isBlockedUrlMock.mockReset();
    isBlockedUrlMock.mockResolvedValue(true);
    ssrfSafeFetchMock.mockReset();
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("refuses a private-network endpoint saved in workspace settings", async () => {
    const secrets: Record<string, string> = {
      ...bucket,
      S3_ENDPOINT: "https://10.0.0.5:9000",
    };
    useSecrets(secrets);

    await expect(upload()).rejects.toThrow(/SSRF blocked/);
    await expect(
      s3FileUploadProvider.delete!({
        url: "https://cdn.example.com/assets/uploads/a.png",
        id: "uploads/a.png",
      }),
    ).rejects.toThrow(/SSRF blocked/);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("refuses a plain HTTP endpoint saved in workspace settings", async () => {
    isBlockedUrlMock.mockResolvedValue(false);
    const secrets: Record<string, string> = {
      ...bucket,
      S3_ENDPOINT: "http://s3.example.com",
    };
    useSecrets(secrets);

    await expect(upload()).rejects.toThrow(/must use HTTPS/);
    await expect(
      s3FileUploadProvider.delete!({
        url: "https://cdn.example.com/assets/uploads/a.png",
        id: "uploads/a.png",
      }),
    ).rejects.toThrow(/must use HTTPS/);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("allows the deployment's own private-network endpoint", async () => {
    Object.assign(process.env, {
      ...bucket,
      S3_ENDPOINT: "http://minio.internal:9000",
    });

    await expect(upload()).resolves.toMatchObject({ provider: "s3" });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^http:\/\/minio\.internal:9000\/uploads-example\//,
      ),
      expect.objectContaining({ method: "PUT" }),
      expect.objectContaining({
        followRedirects: false,
        allowedPrivateOrigins: ["http://minio.internal:9000"],
      }),
    );
  });
});

describe("ensureS3FileUploadProvider", () => {
  afterEach(() => {
    unregisterFileUploadProvider("s3");
  });

  it("claims the slot when it is free", () => {
    ensureS3FileUploadProvider();
    expect(listFileUploadProviders()).toContain(s3FileUploadProvider);
  });

  it("is idempotent", () => {
    ensureS3FileUploadProvider();
    ensureS3FileUploadProvider();
    expect(
      listFileUploadProviders().filter((provider) => provider.id === "s3"),
    ).toHaveLength(1);
  });

  it("leaves an app's own provider in the slot", () => {
    const appProvider: FileUploadProvider = {
      id: "s3",
      name: "App storage",
      isConfigured: () => true,
      upload: async () => ({
        url: "https://app.example.com/a",
        provider: "s3",
      }),
    };
    registerFileUploadProvider(appProvider);
    ensureS3FileUploadProvider();
    expect(listFileUploadProviders()).toStrictEqual([appProvider]);
  });
});
