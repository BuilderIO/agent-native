import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const pollSlackChannelMock = vi.hoisted(() => vi.fn());
const readNewestSlackTsMock = vi.hoisted(() => vi.fn());
const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());
const readCallingFactoryAutomationMock = vi.hoisted(() => vi.fn());
const readFactoryPollCursorMock = vi.hoisted(() => vi.fn());
const writeFactoryPollCursorMock = vi.hoisted(() => vi.fn());
const recordFactoryAuditMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: vi.fn().mockResolvedValue("owner"),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));
vi.mock("@agent-native/core/org", () => ({
  orgMembers: { email: "email", orgId: "org_id", role: "role" },
  resolveOrgIdForEmail: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({ getDb: getDbMock }));
vi.mock("../server/triage/slack-poller.js", () => ({
  pollSlackChannel: pollSlackChannelMock,
  readNewestSlackTs: readNewestSlackTsMock,
}));
vi.mock("../server/triage/audit.js", () => ({
  recordFactoryAudit: recordFactoryAuditMock,
}));
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: requireFactoryAutomationMock,
}));
vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: readCallingFactoryAutomationMock,
}));
vi.mock("../server/lib/factory-poll-cursors.js", () => ({
  readFactoryPollCursor: readFactoryPollCursorMock,
  writeFactoryPollCursor: writeFactoryPollCursorMock,
}));

const context = {
  caller: "automation",
  userEmail: "owner@example.com",
  orgId: "org-1",
};

const envelope = (ts: string) => ({
  source: "slack",
  externalId: `C123:${ts}`,
  title: `Slack user U1 ${ts}`,
  summary: `message ${ts}`,
  channelId: "C123",
  threadTs: ts,
  coverage: "complete",
  metadata: { messageTs: ts, authorId: "U1", author: "U1" },
});

async function run(input: Record<string, unknown>) {
  const { default: action } = await import("./poll-slack-channel.js");
  return action.run(
    { factoryId: "product-feedback", ...input } as never,
    context,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireFactoryAutomationMock.mockResolvedValue(undefined);
  readCallingFactoryAutomationMock.mockResolvedValue({
    config: {
      slackChannelId: "C123",
      authorMode: "exclude",
      authorIds: [],
      inboxLimit: 25,
    },
  });
  readFactoryPollCursorMock.mockResolvedValue({
    lastSlackTs: "50.0",
    slackHistoryCursor: "page-2",
  });
  pollSlackChannelMock.mockResolvedValue({
    envelopes: [],
    hasMore: false,
    nextHistoryCursor: null,
    nextLastSlackTs: "90.0",
  });
  readNewestSlackTsMock.mockResolvedValue("200.000100");
  insertMock.mockReturnValue({
    values: () => ({ onConflictDoUpdate: async () => undefined }),
  });
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: insertMock,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  transactionMock.mockImplementation(
    async (callback: (value: unknown) => unknown) => callback(tx),
  );
  // The first read is the factory's config row; every read after it is a lookup of an item, and the inbox holds none.
  let reads = 0;
  getDbMock.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            reads += 1;
            return reads === 1
              ? [
                  {
                    id: "org-1",
                    slackWorkspace: "primary",
                    slackChannelId: "C123",
                  },
                ]
              : [];
          },
        }),
      }),
    }),
    transaction: transactionMock,
  });
});

describe("poll-slack-channel for a workflow source", () => {
  it("takes the newest position only when asked to prime: no history, no row, no cursor", async () => {
    const result = await run({ prime: true });

    expect(result).toMatchObject({
      ok: true,
      primed: true,
      observed: 0,
      position: "200.000100",
    });
    expect(readNewestSlackTsMock).toHaveBeenCalledTimes(1);
    expect(pollSlackChannelMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(readFactoryPollCursorMock).not.toHaveBeenCalled();
    expect(writeFactoryPollCursorMock).not.toHaveBeenCalled();
  });

  it("says position 0, an explicit value, for a channel with no message yet", async () => {
    readNewestSlackTsMock.mockResolvedValue(null);

    await expect(run({ prime: true })).resolves.toMatchObject({
      primed: true,
      position: "0",
    });
  });

  it("reads only what came after its own position and leaves the factory-wide cursor alone", async () => {
    pollSlackChannelMock.mockResolvedValue({
      envelopes: [envelope("120.000100")],
      hasMore: false,
      nextHistoryCursor: null,
      nextLastSlackTs: "120.000100",
    });

    const result = await run({ after: "100.000100" });

    expect(pollSlackChannelMock).toHaveBeenCalledWith({
      workspace: "primary",
      channelId: "C123",
      priorLastSlackTs: "100.000100",
      historyCursor: undefined,
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(result).toMatchObject({
      ok: true,
      observed: 1,
      position: "120.000100",
    });
    expect(readFactoryPollCursorMock).not.toHaveBeenCalled();
    expect(writeFactoryPollCursorMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("stores nothing in a preview, and hands back the rows it would have stored", async () => {
    pollSlackChannelMock.mockResolvedValue({
      envelopes: [envelope("120.000100"), envelope("121.000100")],
      hasMore: false,
      nextHistoryCursor: null,
      nextLastSlackTs: "121.000100",
    });

    const result = await run({ after: "100.000100", preview: true });

    expect(result).toMatchObject({
      ok: true,
      preview: true,
      observed: 2,
      previewTotal: 2,
    });
    expect(
      (result as { previewRows: { externalId: string }[] }).previewRows.map(
        (row) => row.externalId,
      ),
    ).toEqual(["C123:120.000100", "C123:121.000100"]);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(writeFactoryPollCursorMock).not.toHaveBeenCalled();
    expect(recordFactoryAuditMock).not.toHaveBeenCalled();
  });

  it("previews the newest messages, whatever any cursor says, when asked to prime and preview", async () => {
    await run({ prime: true, preview: true });

    expect(readNewestSlackTsMock).not.toHaveBeenCalled();
    expect(pollSlackChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        priorLastSlackTs: "0",
        historyCursor: undefined,
        newest: 25,
      }),
    );
    expect(readFactoryPollCursorMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses a call that asks for both", async () => {
    await expect(run({ prime: true, after: "100.0" })).rejects.toThrow(
      /either after .* or prime/,
    );
  });

  it("is the read it always was for a caller that asks for none of this", async () => {
    await run({});

    expect(pollSlackChannelMock).toHaveBeenCalledWith({
      workspace: "primary",
      channelId: "C123",
      priorLastSlackTs: "50.0",
      historyCursor: "page-2",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(writeFactoryPollCursorMock).toHaveBeenCalledTimes(1);
    expect(recordFactoryAuditMock).toHaveBeenCalled();
  });
});
