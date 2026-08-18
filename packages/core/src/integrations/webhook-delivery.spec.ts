import { beforeEach, describe, expect, it, vi } from "vitest";

const isBlockedExtensionUrl = vi.fn();
const ssrfSafeFetch = vi.fn();

vi.mock("../extensions/url-safety.js", () => ({
  isBlockedExtensionUrl,
  ssrfSafeFetch,
}));

const { deliverJsonWebhook, escapeSlackMrkdwn } =
  await import("./webhook-delivery.js");

describe("webhook delivery primitives", () => {
  beforeEach(() => {
    isBlockedExtensionUrl.mockReset();
    ssrfSafeFetch.mockReset();
    isBlockedExtensionUrl.mockReturnValue(false);
  });

  it("escapes Slack mrkdwn control characters", () => {
    expect(escapeSlackMrkdwn("A & B < C > D")).toBe("A &amp; B &lt; C &gt; D");
  });

  it("rejects blocked URLs before the SSRF-safe fetch", async () => {
    isBlockedExtensionUrl.mockReturnValue(true);
    await expect(
      deliverJsonWebhook({ url: "http://127.0.0.1/hook", payload: {} }),
    ).resolves.toEqual({ ok: false, blocked: true });
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("posts JSON through the SSRF-safe fetch with bounded redirects", async () => {
    ssrfSafeFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      deliverJsonWebhook({
        url: "https://hooks.example.com/form",
        payload: { event: "submitted" },
      }),
    ).resolves.toEqual({ ok: true, status: 204 });
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      "https://hooks.example.com/form",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ event: "submitted" }),
      }),
      { maxRedirects: 3 },
    );
  });
});
