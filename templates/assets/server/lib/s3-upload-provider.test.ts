import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPresignedS3ObjectUrl,
  getS3Object,
  s3FileUploadProvider,
  s3StorageKey,
} from "./s3-upload-provider.js";

const ORIGINAL_ENV = {
  ASSETS_STORAGE_BUCKET: process.env.ASSETS_STORAGE_BUCKET,
  ASSETS_STORAGE_ACCESS_KEY_ID: process.env.ASSETS_STORAGE_ACCESS_KEY_ID,
  ASSETS_STORAGE_SECRET_ACCESS_KEY:
    process.env.ASSETS_STORAGE_SECRET_ACCESS_KEY,
  ASSETS_STORAGE_ENDPOINT: process.env.ASSETS_STORAGE_ENDPOINT,
  ASSETS_STORAGE_REGION: process.env.ASSETS_STORAGE_REGION,
  ASSETS_STORAGE_PUBLIC_BASE_URL: process.env.ASSETS_STORAGE_PUBLIC_BASE_URL,
  IMAGES_STORAGE_BUCKET: process.env.IMAGES_STORAGE_BUCKET,
  IMAGES_STORAGE_ACCESS_KEY_ID: process.env.IMAGES_STORAGE_ACCESS_KEY_ID,
  IMAGES_STORAGE_SECRET_ACCESS_KEY:
    process.env.IMAGES_STORAGE_SECRET_ACCESS_KEY,
  IMAGES_STORAGE_ENDPOINT: process.env.IMAGES_STORAGE_ENDPOINT,
  IMAGES_STORAGE_REGION: process.env.IMAGES_STORAGE_REGION,
  IMAGES_STORAGE_PUBLIC_BASE_URL: process.env.IMAGES_STORAGE_PUBLIC_BASE_URL,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function configureS3(publicBaseUrl?: string) {
  delete process.env.IMAGES_STORAGE_BUCKET;
  delete process.env.IMAGES_STORAGE_ACCESS_KEY_ID;
  delete process.env.IMAGES_STORAGE_SECRET_ACCESS_KEY;
  delete process.env.IMAGES_STORAGE_ENDPOINT;
  delete process.env.IMAGES_STORAGE_REGION;
  delete process.env.IMAGES_STORAGE_PUBLIC_BASE_URL;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_REGION;
  delete process.env.S3_PUBLIC_BASE_URL;
  process.env.ASSETS_STORAGE_BUCKET = "assets-bucket";
  process.env.ASSETS_STORAGE_ACCESS_KEY_ID = "access-key";
  process.env.ASSETS_STORAGE_SECRET_ACCESS_KEY = "secret-key";
  process.env.ASSETS_STORAGE_ENDPOINT = "https://r2.example.com";
  process.env.ASSETS_STORAGE_REGION = "auto";
  if (publicBaseUrl) {
    process.env.ASSETS_STORAGE_PUBLIC_BASE_URL = publicBaseUrl;
  } else {
    delete process.env.ASSETS_STORAGE_PUBLIC_BASE_URL;
  }
}

describe("s3FileUploadProvider", () => {
  beforeEach(() => {
    restoreEnv();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("returns a durable object id plus a signed URL when no public base URL exists", async () => {
    configureS3();
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 200 }));

    const result = await s3FileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "preview.png",
      mimeType: "image/png",
    });

    expect(result.provider).toBe("s3");
    expect(result.id).toMatch(/^assets\/\d+-[a-z0-9]+\.png$/);
    expect(result.url).toContain("https://r2.example.com/assets-bucket/");
    expect(result.url).toContain("X-Amz-Signature=");
    expect(result.url).not.toBe(
      `https://r2.example.com/assets-bucket/${result.id}`,
    );
  });

  it("uses the configured public base URL for public buckets", async () => {
    configureS3("https://cdn.example.com/media");
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 200 }));

    const result = await s3FileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "preview.png",
      mimeType: "image/png",
    });

    expect(result.provider).toBe("s3");
    expect(result.id).toMatch(/^assets\/\d+-[a-z0-9]+\.png$/);
    expect(result.url).toBe(`https://cdn.example.com/media/${result.id}`);
  });

  it("signs S3 handle reads instead of fetching raw private endpoints", async () => {
    configureS3();
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([4, 5, 6]), { status: 200 }),
    );

    const body = await getS3Object(s3StorageKey("assets/example.png"));

    expect([...body]).toEqual([4, 5, 6]);
    expect(fetch).toHaveBeenCalledWith(
      "https://r2.example.com/assets-bucket/assets/example.png",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("AWS4-HMAC-SHA256"),
        }),
      }),
    );
  });

  it("returns presigned URLs for private S3 handles", async () => {
    configureS3();

    const signed = await getPresignedS3ObjectUrl(
      s3StorageKey("assets/example.png"),
      120,
    );

    expect(signed.url).toContain(
      "https://r2.example.com/assets-bucket/assets/example.png",
    );
    expect(signed.url).toContain("X-Amz-Expires=120");
    expect(signed.url).toContain("X-Amz-Signature=");
  });
});
