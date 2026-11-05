import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSlackReader } from "./slack-client";
import { SlackIdentityUnresolvedError } from "./slack-own-posts";
import { pollSlackChannel } from "./slack-poller";

vi.mock("./slack-client", () => ({
  createSlackReader: vi.fn(),
}));

const BOT_USER = "UAPP0000001";
const BOT_ID = "BAPP0000001";
const APP_ID = "AAPP0000001";

const reader = {
  getChannelHistory: vi.fn(),
  getTeamInfo: vi.fn(),
  getUserInfo: vi.fn(),
  getAgentNativeIdentity: vi.fn(),
};

beforeEach(() => {
  vi.mocked(createSlackReader)
    .mockReset()
    .mockReturnValue(reader as never);
  reader.getChannelHistory.mockReset();
  reader.getTeamInfo
    .mockReset()
    .mockResolvedValue({ id: "T1", name: "Team", domain: "team" });
  reader.getUserInfo
    .mockReset()
    .mockImplementation(async (_workspace, id: string) => ({
      id,
      name: null,
      displayName: null,
      isBot: false,
    }));
  reader.getAgentNativeIdentity.mockReset().mockResolvedValue({
    userId: BOT_USER,
    userName: "agent-native",
    teamId: "T1",
    teamName: "Team",
    botId: BOT_ID,
  });
});

const person = (ts: string, text = `report ${ts}`) => ({
  type: "message",
  user: "UPERSON",
  text,
  ts,
});

/** What Slack returns for a channel post made with the app's bot token. */
const appNotice = (ts: string, text = `Needs a person: ${ts}`) => ({
  type: "message",
  subtype: "bot_message",
  text,
  ts,
  bot_id: BOT_ID,
  app_id: APP_ID,
  user: BOT_USER,
  bot_profile: { id: BOT_ID, app_id: APP_ID, name: "agent-native" },
});

/** A reply of the app's that Slack also shows in the channel: the only kind its history lists. */
const appThreadReply = (ts: string, threadTs: string) => ({
  ...appNotice(ts, "Builder has started work on this."),
  subtype: "thread_broadcast",
  thread_ts: threadTs,
});

const otherAppBot = (ts: string) => ({
  type: "message",
  subtype: "bot_message",
  text: `deploy finished ${ts}`,
  ts,
  bot_id: "BOTHER00001",
  app_id: "AOTHER00001",
  username: "Deploys",
});

const history = (messagesNewestFirst: unknown[]) =>
  reader.getChannelHistory.mockResolvedValue({
    messages: messagesNewestFirst,
    has_more: false,
  });

const poll = (extra: Record<string, unknown> = {}) =>
  pollSlackChannel({
    workspace: "primary",
    channelId: "C123",
    priorLastSlackTs: "10.0",
    ownerEmail: "owner@example.test",
    ...extra,
  });

const ids = (result: Awaited<ReturnType<typeof poll>>) =>
  result.envelopes.map((envelope) => envelope.externalId);

describe("a poll that leaves out the app's own posts", () => {
  it("does not take a notice the app posted after the position, and counts it", async () => {
    history([appNotice("12.0"), person("11.0")]);

    const result = await poll({ skipOwn: true });

    expect(ids(result)).toEqual(["C123:11.0"]);
    expect(result.skippedOwn).toBe(1);
  });

  it("does not take the app's thread reply, which would otherwise be filed under the report it answers", async () => {
    // The report was read on an earlier run; its reply carries the report's thread, so taken it would share the report's id.
    history([appThreadReply("13.0", "9.0"), person("9.0")]);

    const result = await poll({ skipOwn: true });

    expect(result.envelopes).toEqual([]);
    expect(result.skippedOwn).toBe(1);
    expect(result.nextLastSlackTs).toBe("13.0");
  });

  it("moves the position past the app's own posts, whether or not anything else came", async () => {
    history([appNotice("14.0"), appNotice("12.0")]);

    const onlyOwn = await poll({ skipOwn: true });

    expect(onlyOwn.envelopes).toEqual([]);
    expect(onlyOwn.skippedOwn).toBe(2);
    expect(onlyOwn.nextLastSlackTs).toBe("14.0");
  });

  it("says when the app's own post is newer than every report it kept, so the position can move past it too", async () => {
    history([appNotice("14.0"), person("12.0")]);

    const result = await poll({ skipOwn: true });

    expect(ids(result)).toEqual(["C123:12.0"]);
    expect(result.trailingOwnTs).toBe("14.0");
  });

  it("does not say so when a report came after the app's own post", async () => {
    history([person("14.0"), appNotice("12.0")]);

    const result = await poll({ skipOwn: true });

    expect(ids(result)).toEqual(["C123:14.0"]);
    expect(result.skippedOwn).toBe(1);
    expect(result.trailingOwnTs).toBeUndefined();
  });

  it("takes another app's bot and a person, in order, beside the app's own post", async () => {
    history([person("15.0"), appNotice("14.0"), otherAppBot("12.0")]);

    const result = await poll({ skipOwn: true });

    expect(ids(result)).toEqual(["C123:12.0", "C123:15.0"]);
    expect(result.envelopes[0]?.title).toBe("Slack bot Deploys");
    expect(result.skippedOwn).toBe(1);
  });

  it("knows the app's post by its bot id alone, by its user alone, and by its Slack app alone", async () => {
    history([
      { type: "message", text: "app only", ts: "14.0", app_id: APP_ID },
      { type: "message", text: "user only", ts: "13.0", user: BOT_USER },
      {
        type: "message",
        subtype: "bot_message",
        text: "bot only",
        ts: "12.0",
        bot_id: BOT_ID,
        username: "agent-native",
      },
      appNotice("11.5"),
    ]);

    const result = await poll({ skipOwn: true });

    expect(result.envelopes).toEqual([]);
    expect(result.skippedOwn).toBe(4);
  });

  it("does not sample the app's own posts when it shows the newest reports", async () => {
    history([appNotice("14.0"), person("13.0"), person("12.0")]);

    const result = await poll({ skipOwn: true, newest: 1 });

    expect(ids(result)).toEqual(["C123:13.0"]);
    expect(result.skippedOwn).toBe(1);
  });

  it("takes nothing, and reads no history, when the app cannot say who it is", async () => {
    history([appNotice("12.0"), person("11.0")]);
    reader.getAgentNativeIdentity.mockRejectedValue(
      new Error("Slack API error: invalid_auth"),
    );

    const failure = poll({ skipOwn: true });

    await expect(failure).rejects.toBeInstanceOf(SlackIdentityUnresolvedError);
    expect(reader.getChannelHistory).not.toHaveBeenCalled();
  });
});

describe("a poll that was not asked to leave them out", () => {
  it("takes the app's own posts exactly as it always did, and says nothing about them", async () => {
    history([
      appThreadReply("13.0", "11.0"),
      appNotice("12.0"),
      person("11.0"),
    ]);

    const result = await poll();

    expect(ids(result)).toEqual(["C123:11.0", "C123:12.0"]);
    expect(result).not.toHaveProperty("skippedOwn");
    expect(result).not.toHaveProperty("trailingOwnTs");
    expect(reader.getAgentNativeIdentity).not.toHaveBeenCalled();
  });
});
