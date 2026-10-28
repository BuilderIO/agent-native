import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSlackReader } from "./slack-client";
import { pollSlackChannel, SLACK_USER_INFO_CONCURRENCY } from "./slack-poller";

vi.mock("./slack-client", () => ({
  createSlackReader: vi.fn(),
}));

const mockedCreateSlackReader = vi.mocked(createSlackReader);
const mockedSlackReader = {
  getChannelHistory: vi.fn(),
  getTeamInfo: vi.fn(),
  getUserInfo: vi.fn(),
  getThread: vi.fn(),
  getEyesReaction: vi.fn(),
  getCompleteThread: vi.fn(),
  verifyAgentNativeIdentity: vi.fn(),
  getAgentNativeIdentity: vi.fn(),
  postChannelMessage: vi.fn(),
  postThreadReply: vi.fn(),
};

beforeEach(() => {
  mockedCreateSlackReader.mockReset().mockReturnValue(mockedSlackReader);
  mockedSlackReader.getChannelHistory.mockReset();
  mockedSlackReader.getUserInfo
    .mockReset()
    .mockImplementation(async (_workspace, userId: string) => ({
      id: userId,
      name: null,
      displayName: null,
    }));
  mockedSlackReader.getThread.mockReset();
  mockedSlackReader.getEyesReaction.mockReset();
  mockedSlackReader.getCompleteThread.mockReset();
  mockedSlackReader.verifyAgentNativeIdentity.mockReset();
  mockedSlackReader.getAgentNativeIdentity.mockReset();
  mockedSlackReader.postChannelMessage.mockReset();
  mockedSlackReader.postThreadReply.mockReset();
  mockedSlackReader.getTeamInfo
    .mockReset()
    .mockResolvedValue({ id: "T1", name: "Builder", domain: "builder" });
});

