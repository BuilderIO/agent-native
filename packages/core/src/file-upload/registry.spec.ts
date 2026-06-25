import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builderFileUploadProvider } from "./builder.js";
import {
  getActiveFileUploadProvider,
  listFileUploadProviders,
  registerFileUploadProvider,
  unregisterFileUploadProvider,
  uploadFile,
} from "./registry.js";
import type { FileUploadProvider } from "./types.js";

const resolveBuilderPrivateKeyMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  resolveBuilderPrivateKey: resolveBuilderPrivateKeyMock,
}));

function makeProvider(
  id: string,
  configured: boolean,
  upload?: FileUploadProvider["upload"],
): FileUploadProvider {
  return {
    id,
    name: id,
    isConfigured: () => configured,
    upload:
      upload ??
      (async () => ({ url: `https://cdn/${id}`, id: `${id}-1`, provider: id })),
  };
}

describe("file-upload registry", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Drop any providers a prior test (or import side effect) left on the
    // globalThis-pinned map so each case starts clean.
    for (const p of listFileUploadProviders()) {
      unregisterFileUploadProvider(p.id);
    }
    process.env = { ...originalEnv };
    delete process.env.BUILDER_PRIVATE_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const p of listFileUploadProviders()) {
      unregisterFileUploadProvider(p.id);
    }
    process.env = { ...originalEnv };
  });

  describe("registration and lookup", () => {
    it("registers, lists, and unregisters providers", () => {
      const p = makeProvider("s3", true);
      registerFileUploadProvider(p);
      expect(listFileUploadProviders()).toContain(p);

      unregisterFileUploadProvider("s3");
      expect(listFileUploadProviders()).not.toContain(p);
    });

    it("is idempotent per id — re-registering the same id replaces it", () => {
      const first = makeProvider("dup", false);
      const second = makeProvider("dup", true);
      registerFileUploadProvider(first);
      registerFileUploadProvider(second);

      const matches = listFileUploadProviders().filter((p) => p.id === "dup");
      expect(matches).toHaveLength(1);
      expect(matches[0]).toBe(second);
    });
  });

  describe("getActiveFileUploadProvider", () => {
    it("returns the first configured user provider", () => {
      registerFileUploadProvider(makeProvider("unconfigured", false));
      const configured = makeProvider("configured", true);
      registerFileUploadProvider(configured);

      expect(getActiveFileUploadProvider()).toBe(configured);
    });

    it("falls back to the builder builtin when its env is set", () => {
      registerFileUploadProvider(makeProvider("unconfigured", false));
      process.env.BUILDER_PRIVATE_KEY = "bpk-123";

      expect(getActiveFileUploadProvider()).toBe(builderFileUploadProvider);
    });

    it("returns null when nothing is configured", () => {
      registerFileUploadProvider(makeProvider("unconfigured", false));
      expect(getActiveFileUploadProvider()).toBeNull();
    });

    it("prefers a configured user provider over the builder builtin", () => {
      process.env.BUILDER_PRIVATE_KEY = "bpk-123";
      const s3 = makeProvider("s3", true);
      registerFileUploadProvider(s3);
      expect(getActiveFileUploadProvider()).toBe(s3);
    });
  });

  describe("uploadFile dispatch", () => {
    it("uses a configured user provider directly without resolving builder creds", async () => {
      const upload = vi.fn(async () => ({
        url: "https://cdn/s3/x",
        provider: "s3",
      }));
      registerFileUploadProvider(makeProvider("s3", true, upload));

      const input = { data: new Uint8Array([1, 2, 3]), filename: "x.png" };
      const result = await uploadFile(input);

      expect(result).toEqual({ url: "https://cdn/s3/x", provider: "s3" });
      expect(upload).toHaveBeenCalledWith(input);
      // The builder credential path must not be touched for user providers.
      expect(resolveBuilderPrivateKeyMock).not.toHaveBeenCalled();
    });

    it("resolves builder credentials async and uploads via the builtin", async () => {
      resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-runtime");
      const uploadSpy = vi
        .spyOn(builderFileUploadProvider, "upload")
        .mockResolvedValue({
          url: "https://cdn.builder.io/abc",
          id: "abc",
          provider: "builder",
        });

      const input = { data: new Uint8Array([9]), mimeType: "image/png" };
      const result = await uploadFile(input);

      expect(result).toEqual({
        url: "https://cdn.builder.io/abc",
        id: "abc",
        provider: "builder",
      });
      expect(uploadSpy).toHaveBeenCalledWith(input);
      uploadSpy.mockRestore();
    });

    it("returns null (SQL fallback signal) when no creds resolve", async () => {
      resolveBuilderPrivateKeyMock.mockResolvedValue(null);
      const result = await uploadFile({ data: new Uint8Array([1]) });
      expect(result).toBeNull();
    });

    it("falls back to null when credential resolution throws (DB unavailable)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      resolveBuilderPrivateKeyMock.mockRejectedValue(new Error("db down"));

      const result = await uploadFile({ data: new Uint8Array([1]) });

      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Builder credential check failed"),
        expect.stringContaining("db down"),
      );
      warn.mockRestore();
    });

    it("does NOT swallow a real upload failure as a fallback", async () => {
      // Creds resolve fine, so an upload error must propagate to the caller
      // rather than being treated as a missing-provider null.
      resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-runtime");
      const uploadSpy = vi
        .spyOn(builderFileUploadProvider, "upload")
        .mockRejectedValue(new Error("network blip"));

      await expect(uploadFile({ data: new Uint8Array([1]) })).rejects.toThrow(
        /network blip/,
      );
      uploadSpy.mockRestore();
    });
  });
});
