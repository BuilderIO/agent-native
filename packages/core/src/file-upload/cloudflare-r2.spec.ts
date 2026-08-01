import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCloudflareR2ObjectKey,
  cloudflareR2FileUploadProvider,
  CLOUDFLARE_R2_BINDING_NAME,
  joinPublicUrl,
  lookupCloudflareR2Binding,
} from "./cloudflare-r2.js";
import { isFileUploadStorageNotConfiguredError } from "./errors.js";

const resolveSecretMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  resolveSecret: resolveSecretMock,
}));

type CfGlobals = typeof globalThis & {
  __cf_env?: Record<string, unknown>;
  __env__?: Record<string, unknown>;
};

function bind(value: unknown): void {
  (globalThis as CfGlobals).__cf_env = { [CLOUDFLARE_R2_BINDING_NAME]: value };
}

function clearBindings(): void {
  delete (globalThis as CfGlobals).__cf_env;
  delete (globalThis as CfGlobals).__env__;
}

describe("cloudflare r2 file upload provider", () => {
  beforeEach(() => {
    clearBindings();
    vi.clearAllMocks();
    resolveSecretMock.mockResolvedValue("https://files.example.com");
  });

  afterEach(clearBindings);

  describe("lookupCloudflareR2Binding", () => {
    it("reports an absent binding", () => {
      expect(lookupCloudflareR2Binding()).toEqual({ status: "absent" });
    });

    it("reports a bound bucket", () => {
      const bucket = { put: vi.fn() };
      bind(bucket);
      expect(lookupCloudflareR2Binding()).toEqual({
        status: "bound",
        bucket,
      });
    });

    it("reads the Nitro __env__ global too", () => {
      const bucket = { put: vi.fn() };
      (globalThis as CfGlobals).__env__ = {
        [CLOUDFLARE_R2_BINDING_NAME]: bucket,
      };
      expect(lookupCloudflareR2Binding()).toEqual({ status: "bound", bucket });
    });

    it("distinguishes a bound-but-unusable value from an absent one", () => {
      // A `vars` entry with the binding's name is the realistic misconfiguration
      // and must not read as "storage not set up yet".
      bind("my-bucket");
      const lookup = lookupCloudflareR2Binding();
      expect(lookup.status).toBe("unusable");
      expect(lookup.status === "unusable" && lookup.reason).toMatch(
        /r2_buckets/,
      );
    });
  });

  describe("isConfigured", () => {
    it("is false off Cloudflare", () => {
      expect(cloudflareR2FileUploadProvider.isConfigured()).toBe(false);
    });

    it("is true for a bound bucket", () => {
      bind({ put: vi.fn() });
      expect(cloudflareR2FileUploadProvider.isConfigured()).toBe(true);
    });

    it("claims an unusable binding so upload can name the fault", () => {
      bind("my-bucket");
      expect(cloudflareR2FileUploadProvider.isConfigured()).toBe(true);
    });
  });

  describe("object keys and URLs", () => {
    it("keeps the filename extension", () => {
      expect(
        buildCloudflareR2ObjectKey(
          { data: new Uint8Array(), filename: "A.PNG" },
          "id1",
        ),
      ).toBe("uploads/id1.png");
    });

    it("falls back to the mime subtype when there is no filename", () => {
      expect(
        buildCloudflareR2ObjectKey(
          { data: new Uint8Array(), mimeType: "image/webp" },
          "id2",
        ),
      ).toBe("uploads/id2.webp");
    });

    it("emits an extensionless key when neither is usable", () => {
      expect(
        buildCloudflareR2ObjectKey({ data: new Uint8Array() }, "id3"),
      ).toBe("uploads/id3");
    });

    it("joins a base URL without doubling the separator", () => {
      expect(joinPublicUrl("https://cdn.example.com/", "uploads/a.png")).toBe(
        "https://cdn.example.com/uploads/a.png",
      );
    });
  });

  describe("upload", () => {
    it("puts the object and returns a URL plus an opaque key", async () => {
      const put = vi.fn(async () => ({}));
      bind({ put });

      const result = await cloudflareR2FileUploadProvider.upload({
        data: new Uint8Array([1, 2, 3]),
        filename: "reference.png",
        mimeType: "image/png",
      });

      expect(result.provider).toBe("cloudflare-r2");
      expect(result.url).toMatch(
        /^https:\/\/files\.example\.com\/uploads\/[\w-]+\.png$/,
      );
      expect(result.id).toBe(
        result.url.replace("https://files.example.com/", ""),
      );
      expect(put).toHaveBeenCalledWith(result.id, expect.any(Uint8Array), {
        httpMetadata: { contentType: "image/png" },
      });
    });

    it("fails closed with setup guidance when the binding is absent", async () => {
      const err = await cloudflareR2FileUploadProvider
        .upload({ data: new Uint8Array([1]) })
        .catch((e) => e);

      expect(isFileUploadStorageNotConfiguredError(err)).toBe(true);
      expect(err.message).toMatch(/CLOUDFLARE_R2_BUCKET_NAME/);
    });

    it("fails closed when the binding is not an R2 bucket", async () => {
      bind("my-bucket");
      const err = await cloudflareR2FileUploadProvider
        .upload({ data: new Uint8Array([1]) })
        .catch((e) => e);

      expect(isFileUploadStorageNotConfiguredError(err)).toBe(true);
      expect(err.message).toMatch(/misconfigured/);
    });

    it("fails closed when the bucket is bound but has no public base URL", async () => {
      const put = vi.fn(async () => ({}));
      bind({ put });
      resolveSecretMock.mockResolvedValue(null);

      const err = await cloudflareR2FileUploadProvider
        .upload({ data: new Uint8Array([1]) })
        .catch((e) => e);

      expect(isFileUploadStorageNotConfiguredError(err)).toBe(true);
      expect(err.message).toMatch(/CLOUDFLARE_R2_PUBLIC_BASE_URL/);
      // Nothing may be written when the result could not be addressed.
      expect(put).not.toHaveBeenCalled();
    });
  });
});
