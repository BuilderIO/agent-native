// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  orgId: "org-alpha",
  orgRole: "admin" as "owner" | "admin" | "member",
  settings: new Map<string, Record<string, unknown>>(),
  secrets: new Map<string, string>(),
  writtenSecrets: [] as Array<{ key: string; scope: string; scopeId: string }>,
  deletedSecrets: [] as Array<{ key: string; scope: string; scopeId: string }>,
  mutateHook: null as null | (() => void),
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: vi.fn(async (orgId: string, key: string) => {
    return state.settings.get(`${orgId}:${key}`) ?? null;
  }),
  mutateOrgSetting: vi.fn(
    async (
      orgId: string,
      key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown>,
    ) => {
      state.mutateHook?.();
      const mapKey = `${orgId}:${key}`;
      const next = updater(state.settings.get(mapKey) ?? null);
      state.settings.set(mapKey, next);
      return next;
    },
  ),
}));

vi.mock("@agent-native/core/secrets", () => ({
  writeAppSecret: vi.fn(
    async (input: {
      key: string;
      scope: string;
      scopeId: string;
      value: string;
    }) => {
      state.writtenSecrets.push({
        key: input.key,
        scope: input.scope,
        scopeId: input.scopeId,
      });
      state.secrets.set(
        `${input.scope}:${input.scopeId}:${input.key}`,
        input.value,
      );
      return input.key;
    },
  ),
  deleteAppSecret: vi.fn(
    async (input: { key: string; scope: string; scopeId: string }) => {
      state.deletedSecrets.push(input);
      state.secrets.delete(`${input.scope}:${input.scopeId}:${input.key}`);
    },
  ),
}));

vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi.fn(async () => ({
    ownerEmail: "admin@example.com",
    orgId: state.orgId,
    membership: {
      id: state.orgId,
      memberId: "m-1",
      name: "Test Workspace",
      role: state.orgRole,
    },
    access: { status: "assigned", orgRole: state.orgRole },
  })),
  isWorkspaceAdministrator: (current: { access: { orgRole: string } }) =>
    current.access.orgRole === "owner" || current.access.orgRole === "admin",
}));

describe("get-workspace-ssh-key action", () => {
  beforeEach(() => {
    state.orgId = "org-alpha";
    state.orgRole = "admin";
    state.settings.clear();
    state.secrets.clear();
    state.writtenSecrets.length = 0;
    state.deletedSecrets.length = 0;
    state.mutateHook = null;
  });

  it("generates a valid OpenSSH ed25519 key once per workspace and persists private key only in vault", async () => {
    const action = (await import("./get-workspace-ssh-key.js")).default;
    const first = await action.run({});

    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(first.sshPublicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+=*$/);
    expect(Object.keys(first).sort()).toEqual(["id", "sshPublicKey"]);

    const wire = Buffer.from(first.sshPublicKey.split(" ")[1]!, "base64");
    const typeLen = wire.readUInt32BE(0);
    expect(wire.subarray(4, 4 + typeLen).toString("ascii")).toBe("ssh-ed25519");
    const pubLen = wire.readUInt32BE(4 + typeLen);
    expect(pubLen).toBe(32);
    expect(wire.length).toBe(4 + typeLen + 4 + pubLen);

    const storedSetting = state.settings.get(
      "org-alpha:analytics.workspaceSshKey",
    );
    expect(storedSetting?.id).toBe(first.id);
    expect(storedSetting?.sshPublicKey).toBe(first.sshPublicKey);
    expect(JSON.stringify(storedSetting)).not.toContain("PRIVATE KEY");

    expect(state.writtenSecrets).toHaveLength(1);
    expect(state.writtenSecrets[0]?.scope).toBe("org");
    expect(state.writtenSecrets[0]?.scopeId).toBe("org-alpha");
    const storedPrivate = state.secrets.get(
      `org:org-alpha:${state.writtenSecrets[0]!.key}`,
    );
    expect(storedPrivate).toContain("BEGIN PRIVATE KEY");

    const second = await action.run({});
    expect(second).toEqual(first);
    expect(state.writtenSecrets).toHaveLength(1);
  });

  it("isolates SSH keys per organization", async () => {
    const action = (await import("./get-workspace-ssh-key.js")).default;
    const alpha = await action.run({});
    state.orgId = "org-beta";
    const beta = await action.run({});
    expect(beta.id).not.toBe(alpha.id);
    expect(beta.sshPublicKey).not.toBe(alpha.sshPublicKey);
  });

  it("cleans up losing private key if another request initializes first", async () => {
    const action = (await import("./get-workspace-ssh-key.js")).default;
    const winner = {
      id: "11111111-1111-4111-8111-111111111111",
      sshPublicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWinnerKeyForRaceTestOnly",
      createdAt: "2026-11-22T00:00:00.000Z",
    };
    state.mutateHook = () => {
      state.settings.set("org-alpha:analytics.workspaceSshKey", winner);
    };

    const result = await action.run({});
    expect(result).toEqual({
      id: winner.id,
      sshPublicKey: winner.sshPublicKey,
    });
    expect(state.deletedSecrets).toHaveLength(1);
    expect(state.deletedSecrets[0]?.key).toBe(state.writtenSecrets[0]?.key);
  });

  it("rejects non-administrators with 403", async () => {
    state.orgRole = "member";
    const action = (await import("./get-workspace-ssh-key.js")).default;
    await expect(action.run({})).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "workspace_admin_required",
    });
  });
});
