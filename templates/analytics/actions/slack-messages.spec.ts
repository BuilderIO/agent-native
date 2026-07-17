import { beforeEach, describe, expect, it, vi } from "vitest";

const getChannelHistory = vi.fn();
const getTeamInfo = vi.fn();
const listChannelsWithCoverage = vi.fn();
const resolveUsersWithCoverage = vi.fn();
const requireActionCredentials = vi.fn();

vi.mock("../server/lib/slack", () => ({
  getChannelHistory,
  getTeamInfo,
  listChannelsWithCoverage,
  resolveUsersWithCoverage,
}));

vi.mock("./_provider-action-utils", () => ({
  providerError: (error: unknown) => ({ error: String(error) }),
  requireActionCredentials,
}));

const { default: slackMessages } = await import("./slack-messages");

const completeAuthorCoverage = {
  requested_users: 1,
  resolved_users: 1,
  unresolved_user_ids: [],
  requested_bots: 0,
  resolved_bots: 0,
  unresolved_bot_ids: [],
  directory_pages_fetched: 1,
  coverage_complete: true,
  truncated: false,
  truncation_reasons: [],
};

describe("slack-messages action", () => {
  beforeEach(() => {
    getChannelHistory.mockReset();
    getTeamInfo.mockReset();
    listChannelsWithCoverage.mockReset();
    resolveUsersWithCoverage.mockReset();
    requireActionCredentials.mockReset();
    requireActionCredentials.mockResolvedValue({ ok: true, ctx: {} });
    resolveUsersWithCoverage.mockResolvedValue({
      users: { U1: { id: "U1" } },
      coverage: completeAuthorCoverage,
    });
  });

  it("preserves history fields while adding cursor and coverage metadata", async () => {
    getChannelHistory.mockResolvedValue(
      historyResult({
        messages: [message("m1", "10.000", "U1")],
        has_more: true,
        next_cursor: "10.000",
        truncated: true,
        pagination: {
          cursor_type: "latest_ts",
          request_cursor: "20.000",
          next_cursor: "10.000",
        },
        coverage: coverage(1, true),
      }),
    );

    const result = (await slackMessages.run({
      mode: "history",
      workspace: "primary",
      channel: "C1",
      limit: 50,
      cursor: "20.000",
    })) as Record<string, any>;

    expect(result).toMatchObject({
      messages: [expect.objectContaining({ text: "m1", ts: "10.000" })],
      users: { U1: { id: "U1" } },
      has_more: true,
      next_cursor: "10.000",
      truncated: true,
      pagination: {
        cursor_type: "latest_ts",
        request_cursor: "20.000",
        next_cursor: "10.000",
      },
      coverage: {
        coverage_complete: false,
        truncated: true,
        truncation_reasons: ["provider_has_more"],
        authors: completeAuthorCoverage,
      },
    });
  });

  it("reports merged multi-channel truncation and per-channel cursors", async () => {
    getChannelHistory.mockImplementation(async (_workspace, channelId) =>
      historyResult({
        messages:
          channelId === "C1"
            ? [
                message("c1-new", "4.000", "U1"),
                message("c1-old", "1.000", "U1"),
              ]
            : [
                message("c2-new", "3.000", "U1"),
                message("c2-old", "2.000", "U1"),
              ],
        has_more: false,
        next_cursor: channelId === "C1" ? "1.000" : "2.000",
        truncated: false,
        pagination: {
          cursor_type: "latest_ts",
          next_cursor: channelId === "C1" ? "1.000" : "2.000",
        },
        coverage: coverage(2, false),
      }),
    );

    const result = (await slackMessages.run({
      mode: "multi-history",
      workspace: "primary",
      channels: "C1,C2",
      names: "alpha,beta",
      limit: 2,
      cursors: { C1: "5.000" },
    })) as Record<string, any>;

    expect(result.messages.map((item: any) => item.text)).toEqual([
      "c1-new",
      "c2-new",
    ]);
    expect(result).toMatchObject({
      has_more: true,
      next_cursors: { C1: "1.000", C2: "2.000" },
      total: 4,
      truncated: true,
      pagination: {
        cursor_type: "per_channel_latest_ts",
        request_cursors: { C1: "5.000" },
        next_cursors: { C1: "1.000", C2: "2.000" },
      },
      coverage: {
        requested: 4,
        fetched: 4,
        returned: 2,
        pages_fetched: 2,
        coverage_complete: false,
        truncated: true,
        truncation_reasons: ["merged_result_limit"],
        authors: completeAuthorCoverage,
      },
    });
  });

  it("preserves channel listing fields and exposes page-cap metadata", async () => {
    listChannelsWithCoverage.mockResolvedValue({
      channels: [{ id: "C1", name: "general" }],
      total: 1,
      truncated: true,
      pagination: {
        cursor_type: "response_metadata",
        request_cursor: "channel-page-5",
        next_cursor: "channel-page-15",
      },
      coverage: {
        requested: 2_000,
        fetched: 1,
        returned: 1,
        pages_fetched: 10,
        coverage_complete: false,
        truncated: true,
        truncation_reasons: ["page_cap"],
      },
    });

    const result = (await slackMessages.run({
      mode: "channels",
      workspace: "primary",
      limit: 50,
      cursor: "channel-page-5",
    })) as Record<string, any>;

    expect(result).toMatchObject({
      channels: [{ id: "C1", name: "general" }],
      total: 1,
      truncated: true,
      pagination: {
        cursor_type: "response_metadata",
        request_cursor: "channel-page-5",
        next_cursor: "channel-page-15",
      },
      coverage: {
        coverage_complete: false,
        truncation_reasons: ["page_cap"],
      },
    });
    expect(listChannelsWithCoverage).toHaveBeenCalledWith(
      "primary",
      "channel-page-5",
    );
  });

  it("preserves legacy search mode without attempting bot-incompatible global search", async () => {
    const result = (await slackMessages.run({
      mode: "search",
      workspace: "primary",
      query: "launch",
      limit: 50,
    })) as Record<string, any>;

    expect(result).toMatchObject({
      messages: [],
      users: {},
      total: 0,
      unsupported: true,
      truncated: true,
      coverage: {
        coverage_complete: false,
        truncation_reasons: ["bot_token_global_search_unsupported"],
      },
      guidance: expect.stringContaining("provider-corpus-job"),
    });
    expect(getChannelHistory).not.toHaveBeenCalled();
  });
});

function message(text: string, ts: string, user: string) {
  return { type: "message", text, ts, user };
}

function coverage(returned: number, truncated: boolean) {
  return {
    requested: returned,
    fetched: returned,
    returned,
    pages_fetched: 1,
    coverage_complete: !truncated,
    truncated,
    truncation_reasons: truncated ? ["provider_has_more"] : [],
  };
}

function historyResult<T>(result: T): T {
  return result;
}