describe("pollSlackChannel", () => {
  it("filters old messages and orders new messages by numeric timestamp", async () => {
    mockedSlackReader.getChannelHistory.mockResolvedValue({
      messages: [
        { type: "message", user: "U2", text: "later", ts: "10.200001" },
        { type: "message", user: "U1", text: "old", ts: "9.99" },
        { type: "message", user: "U3", text: "first", ts: "10.2" },
      ],
      has_more: true,
      next_cursor: "9.99",
    });

    const result = await pollSlackChannel({
      workspace: "primary",
      channelId: "C123",
      priorLastSlackTs: "10.0",
      ownerEmail: "owner@example.com",
    });

    expect(result.envelopes.map((envelope) => envelope.externalId)).toEqual([
      "C123:10.2",
      "C123:10.200001",
    ]);
    expect(result.nextLastSlackTs).toBe("10.200001");
    expect(result.hasMore).toBe(false);
    expect(mockedCreateSlackReader).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: undefined,
    });
    expect(mockedSlackReader.getChannelHistory).toHaveBeenCalledWith(
      "primary",
      "C123",
      100,
    );
    expect(mockedSlackReader.getTeamInfo).toHaveBeenCalledWith("primary");
  });

  it("drains a paginated backlog without advancing past unread messages", async () => {
    mockedSlackReader.getChannelHistory
      .mockResolvedValueOnce({
        messages: [
          { type: "message", user: "U2", text: "newer", ts: "30.2" },
          { type: "message", user: "U1", text: "new", ts: "30.1" },
        ],
        has_more: true,
        next_cursor: "30.1",
      })
      .mockResolvedValueOnce({
        messages: [
          { type: "message", user: "U3", text: "boundary", ts: "29.0" },
        ],
        has_more: true,
        next_cursor: "29.0",
      });

    const result = await pollSlackChannel({
      workspace: "primary",
      channelId: "C999",
      priorLastSlackTs: "29.0",
      ownerEmail: "owner@example.com",
    });

    expect(result.envelopes.map((envelope) => envelope.externalId)).toEqual([
      "C999:30.1",
      "C999:30.2",
    ]);
    expect(result.hasMore).toBe(false);
    expect(result.nextHistoryCursor).toBe(null);
    expect(mockedSlackReader.getChannelHistory).toHaveBeenLastCalledWith(
      "primary",
      "C999",
      100,
      "30.1",
    );
  });

  it("marks messages with replies partial and preserves thread metadata", async () => {
    mockedSlackReader.getChannelHistory.mockResolvedValue({
      messages: [
        {
          type: "message",
          bot_id: "B123",
          text: "A root message",
          ts: "20.1",
          reply_count: 2,
        },
        {
          type: "message",
          user: "U123",
          text: "A reply",
          ts: "20.2",
          thread_ts: "20.1",
        },
      ],
      has_more: false,
    });

    const result = await pollSlackChannel({
      workspace: "secondary",
      channelId: "C456",
      priorLastSlackTs: "20.0",
      ownerEmail: "owner@example.com",
    });

    expect(result.envelopes).toMatchObject([
      {
        externalId: "C456:20.1",
        title: "Slack bot B123",
        sourceUrl: "https://builder.slack.com/archives/C456/p201",
        channelId: "C456",
        threadTs: "20.1",
        coverage: "partial",
      },
    ]);
  });

  it("titles people with display name, then handle, then user id", async () => {
    mockedSlackReader.getChannelHistory.mockResolvedValue({
      messages: [
        { type: "message", user: "U1", text: "named", ts: "40.1" },
        { type: "message", user: "U2", text: "handled", ts: "40.2" },
        { type: "message", user: "U3", text: "unknown", ts: "40.3" },
        { type: "message", user: "U1", text: "same author again", ts: "40.4" },
      ],
      has_more: false,
    });
    mockedSlackReader.getUserInfo.mockImplementation(
      async (_workspace, userId: string) => {
        if (userId === "U1") {
          return { id: "U1", name: "johnsmith", displayName: "John Smith" };
        }
        if (userId === "U2") {
          return { id: "U2", name: "janedoe", displayName: null };
        }
        throw new Error("users_not_found");
      },
    );

    const result = await pollSlackChannel({
      workspace: "primary",
      channelId: "C321",
      priorLastSlackTs: "40.0",
      ownerEmail: "owner@example.com",
    });

    expect(result.envelopes.map((envelope) => envelope.title)).toEqual([
      "Slack user John Smith",
      "Slack user @janedoe",
      "Slack user U3",
      "Slack user John Smith",
    ]);
    expect(mockedSlackReader.getUserInfo).toHaveBeenCalledTimes(3);
    expect(result.envelopes[0]?.metadata).toMatchObject({
      userLabelsJson: expect.stringContaining("U1"),
    });
  });

  it("looks up in-text Slack mentions so list titles can resolve them later", async () => {
    mockedSlackReader.getChannelHistory.mockResolvedValue({
      messages: [
        {
          type: "message",
          user: "U1",
          text: "cc <@U9> on this",
          ts: "60.1",
        },
      ],
      has_more: false,
    });
    mockedSlackReader.getUserInfo.mockImplementation(
      async (_workspace, userId: string) => ({
        id: userId,
        name: userId === "U9" ? "ada" : "enzo",
        displayName: userId === "U9" ? "Ada" : "Enzo",
      }),
    );

    const result = await pollSlackChannel({
      workspace: "primary",
      channelId: "C888",
      priorLastSlackTs: "60.0",
      ownerEmail: "owner@example.com",
    });

    expect(mockedSlackReader.getUserInfo).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(result.envelopes[0]?.metadata?.userLabelsJson)),
    ).toEqual({
      U1: "Enzo",
      U9: "Ada",
    });
  });

  it("resolves Slack profiles with bounded concurrency", async () => {
    const authors = Array.from({ length: 8 }, (_, index) => `U${index + 1}`);
    mockedSlackReader.getChannelHistory.mockResolvedValue({
      messages: authors.map((user, index) => ({
        type: "message",
        user,
        text: `msg ${index}`,
        ts: `50.${index + 1}`,
      })),
      has_more: false,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    mockedSlackReader.getUserInfo.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { id: "U", name: null, displayName: null };
    });

    await pollSlackChannel({
      workspace: "primary",
      channelId: "C654",
      priorLastSlackTs: "50.0",
      ownerEmail: "owner@example.com",
    });

    expect(mockedSlackReader.getUserInfo).toHaveBeenCalledTimes(authors.length);
    expect(maxInFlight).toBeLessThanOrEqual(SLACK_USER_INFO_CONCURRENCY);
    expect(maxInFlight).toBe(SLACK_USER_INFO_CONCURRENCY);
  });

  it("propagates Slack history failures", async () => {
    const failure = new Error("Slack API unavailable");
    mockedSlackReader.getChannelHistory.mockRejectedValue(failure);

    await expect(
      pollSlackChannel({
        workspace: "primary",
        channelId: "C789",
        priorLastSlackTs: "0",
        ownerEmail: "owner@example.com",
      }),
    ).rejects.toBe(failure);
  });
});

