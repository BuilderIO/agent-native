import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/store.js";
import { createFrameworkSCIMIdentity } from "./scim-provisioning.js";

type Row = Record<string, any>;

function adapterFor(
  rows: Record<string, Row[]>,
  options: { requireDeclaredTables?: boolean } = {},
): any {
  const matches = (
    row: Row,
    where: Array<{ field: string; value: unknown; mode?: string }>,
  ) =>
    where.every(({ field, value, mode }) => {
      const actual = row[field];
      if (
        mode === "insensitive" &&
        typeof actual === "string" &&
        typeof value === "string"
      ) {
        return actual.toLowerCase() === value.toLowerCase();
      }
      return actual === value;
    });
  const table = (model: string): Row[] => (rows[model] ??= []);
  return {
    findOne: vi.fn(
      async ({ model, where }: any) =>
        table(model).find((row) => matches(row, where)) ?? null,
    ),
    findMany: vi.fn(async ({ model, where = [] }: any) =>
      table(model).filter((row) => matches(row, where)),
    ),
    create: vi.fn(async ({ model, data }: any) => {
      if (options.requireDeclaredTables && !(model in rows)) {
        throw new Error(`relation ${model} does not exist`);
      }
      const row = { ...data, id: data.id ?? `id-${table(model).length + 1}` };
      table(model).push(row);
      return row;
    }),
    update: vi.fn(async ({ model, where, update }: any) => {
      const row = table(model).find((candidate) => matches(candidate, where));
      if (!row) return null;
      Object.assign(row, update);
      return row;
    }),
    updateMany: vi.fn(async ({ model, where, update }: any) => {
      const matched = table(model).filter((row) => matches(row, where));
      for (const row of matched) Object.assign(row, update);
      return matched.length;
    }),
    delete: vi.fn(async ({ model, where }: any) => {
      const modelRows = table(model);
      const index = modelRows.findIndex((row) => matches(row, where));
      if (index >= 0) modelRows.splice(index, 1);
    }),
    deleteMany: vi.fn(async ({ model, where }: any) => {
      const modelRows = table(model);
      const kept = modelRows.filter((row) => !matches(row, where));
      rows[model] = kept;
      return modelRows.length - kept.length;
    }),
  };
}

