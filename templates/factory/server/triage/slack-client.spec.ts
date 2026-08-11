import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConnectorSecret } from "../connectors/credentials.js";
import {
  addEyesReaction,
  getChannelHistory,
  getTeamInfo,
  getThread,
  postThreadReply,
} from "../connectors/slack.js";
import { createSlackReader } from "./slack-client";

vi.mock("../connectors/slack.js", () => ({
  addEyesReaction: vi.fn(),
  getChannelHistory: vi.fn(),
  getTeamInfo: vi.fn(),
  getThread: vi.fn(),
  postThreadReply: vi.fn(),
}));

vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: vi.fn(),
}));

const mockedGetChannelHistory = vi.mocked(getChannelHistory);
const mockedGetTeamInfo = vi.mocked(getTeamInfo);
const mockedGetThread = vi.mocked(getThread);
const mockedAddEyesReaction = vi.mocked(addEyesReaction);
const mockedPostThreadReply = vi.mocked(postThreadReply);
const mockedResolveConnectorSecret = vi.mocked(resolveConnectorSecret);

beforeEach(() => {
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
  mockedAddEyesReaction.mockReset().mockResolvedValue({
    added: true,
    already_present: false,
  });
  mockedPostThreadReply.mockReset().mockResolvedValue({
    channel: "C123",
    ts: "1.2",
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

  it("exposes bounded thread reads and the two typed write methods", async () => {
    const reader = createSlackReader({ ownerEmail: "owner@example.com" });

    await reader.getThread("primary", "C123", "10.1", 50, "cursor-1");
    await reader.addEyesReaction("primary", "C123", "10.1");
    await reader.postThreadReply("primary", "C123", "10.1", "Acknowledged");

    const threadResolver = mockedGetThread.mock.calls[0]?.[5];
    const reactionResolver = mockedAddEyesReaction.mock.calls[0]?.[3];
    const replyResolver = mockedPostThreadReply.mock.calls[0]?.[4];
    expect(threadResolver).toEqual(expect.any(Function));
    expect(reactionResolver).toEqual(expect.any(Function));
    expect(replyResolver).toEqual(expect.any(Function));
    expect(mockedGetThread).toHaveBeenCalledWith(
      "primary",
      "C123",
      "10.1",
      50,
      "cursor-1",
      threadResolver,
    );
    expect(mockedAddEyesReaction).toHaveBeenCalledWith(
      "primary",
      "C123",
      "10.1",
      reactionResolver,
    );
    expect(mockedPostThreadReply).toHaveBeenCalledWith(
      "primary",
      "C123",
      "10.1",
      "Acknowledged",
      replyResolver,
    );
  });
});
