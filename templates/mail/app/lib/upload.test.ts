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

  it("marks a failure that needs storage reconnected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
        json: async () => ({
          error: "Builder.io rejected the connection.",
          storageSetupRequired: true,
        }),
      }),
    );

    await expect(
      uploadFile(new File(["file bytes"], "report.pdf")),
    ).rejects.toMatchObject({
      message: "Builder.io rejected the connection.",
      storageSetupRequired: true,
    });
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
    ).rejects.toMatchObject({ storageSetupRequired: false });
  });
});