describe("pollSlackChannel reactions", () => {
  const OWN_BOT = "UAGENTNATIVE";

  type Reaction = { name: string; count?: number; users?: string[] };

  function history(...messages: Array<Record<string, unknown>>) {
    mockedSlackReader.getChannelHistory.mockResolvedValue({
      messages: messages.map((message) => ({ type: "message", ...message })),
      has_more: false,
    });
  }

  /** Who Slack says is a bot: ids in `bots` are, every other id is a person. */
  function users(bots: string[] = [], failing: string[] = []) {
    mockedSlackReader.getAgentNativeIdentity.mockResolvedValue({
      userId: OWN_BOT,
      userName: "agent-native",
      teamId: "T1",
      teamName: "Builder",
    });
    mockedSlackReader.getUserInfo.mockImplementation(
      async (_workspace: string, userId: string) => {
        if (failing.includes(userId)) throw new Error("users.info failed");
        return {
          id: userId,
          name: null,
          displayName: null,
          isBot: bots.includes(userId),
        };
      },
    );
  }

  /** The users asked about, beyond the message author the poller always labels. */
  const reactorLookups = () =>
    mockedSlackReader.getUserInfo.mock.calls
      .map(([, userId]) => userId as string)
      .filter((userId) => userId !== "UAUTHOR");

  async function poll(...reactions: Reaction[][]) {
    history(
      ...reactions.map((list, index) => ({
        user: "UAUTHOR",
        text: `report ${index}`,
        ts: `20.${index + 1}`,
        ...(list.length > 0 ? { reactions: list } : {}),
      })),
    );
    const result = await pollSlackChannel({
      workspace: "primary",
      channelId: "C1",
      priorLastSlackTs: "10.0",
      ownerEmail: "owner@example.com",
    });
    return result.envelopes.map((envelope) => envelope.metadata);
  }

  it("records that a message nobody reacted to was read and has no person reaction", async () => {
    users();

    const [metadata] = await poll([]);

    expect(metadata).toMatchObject({
      personReactions: [],
      personReactors: [],
    });
    expect(metadata).not.toHaveProperty("unverifiedReactors");
    expect(mockedSlackReader.getAgentNativeIdentity).not.toHaveBeenCalled();
  });

  it("records the reaction a person added, and who added it", async () => {
    users();

    const [metadata] = await poll([
      { name: "eyes", count: 1, users: ["UPERSON"] },
    ]);

    expect(metadata).toMatchObject({
      personReactions: ["eyes"],
      personReactors: ["UPERSON"],
    });
    expect(metadata).not.toHaveProperty("unverifiedReactors");
  });

  it("does not count the workspace's own bot, and does not look it up", async () => {
    users();

    const [metadata] = await poll([
      { name: "eyes", count: 1, users: [OWN_BOT] },
    ]);

    expect(metadata).toMatchObject({ personReactions: [], personReactors: [] });
    expect(reactorLookups()).toEqual([]);
  });

  it("does not count another bot, and counts the person who reacted beside it", async () => {
    users(["UOTHERBOT"]);

    const [onlyBot, both] = await poll(
      [{ name: "eyes", count: 1, users: ["UOTHERBOT"] }],
      [
        { name: "eyes", count: 2, users: ["UOTHERBOT", "UPERSON"] },
        { name: "rocket", count: 1, users: ["UOTHERBOT"] },
      ],
    );

    expect(onlyBot).toMatchObject({ personReactions: [], personReactors: [] });
    expect(both).toMatchObject({
      personReactions: ["eyes"],
      personReactors: ["UPERSON"],
    });
  });

  it("looks each reactor up once, however many messages they reacted to", async () => {
    users();

    await poll(
      [{ name: "eyes", count: 1, users: ["UPERSON"] }],
      [{ name: "rocket", count: 1, users: ["UPERSON"] }],
    );

    expect(reactorLookups()).toEqual(["UPERSON"]);
  });

  it("counts a reactor it could not look up as a person, and says it could not verify them", async () => {
    users([], ["UUNKNOWN"]);

    const [metadata] = await poll([
      { name: "eyes", count: 1, users: ["UUNKNOWN"] },
    ]);

    expect(metadata).toMatchObject({
      personReactions: ["eyes"],
      personReactors: [],
      unverifiedReactors: ["UUNKNOWN"],
    });
  });

  it("counts a reactor Slack gave no bot flag for the same way", async () => {
    users();
    mockedSlackReader.getUserInfo.mockResolvedValue({
      id: "UFLAGLESS",
      name: null,
      displayName: null,
    });

    const [metadata] = await poll([
      { name: "eyes", count: 1, users: ["UFLAGLESS"] },
    ]);

    expect(metadata).toMatchObject({
      personReactions: ["eyes"],
      unverifiedReactors: ["UFLAGLESS"],
    });
  });

  it("counts reactors Slack did not list as people it could not verify", async () => {
    users();

    const [metadata] = await poll([
      { name: "eyes", count: 3, users: ["UPERSON"] },
    ]);

    expect(metadata).toMatchObject({
      personReactions: ["eyes"],
      personReactors: ["UPERSON"],
      unverifiedReactors: ["eyes:+2"],
    });
  });

  it("leaves a reply's reactions out, so they cannot overwrite the report's", async () => {
    users();
    history(
      {
        user: "UAUTHOR",
        text: "a broadcast reply",
        ts: "20.5",
        thread_ts: "11.0",
        reactions: [{ name: "eyes", count: 1, users: ["UPERSON"] }],
      },
      {
        user: "UAUTHOR",
        text: "a report",
        ts: "21.0",
      },
    );

    const result = await pollSlackChannel({
      workspace: "primary",
      channelId: "C1",
      priorLastSlackTs: "10.0",
      ownerEmail: "owner@example.com",
    });

    const [reply, report] = result.envelopes.map(
      (envelope) => envelope.metadata,
    );
    expect(reply).not.toHaveProperty("personReactions");
    expect(reply).not.toHaveProperty("personReactors");
    expect(report).toMatchObject({ personReactions: [] });
  });
});
