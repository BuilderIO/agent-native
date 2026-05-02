import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "@agent-native/core/server";

const resolveLinkedOwnerMock = vi.hoisted(() => vi.fn());
const consumeLinkTokenMock = vi.hoisted(() => vi.fn());

vi.mock("./dispatch-store.js", () => ({
  resolveLinkedOwner: resolveLinkedOwnerMock,
  consumeLinkToken: consumeLinkTokenMock,
}));

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: "slack",
    externalThreadId: "thread-qa",
    senderId: "UQA",
    senderName: "QA User",
    text: "hello",
    platformContext: { teamId: "TQA" },
    timestamp: 1001,
    ...overrides,
  };
}

describe("dispatch integration owner resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveLinkedOwnerMock.mockReset();
    consumeLinkTokenMock.mockReset();
    delete process.env.DISPATCH_DEFAULT_OWNER_EMAIL;
  });

  afterEach(() => {
    delete process.env.DISPATCH_DEFAULT_OWNER_EMAIL;
  });

  it("keeps linked Slack identities ahead of the default owner", async () => {
    process.env.DISPATCH_DEFAULT_OWNER_EMAIL = "default+qa@builder.io";
    resolveLinkedOwnerMock.mockResolvedValue("linked+qa@builder.io");
    const { resolveDispatchOwner } = await import("./dispatch-integrations.js");

    await expect(resolveDispatchOwner(incoming())).resolves.toBe(
      "linked+qa@builder.io",
    );
  });

  it("uses the configured default owner for unlinked Slack users", async () => {
    process.env.DISPATCH_DEFAULT_OWNER_EMAIL = "default+qa@builder.io";
    resolveLinkedOwnerMock.mockResolvedValue(null);
    const { resolveDispatchOwner } = await import("./dispatch-integrations.js");

    await expect(resolveDispatchOwner(incoming())).resolves.toBe(
      "default+qa@builder.io",
    );
  });

  it("falls back to a synthetic owner when the default owner is absent or invalid", async () => {
    process.env.DISPATCH_DEFAULT_OWNER_EMAIL = "not-an-email";
    resolveLinkedOwnerMock.mockResolvedValue(null);
    const { resolveDispatchOwner } = await import("./dispatch-integrations.js");

    const owner = await resolveDispatchOwner(incoming());

    expect(owner).toMatch(/^dispatch\+[a-f0-9]{16}@integration\.local$/);
  });

  it("uses sender email as the owner for inbound email", async () => {
    process.env.DISPATCH_DEFAULT_OWNER_EMAIL = "default+qa@builder.io";
    resolveLinkedOwnerMock.mockResolvedValue(null);
    const { resolveDispatchOwner } = await import("./dispatch-integrations.js");

    await expect(
      resolveDispatchOwner(
        incoming({
          platform: "email",
          senderId: "sender+qa@example.com",
          senderEmail: "sender+qa@example.com",
          platformContext: {},
        }),
      ),
    ).resolves.toBe("sender+qa@example.com");
  });
});
