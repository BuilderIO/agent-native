import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));

import {
  LocalNativeExportArtifactError,
  saveLocalNativeExportArtifact,
} from "./local-native-export-artifact.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const metadata = {
  artifactId: "00000000-0000-4000-8000-000000000000.png",
  format: "png",
  byteLength: 8,
  sha256: "a".repeat(64),
  expiresAt: "2026-10-07T12:00:00.000Z",
};

describe("saveLocalNativeExportArtifact", () => {
  it("sends the exact local Blob with credentials and accepts only matching metadata", async () => {
    const blob = new Blob(["12345678"], { type: "image/png" });
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => metadata });
    globalThis.fetch = fetcher;

    await expect(
      saveLocalNativeExportArtifact({ designId: "design-123", blob }),
    ).resolves.toEqual(metadata);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/qa-native-export-artifacts?designId=design-123",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: blob,
      }),
    );
  });

  it("keeps route rejection and malformed success distinct", async () => {
    const blob = new Blob(["12345678"], { type: "image/png" });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "design-access-denied" }),
    });
    await expect(
      saveLocalNativeExportArtifact({ designId: "design-123", blob }),
    ).rejects.toMatchObject({ code: "design-access-denied" });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...metadata, byteLength: 7 }),
    });
    await expect(
      saveLocalNativeExportArtifact({ designId: "design-123", blob }),
    ).rejects.toMatchObject({ code: "handoff-unreadable" });
    expect(new LocalNativeExportArtifactError("test").name).toBe(
      "LocalNativeExportArtifactError",
    );
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
    ["image/svg+xml", "svg"],
    ["application/pdf", "pdf"],
    ["application/zip", "zip"],
    ["text/html", "html"],
  ])(
    "accepts matching %s local evidence metadata",
    async (mimeType, format) => {
      const blob = new Blob(["12345678"], { type: mimeType });
      const result = {
        ...metadata,
        artifactId: `00000000-0000-4000-8000-000000000000.${format}`,
        format,
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => result,
      });
      await expect(
        saveLocalNativeExportArtifact({ designId: "design-123", blob }),
      ).resolves.toEqual(result);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...result, format: "png" }),
      });
      await expect(
        saveLocalNativeExportArtifact({ designId: "design-123", blob }),
      ).rejects.toMatchObject({ code: "handoff-unreadable" });
    },
  );
});
