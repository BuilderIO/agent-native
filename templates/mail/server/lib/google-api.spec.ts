import { afterEach, describe, expect, it, vi } from "vitest";
import { gmailBatchGetMessages, googleFetch } from "./google-api.js";

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("googleFetch quota handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trips cooldown on the first quota response instead of retrying inside the exhausted window", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          429,
          { error: { message: "User-rate limit exceeded" } },
          { "retry-after": "120" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-a",
      ),
    ).rejects.toThrow(/retry in 120s/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-a",
      ),
    ).rejects.toThrow(/Rate limit cooldown/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats quota failures inside Gmail batch parts as a whole-call cooldown", async () => {
    const boundary = "batch_test";
    const body = [
      `--${boundary}`,
      "Content-Type: application/http",
      "Content-ID: <response-part-0>",
      "",
      "HTTP/1.1 429 Too Many Requests",
      "Content-Type: application/json",
      "",
      JSON.stringify({ error: { message: "User-rate limit exceeded" } }),
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": `multipart/mixed; boundary=${boundary}` },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      gmailBatchGetMessages("quota-token-b", ["msg-1"], "metadata"),
    ).rejects.toThrow(/Gmail batch rate limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      gmailBatchGetMessages("quota-token-b", ["msg-2"], "metadata"),
    ).rejects.toThrow(/Rate limit cooldown/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("splits large Gmail batches by quota cost instead of sending one burst", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const requestBody = String(init?.body || "");
      const partCount = (requestBody.match(/Content-ID: <part-/g) || []).length;
      const boundary = "batch_chunked";
      const parts = Array.from({ length: partCount }, (_, i) =>
        [
          `--${boundary}`,
          "Content-Type: application/http",
          `Content-ID: <response-part-${i}>`,
          "",
          "HTTP/1.1 200 OK",
          "Content-Type: application/json",
          "",
          JSON.stringify({ id: `message-${i}` }),
        ].join("\r\n"),
      );
      const body = [...parts, `--${boundary}--`, ""].join("\r\n");
      return new Response(body, {
        status: 200,
        headers: { "content-type": `multipart/mixed; boundary=${boundary}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ids = Array.from({ length: 37 }, (_, i) => `msg-${i}`);
    const result = await gmailBatchGetMessages(
      "chunk-token-c",
      ids,
      "metadata",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(37);
  });
});
