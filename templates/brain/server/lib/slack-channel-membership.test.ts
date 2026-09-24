import { describe, expect, it, vi } from "vitest";

import { ensureSlackPublicChannelMembership } from "./slack-channel-membership.js";

describe("ensureSlackPublicChannelMembership", () => {
  it("joins a public channel that the bot has not joined", async () => {
    const joinChannel = vi.fn(async () => ({ ok: true }));

    await expect(
      ensureSlackPublicChannelMembership(
        { id: "C_PUBLIC", is_channel: true, is_member: false },
        joinChannel,
      ),
    ).resolves.toBe("joined");
    expect(joinChannel).toHaveBeenCalledWith("C_PUBLIC");
  });

  it("does not mutate membership for private channels", async () => {
    const joinChannel = vi.fn(async () => ({ ok: true }));

    await expect(
      ensureSlackPublicChannelMembership(
        {
          id: "G_PRIVATE",
          is_group: true,
          is_private: true,
          is_member: false,
        },
        joinChannel,
      ),
    ).resolves.toBe("not_public");
    expect(joinChannel).not.toHaveBeenCalled();
  });

  it("skips the join call when Slack already reports membership", async () => {
    const joinChannel = vi.fn(async () => ({ ok: true }));

    await expect(
      ensureSlackPublicChannelMembership(
        { id: "C_JOINED", is_channel: true, is_member: true },
        joinChannel,
      ),
    ).resolves.toBe("already_member");
    expect(joinChannel).not.toHaveBeenCalled();
  });

  it("does not mutate membership when Slack omits membership state", async () => {
    const joinChannel = vi.fn(async () => ({ ok: true }));

    await expect(
      ensureSlackPublicChannelMembership(
        { id: "C_UNKNOWN", is_channel: true },
        joinChannel,
      ),
    ).resolves.toBe("membership_unknown");
    expect(joinChannel).not.toHaveBeenCalled();
  });

  it("tolerates Slack's already_in_channel response", async () => {
    await expect(
      ensureSlackPublicChannelMembership(
        { id: "C_JOINED", is_channel: true, is_member: false },
        async () => ({ ok: false, error: "already_in_channel" }),
      ),
    ).resolves.toBe("already_member");
  });

  it("surfaces other join failures", async () => {
    await expect(
      ensureSlackPublicChannelMembership(
        { id: "C_DENIED", is_channel: true, is_member: false },
        async () => ({ ok: false, error: "missing_scope" }),
      ),
    ).rejects.toThrow("Slack conversations.join failed: missing_scope");
  });
});
