import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConnectorSecret } from "../connectors/credentials.js";
import { getChannelHistory, getTeamInfo } from "../connectors/slack.js";
import { createSlackReader } from "./slack-client";

vi.mock("../connectors/slack.js", () => ({
  getChannelHistory: vi.fn(),
  getTeamInfo: vi.fn(),
}));

vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: vi.fn(),
}));

const mockedGetChannelHistory = vi.mocked(getChannelHistory);
const mockedGetTeamInfo = vi.mocked(getTeamInfo);
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
});
