import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GmailQuotaCooldownError,
  gmailBatchGetMessages,
  googleFetch,
} from "./google-api.js";

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("googleFetch quota handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries transient Gmail gateway failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(502, { error: { message: "bad gateway" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      "gateway-token-a",
    );
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({ messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not replay state-changing requests after a gateway failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(502, { error: { message: "bad gateway" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { id: "sent-message" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        "gateway-token-b",
        {
          method: "POST",
          body: JSON.stringify({ raw: "message" }),
        },
      ),
    ).rejects.toThrow("Google API error (502): bad gateway");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the final 503 error body after read retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(503, { error: { message: "backend overloaded" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      "gateway-token-c",
    );
    const rejection = expect(resultPromise).rejects.toThrow(
      "Google API error (503): backend overloaded",
    );
    await vi.advanceTimersByTimeAsync(7000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
    ).rejects.toThrow(/about 120s/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Regression guard: callers (list-inbox-emails.ts) must classify this
    // by type, not by grepping the message for "quota"/"429" — the message
    // is deliberately jargon-free and contains neither.
    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-a",
      ),
    ).rejects.toBeInstanceOf(GmailQuotaCooldownError);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-a",
      ),
    ).rejects.toThrow(/briefly busy/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a whole-batch HTTP 429 as a typed cooldown error, not raw batch-failure text", async () => {
    // Distinct from the "quota failures inside Gmail batch parts" case below:
    // this is the *transport-level* response for the whole multipart batch
    // call returning 429, not a 200 with one 429 part inside it. Before the
    // fix this threw a plain `Error("... Gmail batch failed: ...")` that
    // leaked Google's raw error text and could never be recognized as a
    // cooldown by callers checking `instanceof GmailQuotaCooldownError`.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          429,
          { error: { message: "User-rate limit exceeded" } },
          { "retry-after": "30" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const rejection = gmailBatchGetMessages(
      "quota-token-whole-batch",
      ["msg-1"],
      "metadata",
    );
    await expect(rejection).rejects.toBeInstanceOf(GmailQuotaCooldownError);
    await expect(rejection).rejects.toThrow(/about 30s/);
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
    ).rejects.toThrow(/briefly busy/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      gmailBatchGetMessages("quota-token-b", ["msg-2"], "metadata"),
    ).rejects.toThrow(/briefly busy/);
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
