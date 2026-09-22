import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  markReconnect: vi.fn(),
}));

vi.mock("../../server/chatgpt-subscription-oauth.js", () => ({
  getChatGPTSubscriptionAccess: mocks.getAccess,
  markChatGPTSubscriptionReconnectRequired: mocks.markReconnect,
}));

import { createChatGPTSubscriptionFetch } from "./chatgpt-subscription-engine.js";

describe("ChatGPT subscription engine transport", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.getAccess.mockResolvedValue({
      accessToken: "access-token",
      accountId: "account-id",
    });
    mocks.markReconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("rewrites Responses requests and removes the unsupported output limit", async () => {
    const upstream = vi.fn<typeof fetch>(async () => new Response("{}"));
    globalThis.fetch = upstream;
    const request = new Request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "old-token" },
      body: JSON.stringify({
        model: "gpt-5.5",
        max_output_tokens: 123,
        input: [{ role: "user", content: "Hi" }],
      }),
    });

    await createChatGPTSubscriptionFetch("user@example.com")(request);

    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("chatgpt-account-id")).toBe("account-id");
    expect(headers.get("originator")).toBe("agent-native");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-5.5",
      input: [{ role: "user", content: "Hi" }],
    });
  });

  it("marks the subscription for reconnect after an unauthorized response", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 401 }),
    );

    await createChatGPTSubscriptionFetch("user@example.com")(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.5" }),
      },
    );

    expect(mocks.markReconnect).toHaveBeenCalledWith("user@example.com");
  });
});
