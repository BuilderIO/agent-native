import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: vi.fn(() => ({
    userEmail: "slack-test@example.test",
  })),
  scopedCredentialCacheKey: vi.fn((key: string) => `slack-test:${key}`),
}));

vi.mock("./provider-credentials", () => ({
  resolveAnalyticsProviderCredential: vi.fn(async () => ({
    value: "fake-slack-token",
    source: "workspace_connection",
  })),
}));

import {
  getChannelHistory,
  listChannelsWithCoverage,
  resolveUsersWithCoverage,
  searchMessages,
} from "./slack";

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Slack read behavior", () => {
  it("does not join a channel when a read-only history request lacks access", async () => {
    const fetchMock = vi.fn(
      async (_rawUrl: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: false, error: "not_in_channel" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getChannelHistory("primary", "C-not-joined", 25),
    ).rejects.toThrow("Bot is not in this channel");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/api/conversations.history");
    expect(init?.method).toBeUndefined();
    expect(String(url)).not.toContain("conversations.join");
  });

  it("maps multiple authors through paginated users.list calls without users.info fan-out", async () => {
    const fetchMock = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      expect(url.pathname).toBe("/api/users.list");

      if (!url.searchParams.get("cursor")) {
        return new Response(
          JSON.stringify({
            ok: true,
            members: [slackUser("U-bulk-1", "Ada")],
            response_metadata: { next_cursor: "directory-page-2" },
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          members: [slackUser("U-bulk-2", "Grace")],
          response_metadata: { next_cursor: "" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveUsersWithCoverage("primary", [
      "U-bulk-1",
      "U-bulk-2",
      "U-bulk-1",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual(["/api/users.list", "/api/users.list"]);
    expect(fetchMock.mock.calls.join(" ")).not.toContain("users.info");
    expect(result.users["U-bulk-1"].real_name).toBe("Ada");
    expect(result.users["U-bulk-2"].real_name).toBe("Grace");
    expect(result.coverage).toMatchObject({
      requested_users: 2,
      resolved_users: 2,
      unresolved_user_ids: [],
      directory_pages_fetched: 2,
      coverage_complete: true,
      truncated: false,
      truncation_reasons: [],
    });
  });

  it("reports the existing timestamp cursor and provider coverage explicitly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              messages: [
                { type: "message", text: "Evidence", ts: "1784244674.153889" },
              ],
              has_more: true,
              response_metadata: { next_cursor: "provider-cursor" },
            }),
            { status: 200 },
          ),
      ),
    );

    const result = await getChannelHistory(
      "primary",
      "C-history-metadata",
      50,
      "1784244700.000000",
    );

    expect(result).toMatchObject({
      has_more: true,
      next_cursor: "1784244674.153889",
      truncated: true,
      pagination: {
        cursor_type: "latest_ts",
        request_cursor: "1784244700.000000",
        next_cursor: "1784244674.153889",
        provider_next_cursor: "provider-cursor",
      },
      coverage: {
        requested: 50,
        fetched: 1,
        returned: 1,
        pages_fetched: 1,
        coverage_complete: false,
        truncated: true,
        truncation_reasons: ["provider_has_more"],
      },
    });
  });

  it("reports a resumable cursor when the bounded channel scan hits its page cap", async () => {
    const fetchMock = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      const cursor = url.searchParams.get("cursor");
      const page = cursor ? Number(cursor.replace("channel-page-", "")) : 0;
      return new Response(
        JSON.stringify({
          ok: true,
          channels: [slackChannel(`C-page-${page}`)],
          response_metadata: { next_cursor: `channel-page-${page + 1}` },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listChannelsWithCoverage(
      "secondary",
      "channel-page-5",
    );

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(result.channels).toHaveLength(10);
    expect(result).toMatchObject({
      truncated: true,
      pagination: {
        cursor_type: "response_metadata",
        request_cursor: "channel-page-5",
        next_cursor: "channel-page-15",
      },
      coverage: {
        pages_fetched: 10,
        coverage_complete: false,
        truncated: true,
        truncation_reasons: ["page_cap"],
      },
    });
  });

  it("does not send bot credentials to Slack's user-token global search", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchMessages("primary", "launch", 50),
    ).resolves.toMatchObject({
      messages: [],
      total: 0,
      unsupported: true,
      truncated: true,
      pagination: { cursor_type: "none" },
      coverage: {
        coverage_complete: false,
        truncation_reasons: ["bot_token_global_search_unsupported"],
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function slackUser(id: string, name: string) {
  return {
    id,
    name: name.toLowerCase(),
    real_name: name,
    profile: {
      display_name: name,
      image_48: "",
      image_72: "",
    },
  };
}

function slackChannel(id: string) {
  return {
    id,
    name: id.toLowerCase(),
    topic: { value: "" },
    purpose: { value: "" },
    num_members: 1,
    is_archived: false,
  };
}
