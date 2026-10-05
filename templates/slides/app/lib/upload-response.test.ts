import { describe, expect, it } from "vitest";

import {
  type JsonParsableResponse,
  parseUploadResponse,
} from "./upload-response";

function fakeResponse(status: number, body: string): JsonParsableResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

describe("parseUploadResponse", () => {
  it("parses a well-formed JSON success body", async () => {
    const result = await parseUploadResponse(
      fakeResponse(200, JSON.stringify({ path: "/uploads/a.png" })),
      "Upload failed",
    );
    expect(result).toEqual({ path: "/uploads/a.png" });
  });

  it("parses a well-formed JSON error envelope from a failed response", async () => {
    const result = await parseUploadResponse(
      fakeResponse(400, JSON.stringify({ error: "File too large" })),
      "Upload failed",
    );
    expect(result).toEqual({ error: "File too large" });
  });

  it("degrades a plaintext non-JSON failure body to a clean error message instead of throwing", async () => {
    const result = await parseUploadResponse(
      fakeResponse(500, "Internal Error"),
      "Upload failed",
    );
    expect(result.error).toBe("Upload failed: Internal Error");
  });

  it("truncates an overlong plain-text failure body", async () => {
    const longBody = `Something went wrong ${"x".repeat(500)}`;
    const result = await parseUploadResponse(
      fakeResponse(500, longBody),
      "Upload failed",
    );
    expect(result.error?.length).toBeLessThan(longBody.length);
    expect(result.error).toContain("…");
  });

  it.each([
    [504, `<!DOCTYPE html><html><body>${"x".repeat(500)}</body></html>`],
    [502, "<html><head><title>502 Bad Gateway</title></head></html>"],
    [500, '<?xml version="1.0"?><Error>boom</Error>'],
    [504, "upstream request timeout"],
    [503, "Service Unavailable"],
  ])(
    "types a %s gateway or markup failure body instead of echoing it",
    async (status, body) => {
      const result = await parseUploadResponse(
        fakeResponse(status, body),
        "Import failed",
      );

      expect(result).toEqual({
        error: "Import failed",
        errorCode: "upload_service_unavailable",
      });
    },
  );

  it("types a markup body that arrives with a success status", async () => {
    await expect(
      parseUploadResponse(
        fakeResponse(200, "<!DOCTYPE html><html></html>"),
        "Upload failed",
      ),
    ).rejects.toMatchObject({
      code: "upload_service_unavailable",
      status: 200,
    });
  });

  it("falls back to the plain fallback message when the failure body is empty", async () => {
    const result = await parseUploadResponse(
      fakeResponse(500, ""),
      "Upload failed",
    );
    expect(result.error).toBe("Upload failed");
  });

  it("throws when a successful response isn't JSON at all", async () => {
    await expect(
      parseUploadResponse(fakeResponse(200, "Internal Error"), "Upload failed"),
    ).rejects.toThrow(SyntaxError);
  });
});
