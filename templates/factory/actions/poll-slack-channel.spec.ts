import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeFactoryPollCursor } from "../server/lib/factory-poll-cursors.js";

const getDbMock = vi.hoisted(() => vi.fn());
const pollSlackChannelMock = vi.hoisted(() => vi.fn());
const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());
const readCallingFactoryAutomationMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  orgMembers: {
    email: "email",
    orgId: "org_id",
    role: "role",
  },
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../server/triage/slack-poller.js", () => ({
  pollSlackChannel: pollSlackChannelMock,
}));

vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: requireFactoryAutomationMock,
}));

vi.mock("../server/lib/factory-automation-repair.js", () => ({
  repairFactoryAutomationsFromConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: readCallingFactoryAutomationMock,
}));

vi.mock("../server/lib/factory-poll-cursors.js", () => ({
  readFactoryPollCursor: vi.fn().mockResolvedValue(null),
  writeFactoryPollCursor: vi.fn().mockResolvedValue(undefined),
}));

const mockedGetRequestOrgId = vi.mocked(getRequestOrgId);
const mockedGetRequestUserEmail = vi.mocked(getRequestUserEmail);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetRequestOrgId.mockReturnValue(undefined);
  mockedGetRequestUserEmail.mockReturnValue(undefined);
  pollSlackChannelMock.mockResolvedValue({
    envelopes: [],
    hasMore: false,
    nextHistoryCursor: null,
    nextLastSlackTs: "10.0",
  });
  requireFactoryAutomationMock.mockResolvedValue(undefined);
  readCallingFactoryAutomationMock.mockResolvedValue(null);

  const limit = vi
    .fn()
    .mockResolvedValueOnce([{ role: "owner" }])
    .mockResolvedValueOnce([
      {
        id: "org-1",
        slackWorkspace: "primary",
        slackChannelId: "C123",
        pollingEnabled: 1,
        lastSlackTs: "0",
        slackHistoryCursor: null,
      },
    ]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "product-feedback" }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
  getDbMock.mockReturnValue({
    select: vi.fn().mockReturnValue({ from }),
    transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  });
});

describe("poll-slack-channel action", () => {
  it("uses the supplied automation identity without an HTTP request context", async () => {
    const { default: action } = await import("./poll-slack-channel.js");

    await expect(
      action.run(
        { factoryId: "product-feedback" },
        {
          caller: "automation",
          userEmail: "Owner@Example.com",
          orgId: "org-1",
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      observed: 0,
      nextLastSlackTs: "10.0",
    });

    expect(mockedGetRequestUserEmail).not.toHaveBeenCalled();
    expect(mockedGetRequestOrgId).not.toHaveBeenCalled();
    expect(requireFactoryAutomationMock).toHaveBeenCalledWith(
      {
        caller: "automation",
        userEmail: "Owner@Example.com",
        orgId: "org-1",
      },
      { userEmail: "owner@example.com", orgId: "org-1" },
      "sourcePolling",
      "product-feedback",
    );
    expect(pollSlackChannelMock).toHaveBeenCalledWith({
      workspace: "primary",
      channelId: "C123",
      priorLastSlackTs: "0",
      historyCursor: null,
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
  });

  it("does not add Slack authors excluded by the calling job", async () => {
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factory-slack-feedback",
      content: "",
      config: {
        source: "slack",
        slackChannelId: "C123",
        authorMode: "exclude",
        authorIds: ["U123"],
        inboxLimit: 25,
      },
    });
    pollSlackChannelMock.mockResolvedValue({
      envelopes: [
        {
          source: "slack",
          externalId: "msg-1",
          title: "skip me",
          metadata: { authorId: "U123", messageTs: "11.0" },
        },
      ],
      hasMore: false,
      nextHistoryCursor: null,
      nextLastSlackTs: "11.0",
    });

    const { default: action } = await import("./poll-slack-channel.js");
    await expect(
      action.run(
        { factoryId: "product-feedback" },
        {
          caller: "automation",
          userEmail: "Owner@Example.com",
          orgId: "org-1",
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      observed: 0,
      nextLastSlackTs: "11.0",
    });
  });

  it("advances the Slack history cursor after author-filtered pages", async () => {
    readCallingFactoryAutomationMock.mockResolvedValue({
      name: "factory-slack-feedback",
      content: "",
      config: {
        source: "slack",
        slackChannelId: "C123",
        authorMode: "exclude",
        authorIds: ["U123"],
        inboxLimit: 25,
      },
    });
    pollSlackChannelMock.mockResolvedValue({
      envelopes: [
        {
          source: "slack",
          externalId: "msg-1",
          title: "skip me",
          metadata: { authorId: "U123", messageTs: "11.0" },
        },
      ],
      hasMore: false,
      nextHistoryCursor: "page-2",
      nextLastSlackTs: "11.0",
    });

    const { default: action } = await import("./poll-slack-channel.js");
    await expect(
      action.run(
        { factoryId: "product-feedback" },
        {
          caller: "automation",
          userEmail: "Owner@Example.com",
          orgId: "org-1",
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      nextHistoryCursor: "page-2",
    });
    expect(writeFactoryPollCursor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slackHistoryCursor: "page-2" }),
    );
  });
});
