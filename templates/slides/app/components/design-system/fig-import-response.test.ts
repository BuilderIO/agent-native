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
      source: "builder",
      suggestedTitle: "Brand",
      projectId: "project-1",
      jobId: "job-1",
      designSystemId: "ds-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      status: "in-progress",
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
            error: "Connect Builder.io before indexing a design system.",
            builderConnectUrl: "/_agent-native/builder/connect",
          }),
          {
            status: 412,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    ).rejects.toThrow("Connect Builder.io before indexing a design system.");
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
