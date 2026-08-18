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
  addEyesReaction: vi.fn(),
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
  mockedSlackReader.addEyesReaction.mockReset();
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
