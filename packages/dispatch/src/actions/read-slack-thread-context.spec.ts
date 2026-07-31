import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

const action = (await import("./read-slack-thread-context.js")).default;

describe("read-slack-thread-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the parent thread for a child Slack permalink and preserves evidence", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
        json: {
          ok: true,
          messages: [
            {
              ts: "1785438845.570649",
              text: "Root https://example.com/issue",
              attachments: [{ title: "log", url: "https://example.com/log" }],
            },
            {
              ts: "1785438901.123456",
              thread_ts: "1785438845.570649",
              text: "Reply",
            },
          ],
          response_metadata: { next_cursor: "next-page" },
        },
      },
    });

    await expect(
      action.run(
        {
          permalink:
            "https://builder-internal.slack.com/archives/C0ATH3CCZT4/p1785438901123456?thread_ts=1785438845.570649&cid=C0ATH3CCZT4",
          limit: 100,
          connectionId: "slack-connection",
        },
        {} as never,
      ),
    ).resolves.toMatchObject({
      channelId: "C0ATH3CCZT4",
      linkedMessageTs: "1785438901.123456",
      threadTs: "1785438845.570649",
      completeness: "partial",
      nextCursor: "next-page",
      messageCount: 2,
      relatedLinks: ["https://example.com/issue", "https://example.com/log"],
    });

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith({
      provider: "slack",
      method: "GET",
      path: "/conversations.replies",
      query: {
        channel: "C0ATH3CCZT4",
        ts: "1785438845.570649",
        limit: 100,
      },
      connectionId: "slack-connection",
      maxBytes: 2 * 1024 * 1024,
    });
  });

  it("uses the linked message as the parent when no thread timestamp is present", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: { ok: true, status: 200, json: { ok: true, messages: [] } },
    });

    await action.run(
      {
        permalink:
          "https://builder-internal.slack.com/archives/C123/p1234567890123456",
        limit: 25,
      },
      {} as never,
    );

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          channel: "C123",
          ts: "1234567890.123456",
          limit: 25,
        },
      }),
    );
  });

  it("fails loudly when Slack returns an unreadable thread", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
        json: { ok: false, error: "not_in_channel" },
      },
    });

    await expect(
      action.run(
        {
          permalink:
            "https://builder-internal.slack.com/archives/C123/p1234567890123456",
          limit: 25,
        },
        {} as never,
      ),
    ).rejects.toThrow("Slack thread read failed: not_in_channel.");
  });

  it("rejects non-Slack archive URLs before using credentials", async () => {
    await expect(
      action.run(
        {
          permalink: "https://example.com/archives/C123/p1234567890123456",
          limit: 25,
        },
        {} as never,
      ),
    ).rejects.toThrow("Expected an https Slack archive permalink.");
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });
});
