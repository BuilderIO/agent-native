import { describe, expect, it } from "vitest";

import { presignS3GetUrl, s3ObjectUri, signS3Request } from "./s3-client.js";

// The expected signatures were produced independently by the aws4 package
// (mhart/aws4) for the same requests.
const credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
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
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261021%2Fauto%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20261021T123456Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host" +
        "&response-cache-control=private%2C%20max-age%3D300" +
        "&response-content-type=image%2Fpng" +
        "&X-Amz-Signature=655f415d49112b8a4dab4dbd0352a47c3e37a68e68f1e4705385154fbc079a2a",
    );
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
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261021/us-west-2/s3/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, " +
        "Signature=90d9f53d43e3506567f586ee6d354008a490a90114a80e51bd4c757af5ba335d",
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
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261021/auto/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=d8d1b35527694d3b6049338e6e1c9f23f36aa896c8ddeaa1e4169d6027a61a0a",
    );
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
