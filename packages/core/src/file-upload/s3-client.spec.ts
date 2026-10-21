import { describe, expect, it } from "vitest";

import {
  presignS3GetUrl,
  s3ObjectUri,
  signedS3Request,
  signS3Request,
} from "./s3-client.js";

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
  it("refuses plain HTTP unless the deployment configured the endpoint", async () => {
    await expect(
      signedS3Request(
        { ...r2, endpoint: "http://storage.example.test" },
        "a.png",
        { method: "GET", timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/saved in settings must use HTTPS/);
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
