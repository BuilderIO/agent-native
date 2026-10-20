import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConnectorSecret } from "../connectors/credentials.js";
import {
  authTest,
  findUserByEmail,
  getChannelHistory,
  getMessagePermalink,
  getTeamInfo,
  getThread,
  postChannelMessage,
  postThreadReply,
} from "../connectors/slack.js";
import {
  createSlackReader,
  createSlackWorkflowClient,
  isAgentNativeSlackUserName,
} from "./slack-client";

vi.mock("../connectors/slack.js", () => ({
  authTest: vi.fn(),
  findUserByEmail: vi.fn(),
  getMessagePermalink: vi.fn(),
  getChannelHistory: vi.fn(),
  getTeamInfo: vi.fn(),
  getThread: vi.fn(),
  postChannelMessage: vi.fn(),
  postThreadReply: vi.fn(),
}));

vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: vi.fn(),
}));

const mockedGetChannelHistory = vi.mocked(getChannelHistory);
const mockedAuthTest = vi.mocked(authTest);
const mockedGetTeamInfo = vi.mocked(getTeamInfo);
const mockedGetThread = vi.mocked(getThread);
const mockedPostChannelMessage = vi.mocked(postChannelMessage);
const mockedPostThreadReply = vi.mocked(postThreadReply);
const mockedResolveConnectorSecret = vi.mocked(resolveConnectorSecret);

beforeEach(() => {
  mockedAuthTest.mockReset().mockResolvedValue({
    userId: "U-agent-native",
    userName: "agent-native",
    teamId: "T1",
    teamName: "Builder",
  });
  mockedGetChannelHistory.mockReset().mockResolvedValue({
    messages: [],
    has_more: false,
  });
  mockedGetTeamInfo.mockReset().mockResolvedValue({
    id: "T1",
    name: "Builder",
    domain: "builder",
  });
  mockedGetThread.mockReset().mockResolvedValue({
    messages: [],
    has_more: false,
  });
  mockedPostThreadReply.mockReset().mockResolvedValue({
    channel: "C123",
    ts: "1.2",
  });
  mockedPostChannelMessage.mockReset().mockResolvedValue({
    channel: "C456",
    ts: "1.3",
  });
  mockedResolveConnectorSecret.mockReset().mockResolvedValue("xoxb-test");
});

describe("createSlackReader", () => {
  it("injects the workspace resolver with the explicit job identity", async () => {
    const reader = createSlackReader({
      ownerEmail: "Owner@Example.com",
      orgId: "org-1",
    });

    await reader.getChannelHistory("primary", "C123", 100);
    const tokenResolver = mockedGetChannelHistory.mock.calls[0]?.[4];

    expect(tokenResolver).toEqual(expect.any(Function));
    await tokenResolver?.("primary");
    expect(mockedResolveConnectorSecret).toHaveBeenCalledWith(
      "SLACK_BOT_TOKEN",
      "Owner@Example.com",
      { orgId: "org-1" },
    );

    await reader.getTeamInfo("secondary");
    const secondaryResolver = mockedGetTeamInfo.mock.calls[0]?.[1];
    await secondaryResolver?.("secondary");
    expect(mockedResolveConnectorSecret).toHaveBeenLastCalledWith(
      "SLACK_BOT_TOKEN_2",
      "Owner@Example.com",
      { orgId: "org-1" },
    );
  });

  it("reports a missing workspace credential with setup guidance", async () => {
    mockedResolveConnectorSecret.mockResolvedValue(undefined);
    const reader = createSlackReader({ ownerEmail: "owner@example.com" });

    await reader.getChannelHistory("primary", "C123");
    const tokenResolver = mockedGetChannelHistory.mock.calls[0]?.[4];

    await expect(tokenResolver?.("primary")).rejects.toThrow(
      "Connect Slack in Settings → Messaging",
    );
  });

  it("rejects a Slack credential that is not the Agent-Native bot", async () => {
    mockedAuthTest.mockResolvedValue({
      userId: "U-other",
      userName: "other-bot",
      teamId: "T1",
      teamName: "Builder",
    });
    const reader = createSlackReader({ ownerEmail: "owner@example.com" });

    await expect(reader.getChannelHistory("primary", "C123")).rejects.toThrow(
      "not @agent-native",
    );
    expect(mockedGetChannelHistory).not.toHaveBeenCalled();
  });

  it("accepts the Slack bot username without the hyphen Slack drops", async () => {
    mockedAuthTest.mockResolvedValue({
      userId: "U-agent-native",
      userName: "agentnative",
      teamId: "T1",
      teamName: "Builder",
    });
    const reader = createSlackReader({ ownerEmail: "owner@example.com" });

    await expect(
      reader.getChannelHistory("primary", "C123"),
    ).resolves.toBeDefined();
    expect(mockedGetChannelHistory).toHaveBeenCalled();
  });

  it("rejects hyphen-padded lookalikes of the Agent-Native bot handle", async () => {
    mockedAuthTest.mockResolvedValue({
      userId: "U-agent-native",
      userName: "agent--native",
      teamId: "T1",
      teamName: "Builder",
    });
    const reader = createSlackReader({ ownerEmail: "owner@example.com" });

    await expect(reader.getChannelHistory("primary", "C123")).rejects.toThrow(
      "not @agent-native",
    );
    expect(mockedGetChannelHistory).not.toHaveBeenCalled();
  });

  it("treats only the two supported Slack bot handles as Agent-Native", () => {
    expect(isAgentNativeSlackUserName("@agent-native")).toBe(true);
    expect(isAgentNativeSlackUserName("agentnative")).toBe(true);
    expect(isAgentNativeSlackUserName("agent--native")).toBe(false);
    expect(isAgentNativeSlackUserName("agent-native-")).toBe(false);
    expect(isAgentNativeSlackUserName("other-bot")).toBe(false);
  });

  it("exposes scoped thread and channel Slack writes", async () => {
    const reader = createSlackReader({ ownerEmail: "owner@example.com" });

    await reader.getThread("primary", "C123", "10.1", 50, "cursor-1");
    await reader.postThreadReply("primary", "C123", "10.1", "Acknowledged");
    await reader.postChannelMessage("secondary", "C456", "Rollup");

    const threadResolver = mockedGetThread.mock.calls[0]?.[5];
    const replyResolver = mockedPostThreadReply.mock.calls[0]?.[4];
    const channelResolver = mockedPostChannelMessage.mock.calls[0]?.[3];
    expect(threadResolver).toEqual(expect.any(Function));
    expect(replyResolver).toEqual(expect.any(Function));
    expect(channelResolver).toEqual(expect.any(Function));
    expect(mockedGetThread).toHaveBeenCalledWith(
      "primary",
      "C123",
      "10.1",
      50,
      "cursor-1",
      threadResolver,
    );
    expect(mockedPostThreadReply).toHaveBeenCalledWith(
      "primary",
      "C123",
      "10.1",
      "Acknowledged",
      replyResolver,
    );
    expect(mockedPostChannelMessage).toHaveBeenCalledWith(
      "secondary",
      "C456",
      "Rollup",
      channelResolver,
    );
  });
});

