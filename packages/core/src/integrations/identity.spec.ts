import { beforeEach, describe, expect, it, vi } from "vitest";

const getInstallationMock = vi.hoisted(() => vi.fn());
const getInstallationByKeyMock = vi.hoisted(() => vi.fn());
const upsertIdentityMock = vi.hoisted(() => vi.fn());
const membershipRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const membershipExecuteMock = vi.hoisted(() =>
  vi.fn(async () => ({ rows: membershipRows })),
);

vi.mock("./installations-store.js", () => ({
  getActiveIntegrationInstallationByKey: getInstallationByKeyMock,
  getActiveIntegrationInstallationForTenant: getInstallationMock,
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: membershipExecuteMock }),
}));
vi.mock("./identity-links-store.js", () => ({
  upsertVerifiedIntegrationIdentity: upsertIdentityMock,
}));

const {
  IntegrationIdentityDeclinedError,
  resolveDefaultIntegrationExecutionContext,
} = await import("./identity.js");

function slackMessage(
  overrides: Partial<{
    senderEmail: string;
    senderVerified: boolean;
    memberType: "member" | "guest" | "external";
    actorVerified: boolean;
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
      verified: overrides.actorVerified ?? true,
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
    membershipExecuteMock.mockReset();
    membershipExecuteMock.mockImplementation(async () => ({
      rows: membershipRows,
    }));
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

  it("runs a hydrated member with an unverified email as the anonymous org-scoped principal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });

    await expect(
      resolveDefaultIntegrationExecutionContext(
        slackMessage({ senderVerified: false }),
      ),
    ).resolves.toEqual({
      ownerEmail: "integration@slack",
      orgId: "org-1",
      principalType: "service",
      installationId: "installation-1",
      anonymousMember: true,
    });
    expect(upsertIdentityMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "anonymous org-scoped principal used: platform=slack teamId=T123 emailPresent=true memberType=member",
      ),
    );
    warn.mockRestore();
  });

  it("declines a DM when identity hydration failed entirely", async () => {
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });

    await expect(
      resolveDefaultIntegrationExecutionContext(
        slackMessage({ actorVerified: false }),
      ),
    ).rejects.toMatchObject({
      name: "IntegrationIdentityDeclinedError",
      userFacingMessage: expect.stringContaining("try again in a moment"),
    });
    expect(upsertIdentityMock).not.toHaveBeenCalled();
  });

  it("declines guest and external members instead of granting the anonymous tier", async () => {
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });

    for (const memberType of ["guest", "external"] as const) {
      const error = await resolveDefaultIntegrationExecutionContext(
        slackMessage({ memberType }),
      ).then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(IntegrationIdentityDeclinedError);
      expect(
        (error as InstanceType<typeof IntegrationIdentityDeclinedError>)
          .userFacingMessage,
      ).toContain("only available to members");
    }
    expect(upsertIdentityMock).not.toHaveBeenCalled();
  });

  it("declines a DM from a workspace that is not connected to an organization", async () => {
    await expect(
      resolveDefaultIntegrationExecutionContext(slackMessage()),
    ).rejects.toMatchObject({
      name: "IntegrationIdentityDeclinedError",
      userFacingMessage: expect.stringContaining(
        "isn't connected to an organization",
      ),
    });
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

  it("runs a verified email that is not an org member as the anonymous org-scoped principal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });

    await expect(
      resolveDefaultIntegrationExecutionContext(slackMessage()),
    ).resolves.toEqual({
      ownerEmail: "integration@slack",
      orgId: "org-1",
      principalType: "service",
      installationId: "installation-1",
      anonymousMember: true,
    });
    expect(upsertIdentityMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("declines instead of widening access when org membership lookup fails", async () => {
    getInstallationMock.mockResolvedValue({
      id: "installation-1",
      orgId: "org-1",
    });
    membershipExecuteMock.mockRejectedValueOnce(new Error("database offline"));

    await expect(
      resolveDefaultIntegrationExecutionContext(slackMessage()),
    ).rejects.toMatchObject({
      name: "IntegrationIdentityDeclinedError",
      userFacingMessage: expect.stringContaining("try again in a moment"),
    });
    expect(upsertIdentityMock).not.toHaveBeenCalled();
  });
});
