import { beforeEach, describe, expect, it, vi } from "vitest";

const getInstallationMock = vi.hoisted(() => vi.fn());
const getInstallationByKeyMock = vi.hoisted(() => vi.fn());
const upsertIdentityMock = vi.hoisted(() => vi.fn());
const membershipRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("./installations-store.js", () => ({
  getActiveIntegrationInstallationByKey: getInstallationByKeyMock,
  getActiveIntegrationInstallationForTenant: getInstallationMock,
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: vi.fn(async () => ({ rows: membershipRows })) }),
}));
vi.mock("./identity-links-store.js", () => ({
  upsertVerifiedIntegrationIdentity: upsertIdentityMock,
}));

const { resolveDefaultIntegrationExecutionContext } =
  await import("./identity.js");

function slackMessage(
  overrides: Partial<{
    senderEmail: string;
    senderVerified: boolean;
    memberType: "member" | "guest" | "external";
    conversationType: "dm" | "channel";
  }> = {},
) {
  return {
    platform: "slack",
    externalThreadId: "A123:T123:D123:1.2",
    text: "hello",
    senderId: "U123",
    tenantId: "T123",
    conversationType: overrides.conversationType ?? "dm",
    senderEmail: overrides.senderEmail ?? "alice@example.test",
    senderVerified: overrides.senderVerified ?? true,
    actorTrust: {
      memberType: overrides.memberType ?? "member",
      verified: true,
    },
    platformContext: { teamId: "T123" },
    timestamp: Date.now(),
  } as any;
}

describe("resolveDefaultIntegrationExecutionContext", () => {
  beforeEach(() => {
    getInstallationMock.mockReset();
    getInstallationByKeyMock.mockReset();
    membershipRows.length = 0;
    upsertIdentityMock.mockReset();
  });

  it("runs a verified Slack DM as the linked Agent Native user", async () => {
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });
    membershipRows.push({ one: 1 });
    upsertIdentityMock.mockResolvedValue({
      id: "link-1",
      platform: "slack",
      tenantId: "T123",
      externalUserId: "U123",
      userEmail: "alice@example.test",
      orgId: "org-1",
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(
      resolveDefaultIntegrationExecutionContext(slackMessage()),
    ).resolves.toEqual({
      ownerEmail: "alice@example.test",
      orgId: "org-1",
      principalType: "user",
      installationId: "installation-1",
    });
    expect(upsertIdentityMock).toHaveBeenCalledWith({
      platform: "slack",
      tenantId: "T123",
      externalUserId: "U123",
      userEmail: "alice@example.test",
      orgId: "org-1",
    });
  });

  it("rejects an unverified DM instead of using a service principal", async () => {
    await expect(
      resolveDefaultIntegrationExecutionContext(
        slackMessage({ senderVerified: false }),
      ),
    ).rejects.toThrow("could not be verified");
    expect(upsertIdentityMock).not.toHaveBeenCalled();
  });

  it("keeps shared channels on a service principal", async () => {
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });

    await expect(
      resolveDefaultIntegrationExecutionContext(
        slackMessage({ conversationType: "channel" }),
      ),
    ).resolves.toEqual({
      ownerEmail: "integration@slack",
      orgId: "org-1",
      principalType: "service",
      installationId: "installation-1",
    });
    expect(upsertIdentityMock).not.toHaveBeenCalled();
  });

  it("rejects a Slack member from a different Agent Native organization", async () => {
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });
    await expect(
      resolveDefaultIntegrationExecutionContext(slackMessage()),
    ).rejects.toThrow("not a member");
    expect(upsertIdentityMock).not.toHaveBeenCalled();
  });
});