describe("createSlackWorkflowClient", () => {
  beforeEach(() => {
    vi.mocked(findUserByEmail).mockReset();
    vi.mocked(getMessagePermalink).mockReset();
  });

  it("keeps the reader and adds email lookup and permalinks, each behind the identity check", async () => {
    vi.mocked(findUserByEmail).mockResolvedValue({
      id: "U0ADA",
      isBot: false,
      deleted: false,
    });
    vi.mocked(getMessagePermalink).mockResolvedValue("https://slack.test/p1");
    const client = createSlackWorkflowClient({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });

    await expect(
      client.findUserByEmail("primary", "ada@example.com"),
    ).resolves.toMatchObject({ id: "U0ADA" });
    await expect(
      client.getMessagePermalink("primary", "C123", "10.1"),
    ).resolves.toBe("https://slack.test/p1");
    await client.postThreadReply("primary", "C123", "10.1", "Hi");

    expect(mockedAuthTest).toHaveBeenCalledTimes(1);
    const resolver = vi.mocked(findUserByEmail).mock.calls[0]?.[2];
    await resolver?.("primary");
    expect(mockedResolveConnectorSecret).toHaveBeenCalledWith(
      "SLACK_BOT_TOKEN",
      "owner@example.com",
      { orgId: "org-1" },
    );
    expect(mockedPostThreadReply).toHaveBeenCalled();
  });

  it("refuses to look anyone up with a credential that is not the Agent-Native bot", async () => {
    mockedAuthTest.mockResolvedValue({
      userId: "U-other",
      userName: "other-bot",
      teamId: "T1",
      teamName: "Builder",
    });
    const client = createSlackWorkflowClient({
      ownerEmail: "owner@example.com",
    });

    await expect(
      client.findUserByEmail("primary", "ada@example.com"),
    ).rejects.toThrow("not @agent-native");
    await expect(
      client.getMessagePermalink("primary", "C123", "10.1"),
    ).rejects.toThrow("not @agent-native");
    expect(vi.mocked(findUserByEmail)).not.toHaveBeenCalled();
  });

  it("completes a thread through the spread reader", async () => {
    mockedGetThread.mockResolvedValue({
      messages: [{ type: "message", text: "a", ts: "10.1" }],
      has_more: false,
    });
    const client = createSlackWorkflowClient({
      ownerEmail: "owner@example.com",
    });

    await expect(
      client.getCompleteThread("primary", "C123", "10.1"),
    ).resolves.toMatchObject({ hasMore: false });
  });
});
