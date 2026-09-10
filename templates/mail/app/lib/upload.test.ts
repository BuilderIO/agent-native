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
});
