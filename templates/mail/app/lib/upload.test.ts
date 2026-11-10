// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadFile } from "./upload";

describe("mail uploads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the server's storage setup error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Service Unavailable",
      json: async () => ({
        error: "File storage is not configured.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFile(new File(["file bytes"], "report.pdf")),
    ).rejects.toThrow("File storage is not configured.");
  });

  it("carries why storage refused the upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
        json: async () => ({
          error: "Builder.io refused the connection.",
          storageSetupRequired: true,
          storageSetupReason: "builder-refused",
        }),
      }),
    );

    await expect(
      uploadFile(new File(["file bytes"], "report.pdf")),
    ).rejects.toMatchObject({
      message: "Builder.io refused the connection.",
      storageSetup: "builder-refused",
    });
  });

  it("treats a setup failure with no known reason as missing storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
        json: async () => ({
          error: "File storage is not set up.",
          storageSetupRequired: true,
          storageSetupReason: "something-new",
        }),
      }),
    );

    await expect(
      uploadFile(new File(["file bytes"], "report.pdf")),
    ).rejects.toMatchObject({ storageSetup: "not-configured" });
  });

  it("doesn't mark an ordinary failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Payload Too Large",
        json: async () => ({ error: "File too large (max 10 MB)" }),
      }),
    );

    await expect(
      uploadFile(new File(["file bytes"], "report.pdf")),
    ).rejects.toMatchObject({ storageSetup: null });
  });
});
