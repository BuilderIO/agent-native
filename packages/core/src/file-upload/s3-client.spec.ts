import { afterEach, describe, expect, it, vi } from "vitest";

const { isBlockedMock, ssrfSafeFetchMock } = vi.hoisted(() => ({
  isBlockedMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("../extensions/url-safety.js", () => ({
  isBlockedExtensionUrlWithDns: isBlockedMock,
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

// The public entry point, which Clips imports the signer from.
import {
  fetchS3WithTimeout,
  presignS3GetUrl,
  readS3ErrorText,
  s3ObjectUri,
  signedS3Request,
  signS3Request,
} from "./index.js";

// The expected signatures were produced independently by the aws4 package
// (mhart/aws4) for the same requests.
const credentials = {
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
};
const now = new Date("2026-10-21T12:34:56.789Z");
const r2 = {
  ...credentials,
  endpoint: "https://acct123.r2.cloudflarestorage.com",
  bucket: "an-private",
  region: "auto",
};

describe("presignS3GetUrl", () => {
  it("signs a path-style link with response overrides", async () => {
    const url = await presignS3GetUrl(r2, "private-blobs/a b+c.png", {
      expiresInSeconds: 300,
      responseContentType: "image/png",
      responseCacheControl: "private, max-age=300",
      now,
    });

    expect(url).toBe(
      "https://acct123.r2.cloudflarestorage.com/an-private/private-blobs/a%20b%2Bc.png" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=test-access-key-id%2F20261021%2Fauto%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20261021T123456Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host" +
        "&response-cache-control=private%2C%20max-age%3D300" +
        "&response-content-type=image%2Fpng" +
        "&X-Amz-Signature=d8437bcbbf9a57c58e4d74a0b38aae06509843c45c10185b913ac6780da5c342",
    );
  });

  it("only signs links for HTTPS endpoints", async () => {
    await expect(
      presignS3GetUrl(
        { ...r2, endpoint: "http://minio.example.test:9000" },
        "a.png",
        { expiresInSeconds: 60, now },
      ),
    ).rejects.toThrow(/need an HTTPS endpoint/);
  });

  it("only signs links that last between one second and seven days", async () => {
    for (const expiresInSeconds of [0, 604_801, Number.NaN]) {
      await expect(
        presignS3GetUrl(r2, "a.png", { expiresInSeconds, now }),
      ).rejects.toThrow(/expire after 1 to 604800 seconds/);
    }
    await expect(
      presignS3GetUrl(r2, "a.png", { expiresInSeconds: 604_800, now }),
    ).resolves.toContain("X-Amz-Expires=604800");
  });
});

describe("signS3Request", () => {
  it("signs under an endpoint's base path", async () => {
    const signed = await signS3Request(
      {
        ...credentials,
        endpoint: "https://proj.supabase.co/storage/v1/s3",
        bucket: "files",
        region: "us-west-2",
      },
      "private-blobs/one.png",
      {
        method: "PUT",
        body: new TextEncoder().encode("hello world"),
        contentType: "image/png",
        now,
      },
    );

    expect(signed.url).toBe(
      "https://proj.supabase.co/storage/v1/s3/files/private-blobs/one.png",
    );
    expect(signed.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=test-access-key-id/20261021/us-west-2/s3/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, " +
        "Signature=8ecd74defef544a1e6328978e9b8a6e5e6f0fa844bf65103bc58d796ec19802c",
    );
  });

  it("signs a range header", async () => {
    const signed = await signS3Request(r2, "private-blobs/one.png", {
      method: "GET",
      range: "bytes=10-99",
      now,
    });

    expect(signed.headers.range).toBe("bytes=10-99");
    expect(signed.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=test-access-key-id/20261021/auto/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=566abe7d99165106caa103fde9a9d8014fde9b090140530eb6469b391c73c0ea",
    );
  });
});

describe("signedS3Request", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    isBlockedMock.mockReset();
    ssrfSafeFetchMock.mockReset();
  });

  it("refuses plain HTTP unless the deployment configured the endpoint", async () => {
    await expect(
      signedS3Request(
        { ...r2, endpoint: "http://storage.example.test" },
        "a.png",
        { method: "GET", timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/saved in settings must use HTTPS/);
  });

  it("only lets the deployment's own keys reach its private-network endpoint", async () => {
    Object.assign(process.env, {
      S3_ENDPOINT: "https://minio.internal:9000",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
    });
    isBlockedMock.mockResolvedValue(true);
    ssrfSafeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const deployment = {
      ...r2,
      endpoint: "https://minio.internal:9000",
      accessKeyId: "deploy-access",
      secretAccessKey: "deploy-secret",
    };

    // A workspace that saved the same endpoint with its own keys.
    await expect(
      signedS3Request(
        {
          ...deployment,
          accessKeyId: "workspace-access",
          secretAccessKey: "workspace-secret",
        },
        "a.png",
        { method: "GET", timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/SSRF blocked/);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();

    await signedS3Request(deployment, "a.png", {
      method: "GET",
      timeoutMs: 1_000,
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/minio\.internal:9000\//),
      expect.anything(),
      expect.objectContaining({
        allowedPrivateOrigins: ["https://minio.internal:9000"],
      }),
    );
  });

  it("only sends the deployment's own keys to its plain HTTP endpoint", async () => {
    Object.assign(process.env, {
      S3_ENDPOINT: "http://minio.internal:9000",
      S3_ACCESS_KEY_ID: "deploy-access",
      S3_SECRET_ACCESS_KEY: "deploy-secret",
    });
    isBlockedMock.mockResolvedValue(true);
    ssrfSafeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const deployment = {
      ...r2,
      endpoint: "http://minio.internal:9000",
      accessKeyId: "deploy-access",
      secretAccessKey: "deploy-secret",
    };

    // A workspace that saved the same endpoint with its own keys.
    await expect(
      signedS3Request(
        { ...deployment, accessKeyId: "workspace-access" },
        "a.png",
        { method: "GET", timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/saved in settings must use HTTPS/);
    await expect(
      signedS3Request(
        { ...deployment, secretAccessKey: "workspace-secret" },
        "a.png",
        { method: "GET", timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/saved in settings must use HTTPS/);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();

    const response = await signedS3Request(deployment, "a.png", {
      method: "GET",
      timeoutMs: 1_000,
    });
    expect(response.status).toBe(200);
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/minio\.internal:9000\//),
      expect.anything(),
      expect.objectContaining({
        allowedPrivateOrigins: ["http://minio.internal:9000"],
      }),
    );
  });
});

describe("fetchS3WithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    isBlockedMock.mockReset();
    ssrfSafeFetchMock.mockReset();
  });

  it("gives an upload time to send its body before waiting on headers", async () => {
    vi.useFakeTimers();
    isBlockedMock.mockResolvedValue(false);
    // An endpoint that never answers.
    ssrfSafeFetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const url = "https://storage.example.test/bucket/a.png";
    const outcome = (request: Promise<Response>) => {
      const state: { error?: unknown } = {};
      request.catch((error: unknown) => {
        state.error = error;
      });
      return state;
    };

    // 64 KiB takes two seconds at the slowest allowed rate.
    const upload = outcome(
      fetchS3WithTimeout(
        url,
        { method: "PUT", body: new ArrayBuffer(64 * 1024) },
        1_000,
      ),
    );
    const read = outcome(fetchS3WithTimeout(url, { method: "GET" }, 1_000));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(read.error).toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(upload.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(upload.error).toMatchObject({ name: "TimeoutError" });
    expect(String(upload.error)).toContain("timed out after 3000ms");

    // However large the body, the extra time stops at 15 minutes.
    const large = outcome(
      fetchS3WithTimeout(
        url,
        { method: "PUT", body: new ArrayBuffer(64 * 1024 * 1024) },
        1_000,
      ),
    );
    await vi.advanceTimersByTimeAsync(901_000);
    expect(String(large.error)).toContain("timed out after 901000ms");
  });
});

describe("readS3ErrorText", () => {
  it("reads only the start of an endless error body, then cancels it", async () => {
    let cancelled = false;
    const chunk = new TextEncoder().encode("x".repeat(600));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      readS3ErrorText(new Response(body, { status: 500 })),
    ).resolves.toBe("x".repeat(1024));
    expect(cancelled).toBe(true);
  });

  it("returns a short body whole", async () => {
    const error = "<Error><Code>AccessDenied</Code></Error>";

    await expect(
      readS3ErrorText(new Response(error, { status: 403 })),
    ).resolves.toBe(error);
    await expect(
      readS3ErrorText(new Response(null, { status: 403 })),
    ).resolves.toBe("");
  });
});

describe("s3ObjectUri", () => {
  it("refuses dot segments and slashes in the bucket", () => {
    expect(() => s3ObjectUri({ bucket: "b" }, "a/../b.png")).toThrow(
      /unsafe URL path segment/,
    );
    expect(() => s3ObjectUri({ bucket: "b" }, "./b.png")).toThrow(
      /unsafe URL path segment/,
    );
    expect(() => s3ObjectUri({ bucket: "a/b" }, "c.png")).toThrow(
      /unsafe URL path segment/,
    );
    expect(s3ObjectUri({ bucket: "b" }, "dir/it's (1).png")).toBe(
      "/b/dir/it%27s%20%281%29.png",
    );
  });
});
