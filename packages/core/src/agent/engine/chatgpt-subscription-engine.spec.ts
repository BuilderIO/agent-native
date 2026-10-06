import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  markReconnect: vi.fn(),
}));

vi.mock("../../server/chatgpt-subscription-oauth.js", () => ({
  getChatGPTSubscriptionAccess: mocks.getAccess,
  markChatGPTSubscriptionReconnectRequired: mocks.markReconnect,
}));

import {
  createChatGPTSubscriptionFetch,
  listChatGPTSubscriptionModels,
} from "./chatgpt-subscription-engine.js";

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

  it("sends Responses requests to the public endpoint with plan constraints", async () => {
    const upstream = vi.fn<typeof fetch>(async () => new Response("{}"));
    globalThis.fetch = upstream;
    const request = new Request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "old-token",
        Originator: "private-client",
        "ChatGPT-Account-Id": "private-account",
      },
      body: JSON.stringify({
        model: "model-slug",
        max_output_tokens: 123,
        temperature: 0.5,
        previous_response_id: "previous-response",
        input: [{ role: "user", content: "Hi" }],
      }),
    });

    await createChatGPTSubscriptionFetch("user@example.com")(request);

    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("chatgpt-account-id")).toBeNull();
    expect(headers.get("originator")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "model-slug",
      input: [{ role: "user", content: "Hi" }],
      store: false,
      stream: true,
    });
  });

  it("lists visible models in the account's display order", async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json({
        models: [
          { slug: "second", display_name: "Second", visibility: "list" },
          { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
          { slug: "first", display_name: "First", visibility: "list" },
        ],
      }),
    );
    globalThis.fetch = upstream;

    await expect(
      listChatGPTSubscriptionModels("user@example.com"),
    ).resolves.toEqual({
      models: ["second", "first"],
      modelDisplayNames: { second: "Second", first: "First" },
    });
    expect(String(upstream.mock.calls[0]?.[0])).toBe(
      "https://api.openai.com/v1/models",
    );
    expect(
      new Headers(upstream.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer access-token");
  });

  it("rejects requests outside the Responses endpoint", async () => {
    const upstream = vi.fn<typeof fetch>();
    globalThis.fetch = upstream;

    await expect(
      createChatGPTSubscriptionFetch("user@example.com")(
        "https://example.com/v1/responses",
        { method: "POST", body: JSON.stringify({ input: [] }) },
      ),
    ).rejects.toThrow("public OpenAI Responses API");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("marks the subscription for reconnect after an unauthorized response", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 401 }),
    );

    await createChatGPTSubscriptionFetch("user@example.com")(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.5", input: [] }),
      },
    );

    expect(mocks.markReconnect).toHaveBeenCalledWith("user@example.com");
  });
});