describe("framework SCIM identity bridge", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SCIM", "true");
    resetAppConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  it("links a user and writes the first audit event with the migration-provisioned table", async () => {
    const rows: Record<string, Row[]> = {
      user: [{ id: "user-1", email: "Jane@Example.com" }],
      frameworkOrganization: [{ id: "org-1", name: "Example" }],
      orgMember: [],
      orgScimMembership: [],
      appMemberRole: [],
      agentAuditLog: [],
    };
    const database = adapterFor(rows, { requireDeclaredTables: true });
    const identity = createFrameworkSCIMIdentity();
    const input = {
      connectionId: "connection-1",
      provisioningDomainId: "org-1",
      resource: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "jane@example.com",
        primaryEmail: "jane@example.com",
        displayName: "Jane",
        name: { formatted: "Jane" },
        emails: [{ value: "jane@example.com", primary: true }],
        active: true,
      },
    } as any;

    await expect(identity.resolveUser!(input, { database })).resolves.toEqual({
      action: "link",
      userId: "user-1",
      profile: "preserve",
    });

    const state = {
      userId: "user-1",
      active: true,
      sources: [
        {
          id: "source-1",
          connectionId: "connection-1",
          provisioningDomainId: "org-1",
          active: true,
        },
      ],
    } as any;
    await identity.reconcileUser!(state, { database });
    await identity.reconcileUser!(state, { database });
    expect(rows.orgMember).toHaveLength(1);
    expect(rows.orgMember[0]).toMatchObject({
      orgId: "org-1",
      email: "jane@example.com",
      role: "member",
    });
    expect(rows.orgScimMembership).toHaveLength(1);
    expect(rows.orgScimMembership[0].createdMembership).toBe(true);
    expect(rows.orgScimMembership[0].memberId).toBe(rows.orgMember[0].id);
    rows.appMemberRole.push({
      id: "role-1",
      orgId: "org-1",
      appId: "app-1",
      email: "jane@example.com",
      role: "member",
    });
    rows.user[0].email = "jane.new@example.com";

    await identity.reconcileUser!(
      { ...state, active: false, sources: [] },
      { database },
    );
    expect(rows.orgMember).toHaveLength(1);
    expect(rows.orgMember[0].federationRemovalPendingAt).toEqual(
      expect.any(Number),
    );
    expect(rows.orgScimMembership).toHaveLength(1);
    expect(rows.appMemberRole).toHaveLength(0);
    expect(rows.agentAuditLog).toHaveLength(1);
    expect(rows.agentAuditLog[0]).toMatchObject({
      action: "org.member.scim-removal-pending",
      status: "pending",
      orgId: "org-1",
    });
    expect(rows.user).toHaveLength(1);

    await identity.reconcileUser!(state, { database });
    expect(rows.orgMember[0].federationRemovalPendingAt).toBeNull();
  });

  it("does not remove a manually-owned membership on deactivation", async () => {
    const rows: Record<string, Row[]> = {
      user: [{ id: "user-1", email: "jane@example.com" }],
      frameworkOrganization: [{ id: "org-1", name: "Example" }],
      orgMember: [
        {
          id: "manual-member",
          orgId: "org-1",
          email: "jane@example.com",
          role: "admin",
        },
      ],
      orgScimMembership: [],
      appMemberRole: [],
    };
    const database = adapterFor(rows);
    const identity = createFrameworkSCIMIdentity();
    const state = {
      userId: "user-1",
      active: true,
      sources: [
        {
          id: "source-1",
          connectionId: "connection-1",
          provisioningDomainId: "org-1",
          active: true,
        },
      ],
    } as any;

    await identity.reconcileUser!(state, { database });
    expect(rows.orgScimMembership[0].createdMembership).toBe(false);
    await identity.reconcileUser!(
      { ...state, active: false, sources: [] },
      { database },
    );
    expect(rows.orgMember).toHaveLength(1);
    expect(rows.orgMember[0].id).toBe("manual-member");
    expect(rows.user).toHaveLength(1);
  });

  it("keeps sessions when a manual membership remains in another organization", async () => {
    const rows: Record<string, Row[]> = {
      user: [{ id: "user-1", email: "jane@example.com" }],
      frameworkOrganization: [
        { id: "org-scim", name: "SCIM" },
        { id: "org-manual", name: "Manual" },
      ],
      orgMember: [
        {
          id: "manual-member",
          orgId: "org-manual",
          email: "jane@example.com",
          role: "member",
        },
      ],
      orgScimMembership: [],
      appMemberRole: [],
      session: [{ id: "session-1", userId: "user-1" }],
    };
    const database = adapterFor(rows);
    const identity = createFrameworkSCIMIdentity();
    const activeState = {
      userId: "user-1",
      active: true,
      sources: [
        {
          id: "source-1",
          connectionId: "connection-1",
          provisioningDomainId: "org-scim",
          active: true,
        },
      ],
    } as any;

    await identity.reconcileUser!(activeState, { database });
    await identity.reconcileUser!(
      { ...activeState, active: false, sources: [] },
      { database },
    );

    expect(rows.session).toHaveLength(1);
    expect(rows.orgMember).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orgId: "org-manual",
          email: "jane@example.com",
        }),
        expect.objectContaining({
          orgId: "org-scim",
          federationRemovalPendingAt: expect.any(Number),
        }),
      ]),
    );
  });

  it("rekeys a mapped membership when the IdP changes the primary email", async () => {
    const rows: Record<string, Row[]> = {
      user: [{ id: "user-1", email: "jane@example.com" }],
      frameworkOrganization: [{ id: "org-1", name: "Example" }],
      orgMember: [],
      orgScimMembership: [],
      appMemberRole: [],
    };
    const database = adapterFor(rows);
    const identity = createFrameworkSCIMIdentity();
    const state = {
      userId: "user-1",
      active: true,
      sources: [
        {
          id: "source-1",
          connectionId: "connection-1",
          provisioningDomainId: "org-1",
          active: true,
        },
      ],
    } as any;

    await identity.reconcileUser!(state, { database });
    const memberId = rows.orgMember[0].id;
    rows.appMemberRole.push({
      id: "role-1",
      orgId: "org-1",
      appId: "app-1",
      email: "jane@example.com",
      role: "member",
    });
    rows.user[0].email = "jane.new@example.com";

    await identity.reconcileUser!(state, { database });

    expect(rows.orgMember).toEqual([
      expect.objectContaining({ id: memberId, email: "jane.new@example.com" }),
    ]);
    expect(rows.orgScimMembership).toHaveLength(1);
    expect(database.updateMany).toHaveBeenCalled();
    expect(rows.appMemberRole[0].email).toBe("jane.new@example.com");
  });

  it("does not delete a manually re-added member when a mapped id is stale", async () => {
    const rows: Record<string, Row[]> = {
      user: [{ id: "user-1", email: "jane@example.com" }],
      frameworkOrganization: [{ id: "org-1", name: "Example" }],
      orgMember: [
        {
          id: "manual-member",
          orgId: "org-1",
          email: "jane@example.com",
          role: "member",
        },
      ],
      orgScimMembership: [
        {
          id: "mapping-1",
          orgId: "org-1",
          userId: "user-1",
          memberId: "deleted-scim-member",
          createdMembership: true,
        },
      ],
      appMemberRole: [],
    };
    const database = adapterFor(rows);
    const identity = createFrameworkSCIMIdentity();

    await identity.reconcileUser!(
      { userId: "user-1", active: false, sources: [] } as any,
      { database },
    );

    expect(rows.orgMember).toHaveLength(1);
    expect(rows.orgMember[0].id).toBe("manual-member");
    expect(rows.orgScimMembership).toHaveLength(0);
  });

  it("reuses one mapping after local offboarding deletes the member", async () => {
    const rows: Record<string, Row[]> = {
      user: [{ id: "user-1", email: "jane@example.com" }],
      frameworkOrganization: [{ id: "org-1", name: "Example" }],
      orgMember: [],
      orgScimMembership: [],
      appMemberRole: [],
    };
    const database = adapterFor(rows);
    const identity = createFrameworkSCIMIdentity();
    const activeState = {
      userId: "user-1",
      active: true,
      sources: [
        {
          id: "source-1",
          connectionId: "connection-1",
          provisioningDomainId: "org-1",
          active: true,
        },
      ],
    } as any;

    await identity.reconcileUser!(activeState, { database });
    const firstMemberId = rows.orgMember[0]!.id;
    expect(rows.orgScimMembership).toHaveLength(1);

    await identity.reconcileUser!(
      { ...activeState, active: false, sources: [] },
      { database },
    );
    rows.orgMember.splice(0, 1);

    await identity.reconcileUser!(activeState, { database });

    expect(rows.orgMember).toHaveLength(1);
    expect(rows.orgMember[0]!.id).not.toBe(firstMemberId);
    expect(rows.orgScimMembership).toHaveLength(1);
    expect(rows.orgScimMembership[0]).toMatchObject({
      orgId: "org-1",
      userId: "user-1",
      memberId: rows.orgMember[0]!.id,
      createdMembership: true,
    });
  });
});
