import { describe, expect, it } from "vitest";
import {
  MAX_TOOL_PROXY_RESPONSE_SIZE,
  collectSecretValues,
  normalizeToolProxyMethod,
  readResponseTextWithLimit,
  redactSecrets,
  redactString,
  sanitizeOutboundHeaders,
} from "./proxy-security.js";

describe("normalizeToolProxyMethod", () => {
  it("accepts allowed methods (case-insensitive)", () => {
    expect(normalizeToolProxyMethod("get")).toBe("GET");
    expect(normalizeToolProxyMethod("POST")).toBe("POST");
    expect(normalizeToolProxyMethod("Patch")).toBe("PATCH");
  });

  it("rejects unsupported methods", () => {
    expect(normalizeToolProxyMethod("TRACE")).toBeNull();
    expect(normalizeToolProxyMethod("CONNECT")).toBeNull();
    expect(normalizeToolProxyMethod("PURGE")).toBeNull();
  });
});

describe("sanitizeOutboundHeaders", () => {
  it("strips ambient browser / smuggling headers", () => {
    const sanitized = sanitizeOutboundHeaders({
      "Content-Type": "application/json",
      Authorization: "Bearer abc",
      Cookie: "an_session=secret",
      Host: "internal",
      "Content-Length": "123",
      "Transfer-Encoding": "chunked",
      "X-Forwarded-For": "127.0.0.1",
      "X-Forwarded-Host": "internal",
      "X-Forwarded-Proto": "http",
      Origin: "https://attacker.example",
      Referer: "https://attacker.example",
    });

    expect(sanitized).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer abc",
    });
  });

  it("rejects header names with invalid characters", () => {
    const sanitized = sanitizeOutboundHeaders({
      "Bad Header": "value",
      "X Custom": "value",
      "X-Good-Custom": "value",
    });
    expect(sanitized).toEqual({ "X-Good-Custom": "value" });
  });

  it("rejects header values that contain CR/LF (response splitting)", () => {
    const sanitized = sanitizeOutboundHeaders({
      "X-Custom": "value\r\nInjected: header",
      "X-Newline": "value\nattack",
      "X-Clean": "value",
    });
    expect(sanitized).toEqual({ "X-Clean": "value" });
  });
});

describe("readResponseTextWithLimit", () => {
  it("aborts response reading once size budget is exceeded", async () => {
    const big = new Uint8Array(MAX_TOOL_PROXY_RESPONSE_SIZE + 1024);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const response = new Response(stream);
    const out = await readResponseTextWithLimit(response, 1024);
    expect(out.truncated).toBe(true);
    expect(out.size).toBeGreaterThan(1024);
    expect(out.text).toContain("response truncated");
  });

  it("rejects up-front when content-length exceeds the limit", async () => {
    const response = new Response("ignored", {
      headers: { "content-length": "5000000" },
    });
    const out = await readResponseTextWithLimit(response, 1_000_000);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain("response too large");
  });

  it("decodes the body normally when under the size budget", async () => {
    const response = new Response("hello world");
    const out = await readResponseTextWithLimit(response);
    expect(out.truncated).toBe(false);
    expect(out.text).toBe("hello world");
  });
});

describe("redactSecrets", () => {
  it("redacts secret values from strings, arrays, and nested objects", () => {
    const secrets = collectSecretValues(["sk_live_abc123"]);
    const value = {
      url: "https://api.example.com/?token=sk_live_abc123",
      payload: ["sk_live_abc123 is the key", { wrapped: "sk_live_abc123" }],
    };
    const redacted = redactSecrets(value, secrets);
    expect(JSON.stringify(redacted)).not.toContain("sk_live_abc123");
    expect(JSON.stringify(redacted)).toContain("[redacted]");
  });

  it("redacts URL-encoded forms of the secret too", () => {
    const secret = "abc def";
    const secrets = collectSecretValues([secret]);
    expect(redactString(`https://x/?q=${encodeURIComponent(secret)}`, secrets)).toContain(
      "[redacted]",
    );
  });
});
