import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const pollSlackChannelMock = vi.hoisted(() => vi.fn());
const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());

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
        {},
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
});
