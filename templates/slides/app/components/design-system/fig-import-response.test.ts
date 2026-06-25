import { describe, expect, it } from "vitest";

import {
  MAX_FIG_UPLOAD_BYTES,
  formatFileSize,
  readFigImportResponse,
} from "./fig-import-response";

describe("readFigImportResponse", () => {
  it("returns parsed fig import JSON", async () => {
    const body = {
      ok: true,
      suggestedTitle: "Brand",
      data: {},
      customInstructions: "",
      preview: {
        gradients: [],
        palette: [],
        namedColors: {},
        thumbnailDataUrl: null,
        nodeCount: 0,
        imageCount: 0,
      },
    };

    await expect(
      readFigImportResponse(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).resolves.toEqual(body);
  });

  it("preserves JSON error messages from the upload route", async () => {
    await expect(
      readFigImportResponse(
        new Response(
          JSON.stringify({
            error: "That doesn't look like a Figma .fig file.",
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    ).rejects.toThrow("That doesn't look like a Figma .fig file.");
  });

  it("turns non-JSON 413 responses into the expected file-size error", async () => {
    await expect(
      readFigImportResponse(
        new Response("<html>Request Entity Too Large</html>", {
          status: 413,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    ).rejects.toThrow(
      `File too large (max ${formatFileSize(MAX_FIG_UPLOAD_BYTES)}).`,
    );
  });

  it("summarizes other non-JSON upload failures", async () => {
    await expect(
      readFigImportResponse(
        new Response("<html>Not Found</html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    ).rejects.toThrow("Upload failed (404): Not Found");
  });
});
