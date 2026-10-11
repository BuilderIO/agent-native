import { describe, expect, it, vi } from "vitest";

import {
  readFileUploadStatus,
  readFileUploadStatusProbe,
} from "./file-upload-status";

describe("readFileUploadStatusProbe", () => {
  it("uses the upload authorization result even when Builder AI is connected", async () => {
    const response = Response.json({
      configured: false,
      builderConfigured: true,
      builderUploadConfigured: false,
      builderReauthorizationRequired: true,
    });

    await expect(readFileUploadStatusProbe(response)).resolves.toBe("missing");
  });

  it("preserves the upload grant reauthorization requirement", async () => {
    await expect(
      readFileUploadStatus(
        Response.json({
          configured: false,
          builderConfigured: true,
          builderUploadConfigured: false,
          builderReauthorizationRequired: true,
        }),
      ),
    ).resolves.toEqual({
      state: "missing",
      builderReauthorizationRequired: true,
    });
  });

  it("reports storage as configured only when the upload status confirms it", async () => {
    await expect(
      readFileUploadStatusProbe(
        Response.json({
          configured: true,
          builderConfigured: true,
          builderUploadConfigured: true,
        }),
      ),
    ).resolves.toBe("configured");
  });

  it("preserves HTTP, network, and malformed status failures as unavailable", async () => {
    await expect(
      readFileUploadStatusProbe(new Response(null, { status: 503 })),
    ).resolves.toBe("unavailable");
    await expect(
      readFileUploadStatusProbe(Response.json({ builderConfigured: true })),
    ).resolves.toBe("unavailable");

    const invalidJson = new Response("not json");
    vi.spyOn(invalidJson, "json").mockRejectedValue(new Error("invalid json"));
    await expect(readFileUploadStatusProbe(invalidJson)).resolves.toBe(
      "unavailable",
    );
  });
});
