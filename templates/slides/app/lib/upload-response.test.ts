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
    // R83 repro: an upstream proxy/platform crash page returns plaintext
    // ("Internal E..." truncated), not a JSON envelope. response.json() on
    // this body throws `SyntaxError: Unexpected token 'I', "Internal
    // E"... is not valid JSON`.
    const result = await parseUploadResponse(
      fakeResponse(500, "Internal Error"),
      "Upload failed",
    );
    expect(result.error).toBe("Upload failed: Internal Error");
  });

  it("truncates an overlong non-JSON failure body", async () => {
    const longBody = `<html><body>${"x".repeat(500)}</body></html>`;
    const result = await parseUploadResponse(
      fakeResponse(502, longBody),
      "Upload failed",
    );
    expect(result.error?.length).toBeLessThan(longBody.length);
    expect(result.error).toContain("…");
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
