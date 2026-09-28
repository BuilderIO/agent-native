import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roles: new Map<string, string>(),
  disconnect: vi.fn(),
  status: vi.fn(),
  defaultModel: vi.fn(),
}));

vi.mock("../../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async (_orgId: string, email: string) =>
    mocks.roles.get(email) ?? null,
}));

vi.mock("../../server/core-routes-plugin.js", () => ({
  disconnectBuilderConnectionAtScope: mocks.disconnect,
  resolveBuilderConnectionsStatus: mocks.status,
}));

vi.mock("../../secrets/usage.js", () => ({
  describeBuilderDefaultModel: mocks.defaultModel,
}));

const { default: action } = await import("./manage-builder-connection.js");

const ORG = "org-1";
const ADMIN = "admin@example.com";
const MEMBER = "member@example.com";

function ctx(userEmail: string | undefined, orgId: string | null = ORG) {
  return {
    caller: "tool" as const,
    actionName: "manage-builder-connection",
    userEmail,
    orgId,
    appId: "clips",
  };
}

describe("manage-builder-connection", () => {
  beforeEach(() => {
    mocks.roles.clear();
    mocks.roles.set(ADMIN, "admin");
    mocks.roles.set(MEMBER, "member");
    mocks.disconnect.mockReset();
    mocks.disconnect.mockImplementation(
      async (input: { role: string | null; scope: "org" | "personal" }) =>
        input.scope === "org" && input.role !== "admin"
          ? {
              status: 403,
              body: { error: "Only owners and admins can do that." },
            }
          : { status: 200, body: { ok: true, scope: input.scope } },
    );
    mocks.status.mockReset();
    mocks.status.mockResolvedValue({
      grants: { org: { connectedAt: 1, needsReconnect: false, kind: "oauth" } },
      canConnect: { org: true, personal: false },
    });
    mocks.defaultModel.mockReset();
    mocks.defaultModel.mockResolvedValue({
      status: "builder",
      model: "claude-sonnet-4-5",
      whenDisconnected: { status: "stops" },
    });
  });

  it("reads the connections with the caller's stored role and the default model", async () => {
    const state = await action.run({}, ctx(ADMIN));

    expect(mocks.status).toHaveBeenCalledWith({
      ownerEmail: ADMIN,
      orgId: ORG,
      role: "admin",
    });
    expect(mocks.defaultModel).toHaveBeenCalledWith("clips");
    expect(state).toEqual({
      grants: { org: { connectedAt: 1, needsReconnect: false, kind: "oauth" } },
      canConnect: { org: true, personal: false },
      defaultModel: {
        status: "builder",
        model: "claude-sonnet-4-5",
        whenDisconnected: { status: "stops" },
      },
    });
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("reports an unreadable default model instead of dropping it", async () => {
    mocks.defaultModel.mockRejectedValue(new Error("settings store down"));

    const state = await action.run({}, ctx(MEMBER));

    expect(state).toMatchObject({
      grants: expect.any(Object),
      defaultModel: { status: "unknown", error: "settings store down" },
    });
  });

  it("refuses a member's organization disconnect on the server", async () => {
    await expect(
      action.run({ disconnect: "org" }, ctx(MEMBER)),
    ).rejects.toMatchObject({
      message: "Only owners and admins can do that.",
      statusCode: 403,
      errorCode: "builder_org_connection_admin_required",
    });
    expect(mocks.disconnect).toHaveBeenCalledWith({
      email: MEMBER,
      orgId: ORG,
      role: "member",
      scope: "org",
    });
  });

  it("disconnects the organization connection for an admin", async () => {
    await expect(
      action.run({ disconnect: "org" }, ctx(ADMIN)),
    ).resolves.toEqual({ disconnected: "org" });
  });

  it("disconnects a caller's own connection without an organization", async () => {
    mocks.disconnect.mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        scope: "personal",
        remoteRevoked: false,
        warning: "Local Builder access was removed.",
      },
    });

    await expect(
      action.run({ disconnect: "personal" }, ctx(MEMBER, null)),
    ).resolves.toEqual({
      disconnected: "personal",
      remoteRevoked: false,
      warning: "Local Builder access was removed.",
    });
    expect(mocks.disconnect).toHaveBeenCalledWith({
      email: MEMBER,
      orgId: null,
      role: null,
      scope: "personal",
    });
  });

  it("turns a missing connection into a not-found failure", async () => {
    mocks.disconnect.mockResolvedValue({
      status: 409,
      body: { error: "No personal Builder.io connection was found." },
    });

    await expect(
      action.run({ disconnect: "personal" }, ctx(MEMBER)),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "builder_connection_not_found",
    });
  });

  it("requires a signed-in caller", async () => {
    await expect(action.run({}, ctx(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
