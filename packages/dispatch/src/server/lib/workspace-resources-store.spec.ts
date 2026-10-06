import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDbExec: vi.fn(),
  currentOwnerEmail: vi.fn(() => "owner@example.test"),
  currentOrgId: vi.fn(() => "org_123"),
  getApprovalPolicy: vi.fn(async () => ({
    enabled: false,
    approverEmails: [],
  })),
  createApprovalRequest: vi.fn(async (input: any) => ({
    id: "approval_1",
    status: "pending",
    ...input,
  })),
  recordAudit: vi.fn(async () => undefined),
  resourcePut: vi.fn(async () => undefined),
  resourcePutIfSnapshot: vi.fn(async () => undefined),
  resourceRestoreSnapshotIfCurrent: vi.fn(async () => true),
  resourceGetByPath: vi.fn(async () => null),
  resourceDeleteIfCurrent: vi.fn(async () => true),
  resourceListAllOwners: vi.fn(async () => []),
  resourceEffectiveContext: vi.fn(async (_userEmail: string, path: string) => ({
    path,
    effectiveScope: "workspace",
    effectiveResource: {
      id: "resource_meta_1",
      path,
      owner: "__workspace__",
      mimeType: "text/markdown",
      size: 10,
      createdAt: 1,
      updatedAt: 2,
      createdBy: "system",
      visibility: "workspace",
      threadId: null,
      runId: null,
      expiresAt: null,
      metadata: null,
    },
    layers: [
      {
        scope: "workspace",
        label: "Workspace default",
        owner: "__workspace__",
        resource: {
          id: "resource_meta_1",
          path,
          owner: "__workspace__",
          mimeType: "text/markdown",
          size: 10,
          createdAt: 1,
          updatedAt: 2,
          createdBy: "system",
          visibility: "workspace",
          threadId: null,
          runId: null,
          expiresAt: null,
          metadata: null,
        },
        exists: true,
        effective: true,
        overridden: false,
        canWrite: false,
      },
      {
        scope: "shared",
        label: "Organization/app override",
        owner: "__shared__",
        resource: null,
        exists: false,
        effective: false,
        overridden: false,
        canWrite: true,
      },
      {
        scope: "personal",
        label: "Personal override",
        owner: "owner@example.test",
        resource: null,
        exists: false,
        effective: false,
        overridden: false,
        canWrite: true,
      },
    ],
  })),
  getOrgSetting: vi.fn(async () => null),
  getUserSetting: vi.fn(async () => null),
  putOrgSetting: vi.fn(async () => undefined),
  putUserSetting: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => mocks.getDbExec(),
}));

vi.mock("../../db/index.js", async () => {
  const schema = await import("../../db/schema.js");
  return {
    ...schema,
    schema,
    getDb: () => mocks.getDb(),
  };
});

vi.mock("./dispatch-store.js", () => ({
  createApprovalRequest: (...args: any[]) =>
    mocks.createApprovalRequest(...args),
  currentOwnerEmail: () => mocks.currentOwnerEmail(),
  currentOrgId: () => mocks.currentOrgId(),
  getApprovalPolicy: () => mocks.getApprovalPolicy(),
  recordAudit: (...args: any[]) => mocks.recordAudit(...args),
}));

vi.mock("@agent-native/core/resources/store", () => ({
  isLocalWorkspaceResourceId: (id: string) =>
    id.startsWith("local-workspace-resource:"),
  LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE: "local-workspace-resource",
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  workspaceResourceOwner: (orgId?: string | null) =>
    orgId
      ? `__workspace__:__organization__:${encodeURIComponent(orgId)}`
      : "__workspace__",
  isWorkspaceResourceOwner: (owner: string) =>
    owner === "__workspace__" || owner.startsWith("__workspace__:"),
  resourcePut: (...args: any[]) => mocks.resourcePut(...args),
  resourcePutIfSnapshot: (...args: any[]) =>
    mocks.resourcePutIfSnapshot(...args),
  resourceRestoreSnapshotIfCurrent: (...args: any[]) =>
    mocks.resourceRestoreSnapshotIfCurrent(...args),
  resourceGetByPath: (...args: any[]) => mocks.resourceGetByPath(...args),
  resourceDeleteIfCurrent: (...args: any[]) =>
    mocks.resourceDeleteIfCurrent(...args),
  resourceListAllOwners: (...args: any[]) =>
    mocks.resourceListAllOwners(...args),
  resourceEffectiveContext: (...args: any[]) =>
    mocks.resourceEffectiveContext(...args),
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: (...args: any[]) => mocks.getOrgSetting(...args),
  getUserSetting: (...args: any[]) => mocks.getUserSetting(...args),
  putOrgSetting: (...args: any[]) => mocks.putOrgSetting(...args),
  putUserSetting: (...args: any[]) => mocks.putUserSetting(...args),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: vi.fn(async () => []),
}));

import {
  ensureStarterWorkspaceResources,
  createWorkspaceResource,
  deleteWorkspaceResource,
  getWorkspaceResourceEffectiveContext,
  listWorkspaceResourcesForApp,
  previewWorkspaceResourceChange,
  restoreStarterWorkspaceResources,
  STARTER_GLOBAL_WORKSPACE_RESOURCES,
  updateWorkspaceResource,
} from "./workspace-resources-store.js";

interface ResourceRow {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  kind: string;
  name: string;
  description: string | null;
  path: string;
  content: string;
  scope: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface GrantRow {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  resourceId: string;
  appId: string;
  status: string;
  syncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function createFakeDb(
  state: {
    resources: ResourceRow[];
    grants?: GrantRow[];
  },
  options?: {
    beforeUpdate?: (
      call: number,
      updates: Partial<ResourceRow | GrantRow>,
    ) => boolean;
  },
) {
  const latestResource = () => state.resources.at(-1);
  let updateCall = 0;

  return {
    insert: vi.fn(() => ({
      values: vi.fn(async (values: ResourceRow | GrantRow) => {
        if ("kind" in values) state.resources.push(values);
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table: any) => {
        const tableName = table?.[Symbol.for("drizzle:Name")] ?? "";
        const rows =
          tableName === "workspace_resource_grants"
            ? (state.grants ?? [])
            : state.resources;
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              const resource = latestResource();
              return resource ? [resource] : [];
            }),
            orderBy: vi.fn(async () => rows),
          })),
          orderBy: vi.fn(async () => rows),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: Partial<ResourceRow | GrantRow>) => {
        let updated = false;
        let result: ResourceRow | undefined;
        const apply = () => {
          if (!updated) {
            updated = true;
            updateCall += 1;
            if (options?.beforeUpdate?.(updateCall, updates)) return;
            const resource = latestResource();
            if (resource) {
              Object.assign(resource, updates);
              result = { ...resource };
            }
          }
        };
        return {
          where: vi.fn(() => {
            apply();
            return {
              returning: vi.fn(async () => {
                return result ? [result] : [];
              }),
            };
          }),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        state.resources.pop();
      }),
    })),
  };
}

function createStarterFakeDb(state: { resources: ResourceRow[] }) {
  let limitCall = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            limitCall += 1;
            return limitCall % 2 === 0 && state.resources.length > 0
              ? [state.resources.at(-1)]
              : [];
          }),
        })),
      })),
    })),
  };
}

function createStarterExec(state: { resources: ResourceRow[] }) {
  return {
    execute: vi.fn(async (query: { args?: unknown[] }) => {
      const args = query.args ?? [];
      state.resources.push({
        id: String(args[0]),
        ownerEmail: String(args[1]),
        orgId: args[2] as string | null,
        kind: String(args[3]),
        name: String(args[4]),
        description: args[5] as string | null,
        path: String(args[6]),
        content: String(args[7]),
        scope: String(args[8]),
        createdBy: String(args[9]),
        createdAt: Number(args[10]),
        updatedAt: Number(args[11]),
      });
      return { rows: [], rowsAffected: 1 };
    }),
  };
}

function dispatchMetadata(resource: Pick<ResourceRow, "id">) {
  return JSON.stringify({
    source: "dispatch-workspace-resource",
    resourceId: resource.id,
  });
}

const ORG_WORKSPACE_OWNER = "__workspace__:__organization__:org_123";

beforeEach(() => {
  mocks.currentOrgId.mockReturnValue("org_123");
  mocks.resourcePut.mockResolvedValue(undefined);
  mocks.resourcePutIfSnapshot.mockImplementation(async (input: any) => {
    await mocks.resourcePut(
      input.owner,
      input.path,
      input.content,
      input.mimeType,
      input.options,
    );
    return {
      before: input.previous,
      resource: {
        id: `${input.owner}_${input.path}`,
        owner: input.owner,
        path: input.path,
        content: input.content,
        mimeType: input.mimeType ?? "text/markdown",
        size: input.content.length,
        createdAt: 1,
        updatedAt: 2,
        createdBy: "system",
        visibility: "workspace",
        threadId: null,
        runId: null,
        expiresAt: null,
        metadata: JSON.stringify(input.options?.metadata ?? null),
      },
    };
  });
  mocks.resourceRestoreSnapshotIfCurrent.mockResolvedValue(true);
  mocks.resourceGetByPath.mockResolvedValue(null);
  mocks.resourceDeleteIfCurrent.mockResolvedValue(true);
  mocks.getDb.mockReturnValue(createFakeDb({ resources: [] }));
  mocks.getDbExec.mockReturnValue({ execute: vi.fn() });
  mocks.getApprovalPolicy.mockResolvedValue({
    enabled: false,
    approverEmails: [],
  });
  mocks.createApprovalRequest.mockImplementation(async (input: any) => ({
    id: "approval_1",
    status: "pending",
    ...input,
  }));
  mocks.resourceListAllOwners.mockResolvedValue([]);
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.putOrgSetting.mockResolvedValue(undefined);
  mocks.putUserSetting.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("workspace resource materialization", () => {
  it("seeds the starter global workspace resources once per org scope", async () => {
    const state = { resources: [] as ResourceRow[] };
    mocks.getDb.mockReturnValue(createStarterFakeDb(state));
    mocks.getDbExec.mockReturnValue(createStarterExec(state));

    await ensureStarterWorkspaceResources({
      ownerEmail: "owner@example.test",
      orgId: "org_123",
    });

    expect(state.resources.map((resource) => resource.path)).toEqual(
      STARTER_GLOBAL_WORKSPACE_RESOURCES.map((resource) => resource.path),
    );
    expect(state.resources.every((resource) => resource.scope === "all")).toBe(
      true,
    );
    expect(mocks.resourcePut).toHaveBeenCalledTimes(
      STARTER_GLOBAL_WORKSPACE_RESOURCES.length,
    );
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      ORG_WORKSPACE_OWNER,
      "context/company.md",
      expect.stringContaining("# Company Profile"),
      "text/markdown",
      expect.objectContaining({ createdBy: "system" }),
    );
    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org_123",
      "dispatch-starter-workspace-resources",
      expect.objectContaining({
        version: 2,
        resources: STARTER_GLOBAL_WORKSPACE_RESOURCES.map((resource) => ({
          path: resource.path,
          kind: resource.kind,
          scope: resource.scope,
        })),
      }),
    );
  });

  it("skips starter seeding after the scope marker exists", async () => {
    mocks.getOrgSetting.mockResolvedValueOnce({ version: 2 });

    await ensureStarterWorkspaceResources({
      ownerEmail: "owner@example.test",
      orgId: "org_123",
    });

    expect(mocks.getDbExec).not.toHaveBeenCalled();
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("restores a missing starter resource without rerunning automatic seeding", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    const state = { resources: [] as ResourceRow[] };
    mocks.getDb.mockReturnValue(createStarterFakeDb(state));
    mocks.getDbExec.mockReturnValue(createStarterExec(state));

    const result = await restoreStarterWorkspaceResources({
      paths: ["context/brand.md"],
    });

    expect(result.restored.map((resource) => resource.path)).toEqual([
      "context/brand.md",
    ]);
    expect(state.resources).toHaveLength(1);
    expect(state.resources[0]).toEqual(
      expect.objectContaining({
        path: "context/brand.md",
        scope: "all",
      }),
    );
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      ORG_WORKSPACE_OWNER,
      "context/brand.md",
      expect.stringContaining("# Brand Guidelines"),
      "text/markdown",
      expect.objectContaining({ createdBy: "system" }),
    );

    mocks.getDb.mockReturnValue(createFakeDb({ resources: state.resources }));
    const received = await listWorkspaceResourcesForApp("mail");

    expect(received.resources).toEqual([
      expect.objectContaining({
        path: "context/brand.md",
        source: "workspace",
      }),
    ]);
  });

  it("materializes scope=all starter resources into the core workspace resource store", async () => {
    const created = await createWorkspaceResource({
      kind: "instruction",
      name: "Starter guardrails",
      description: "Always-on workspace instructions",
      path: "instructions/starter.md",
      content: "# Starter\nUse the shared workspace context.",
      scope: "all",
    });

    expect(created?.scope).toBe("all");
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      ORG_WORKSPACE_OWNER,
      "instructions/starter.md",
      "# Starter\nUse the shared workspace context.",
      "text/markdown",
      {
        createdBy: "system",
        metadata: expect.objectContaining({
          source: "dispatch-workspace-resource",
          resourceId: created?.id,
          kind: "instruction",
          name: "Starter guardrails",
          description: "Always-on workspace instructions",
          updatedAt: created?.updatedAt,
        }),
      },
    );
  });

  it("uses application/json when materializing global agent profile resources", async () => {
    await createWorkspaceResource({
      kind: "agent",
      name: "Research agent",
      path: "remote-agents/research.json",
      content: '{"name":"Research"}',
      scope: "all",
    });

    expect(mocks.resourcePut).toHaveBeenCalledWith(
      ORG_WORKSPACE_OWNER,
      "remote-agents/research.json",
      '{"name":"Research"}',
      "application/json",
      expect.any(Object),
    );
  });

  it("materializes personal-scope resources under the bare workspace owner", async () => {
    mocks.currentOrgId.mockReturnValue(null);

    await createWorkspaceResource({
      kind: "instruction",
      name: "Solo guardrails",
      path: "instructions/solo.md",
      content: "# Solo",
      scope: "all",
    });

    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "__workspace__",
      "instructions/solo.md",
      "# Solo",
      "text/markdown",
      expect.any(Object),
    );
  });

  it("removes a matching no-org Local File Mode materialization on revocation", async () => {
    mocks.currentOrgId.mockReturnValue(null);
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: null,
          kind: "instruction",
          name: "Solo guardrails",
          description: null,
          path: "AGENTS.md",
          content: "# Materialized",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    const local = {
      id: "local-workspace-resource:agents",
      owner: "__workspace__",
      path: "AGENTS.md",
      content: "# Materialized",
      metadata: JSON.stringify({
        source: "local-workspace-resource",
        absolutePath: "/workspace/AGENTS.md",
        hash: "materialized-hash",
      }),
    };
    mocks.resourceListAllOwners.mockResolvedValue([local]);

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(local);
  });

  it("uses the pre-update content when revoking a Local File Mode materialization", async () => {
    mocks.currentOrgId.mockReturnValue(null);
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: null,
          kind: "instruction",
          name: "Solo guardrails",
          description: null,
          path: "AGENTS.md",
          content: "# Materialized",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    const local = {
      id: "local-workspace-resource:agents",
      owner: "__workspace__",
      path: "AGENTS.md",
      content: "# Materialized",
      metadata: JSON.stringify({
        source: "local-workspace-resource",
        absolutePath: "/workspace/AGENTS.md",
        hash: "materialized-hash",
      }),
    };
    mocks.resourceListAllOwners.mockResolvedValue([local]);

    await updateWorkspaceResource("resource_1", {
      content: "# Selected replacement",
      scope: "selected",
    });

    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(local);
  });

  it("preserves changed and organization-local artifacts while cleaning a shadowed SQL copy", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Org guardrails",
          description: null,
          path: "AGENTS.md",
          content: "# Materialized",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    const local = {
      id: "local-workspace-resource:agents",
      owner: "__workspace__",
      path: "AGENTS.md",
      content: "# Materialized",
      metadata: JSON.stringify({
        source: "local-workspace-resource",
        absolutePath: "/workspace/AGENTS.md",
        hash: "local-hash",
      }),
    };
    const shadowedSql = {
      id: "legacy_sql_1",
      owner: "__workspace__",
      path: "AGENTS.md",
      content: "# Materialized",
      metadata: dispatchMetadata(state.resources[0]),
    };
    mocks.resourceListAllOwners.mockResolvedValue([local, shadowedSql]);

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceListAllOwners).toHaveBeenCalledWith("AGENTS.md", {
      includeShadowedWorkspaceRows: true,
    });
    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(shadowedSql);
    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalledWith(local);
  });

  it("preserves a changed no-org Local File Mode artifact", async () => {
    mocks.currentOrgId.mockReturnValue(null);
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: null,
          kind: "instruction",
          name: "Solo guardrails",
          description: null,
          path: "AGENTS.md",
          content: "# Materialized",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    mocks.resourceListAllOwners.mockResolvedValue([
      {
        id: "local-workspace-resource:agents",
        owner: "__workspace__",
        path: "AGENTS.md",
        content: "# User replacement",
        metadata: JSON.stringify({
          source: "local-workspace-resource",
          absolutePath: "/workspace/AGENTS.md",
          hash: "replacement-hash",
        }),
      },
    ]);

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalled();
  });

  it("does not materialize selected-only resources", async () => {
    await createWorkspaceResource({
      kind: "knowledge",
      name: "Launch notes",
      path: "context/launch.md",
      content: "# Launch",
      scope: "selected",
    });

    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalled();
  });

  it("removes a previously materialized global resource when it becomes selected-only", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Starter guardrails",
          description: null,
          path: "instructions/starter.md",
          content: "# Starter",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    mocks.resourceGetByPath.mockImplementation(async (owner: string) =>
      owner === ORG_WORKSPACE_OWNER || owner === "__workspace__"
        ? {
            id: `${owner}_1`,
            owner,
            path: "instructions/starter.md",
            metadata: dispatchMetadata(state.resources[0]),
          }
        : null,
    );
    mocks.resourceListAllOwners.mockResolvedValue([
      {
        id: "__workspace___1",
        owner: "__workspace__",
        path: "instructions/starter.md",
        metadata: dispatchMetadata(state.resources[0]),
      },
    ]);

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: ORG_WORKSPACE_OWNER,
        path: "instructions/starter.md",
      }),
    );
    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "__workspace__",
        path: "instructions/starter.md",
      }),
    );
    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });

  it("removes a pre-upgrade bare-owner copy when materializing under the organization owner", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Company",
          description: null,
          path: "context/company.md",
          content: "# Company",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    const materialized = new Map<string, { owner: string; metadata: string }>([
      [
        "__workspace__\0context/company.md",
        {
          owner: "__workspace__",
          metadata: dispatchMetadata(state.resources[0]),
        },
      ],
    ]);
    mocks.resourcePut.mockImplementation(
      async (owner: string, path: string, _content: string, _mime, options) => {
        materialized.set(`${owner}\0${path}`, {
          owner,
          metadata: JSON.stringify(options.metadata),
        });
      },
    );
    mocks.resourceGetByPath.mockImplementation(
      async (
        owner: string,
        path: string,
        options?: { orgId?: string | null },
      ) => {
        const candidates =
          owner === "__workspace__" && !options?.orgId
            ? ["__workspace__"]
            : [ORG_WORKSPACE_OWNER, "__workspace__"];
        for (const candidate of candidates) {
          const row = materialized.get(`${candidate}\0${path}`);
          if (row) return { id: `${candidate}_${path}`, path, ...row };
        }
        return null;
      },
    );
    mocks.resourceListAllOwners.mockImplementation(async (path: string) => {
      const row = materialized.get(`__workspace__\0${path}`);
      return row ? [{ id: `__workspace___${path}`, path, ...row }] : [];
    });

    await getWorkspaceResourceEffectiveContext({ resourceId: "resource_1" });

    expect(mocks.resourcePut).toHaveBeenCalledWith(
      ORG_WORKSPACE_OWNER,
      "context/company.md",
      "# Company",
      "text/markdown",
      expect.any(Object),
    );
    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "__workspace__",
        path: "context/company.md",
      }),
    );
    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalledWith(
      expect.objectContaining({ owner: ORG_WORKSPACE_OWNER }),
    );
  });

  it("does not delete a legacy row a workspace read fell through to", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Starter guardrails",
          description: null,
          path: "instructions/starter.md",
          content: "# Starter",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    mocks.resourceGetByPath.mockResolvedValue({
      id: "legacy_1",
      owner: "__workspace__",
      path: "instructions/starter.md",
      metadata: JSON.stringify({
        source: "dispatch-workspace-resource",
        resourceId: "resource_from_other_org",
      }),
    });

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalled();
  });

  it("leaves shared resources alone when metadata does not match Dispatch ownership", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Starter guardrails",
          description: null,
          path: "instructions/starter.md",
          content: "# Starter",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    mocks.resourceGetByPath.mockResolvedValueOnce({
      id: "shared_1",
      owner: "__workspace__",
      path: "instructions/starter.md",
      metadata: JSON.stringify({
        source: "manual",
        resourceId: "resource_1",
      }),
    });

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalled();
  });

  it("removes a materialized global resource before deleting the workspace resource", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Positioning",
          description: null,
          path: "context/positioning.md",
          content: "# Positioning",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      grants: [],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    mocks.resourceGetByPath.mockImplementation(async (owner: string) =>
      owner === ORG_WORKSPACE_OWNER
        ? {
            id: "shared_1",
            owner,
            path: "context/positioning.md",
            metadata: dispatchMetadata(state.resources[0]),
          }
        : null,
    );

    await deleteWorkspaceResource("resource_1");

    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: ORG_WORKSPACE_OWNER,
        path: "context/positioning.md",
      }),
    );
    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledTimes(1);
  });

  it("fails when a matching materialization changes during conditional deletion", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Starter guardrails",
          description: null,
          path: "instructions/starter.md",
          content: "# Starter",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    const existing = {
      id: "materialized_1",
      owner: ORG_WORKSPACE_OWNER,
      path: "instructions/starter.md",
      metadata: dispatchMetadata(state.resources[0]),
    };
    mocks.resourceGetByPath.mockResolvedValue(existing);
    mocks.resourceDeleteIfCurrent.mockResolvedValue(false);

    await expect(
      updateWorkspaceResource("resource_1", { scope: "selected" }),
    ).rejects.toThrow(
      "Workspace resource materialization changed concurrently: instructions/starter.md",
    );

    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(existing);
    expect(mocks.resourceGetByPath).toHaveBeenCalledTimes(2);
    expect(state.resources[0]).toMatchObject({
      scope: "all",
      content: "# Starter",
      name: "Starter guardrails",
    });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer update when materialization rollback conflicts", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Starter guardrails",
          description: null,
          path: "instructions/starter.md",
          content: "# Starter",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(
      createFakeDb(state, {
        beforeUpdate(call) {
          if (call !== 2) return false;
          Object.assign(state.resources[0]!, {
            name: "Concurrent guardrails",
            content: "# Concurrent",
            scope: "all",
            updatedAt: 99,
          });
          return true;
        },
      }),
    );
    const existing = {
      id: "materialized_1",
      owner: ORG_WORKSPACE_OWNER,
      path: "instructions/starter.md",
      metadata: dispatchMetadata(state.resources[0]),
    };
    mocks.resourceGetByPath.mockResolvedValue(existing);
    mocks.resourceDeleteIfCurrent.mockResolvedValue(false);

    await expect(
      updateWorkspaceResource("resource_1", { scope: "selected" }),
    ).rejects.toThrow(
      "Workspace resource materialization failed and could not be rolled back",
    );

    expect(state.resources[0]).toMatchObject({
      name: "Concurrent guardrails",
      content: "# Concurrent",
      scope: "all",
      updatedAt: 99,
    });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["All-app overwrite", { name: "Updated guardrails" }],
    ["All-to-Selected cleanup", { scope: "selected" }],
  ])("rejects a newer materialization before %s", async (_label, input) => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Starter guardrails",
          description: null,
          path: "instructions/starter.md",
          content: "# Starter",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    mocks.resourceGetByPath.mockResolvedValue({
      id: "materialized_1",
      owner: ORG_WORKSPACE_OWNER,
      path: "instructions/starter.md",
      metadata: JSON.stringify({
        source: "dispatch-workspace-resource",
        resourceId: "resource_1",
        updatedAt: Number.MAX_SAFE_INTEGER,
      }),
    });

    await expect(updateWorkspaceResource("resource_1", input)).rejects.toThrow(
      "Workspace resource materialization changed concurrently: instructions/starter.md",
    );

    expect(mocks.resourcePutIfSnapshot).not.toHaveBeenCalled();
    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("accepts a concurrent replacement by a different Dispatch resource", async () => {
    const state = {
      resources: [
        {
          id: "resource_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Starter guardrails",
          description: null,
          path: "instructions/starter.md",
          content: "# Starter",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));
    const existing = {
      id: "materialized_1",
      owner: ORG_WORKSPACE_OWNER,
      path: "instructions/starter.md",
      metadata: dispatchMetadata(state.resources[0]),
    };
    mocks.resourceGetByPath
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({
        ...existing,
        metadata: JSON.stringify({
          source: "dispatch-workspace-resource",
          resourceId: "replacement_resource",
        }),
      });
    mocks.resourceDeleteIfCurrent.mockResolvedValue(false);

    await expect(
      updateWorkspaceResource("resource_1", { scope: "selected" }),
    ).resolves.toEqual(
      expect.objectContaining({ id: "resource_1", scope: "selected" }),
    );

    expect(mocks.resourceDeleteIfCurrent).toHaveBeenCalledWith(existing);
  });

  it("lists the inherited and granted workspace resources an app receives", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    const state = {
      resources: [
        {
          id: "global_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Guardrails",
          description: null,
          path: "instructions/guardrails.md",
          content: "# Guardrails",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "selected_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Analytics Messaging",
          description: null,
          path: "context/analytics.md",
          content: "# Analytics",
          scope: "selected",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 3,
        },
        {
          id: "selected_2",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Mail Messaging",
          description: null,
          path: "context/mail.md",
          content: "# Mail",
          scope: "selected",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 4,
        },
      ],
      grants: [
        {
          id: "grant_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          resourceId: "selected_1",
          appId: "analytics",
          status: "active",
          syncedAt: 123,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "grant_2",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          resourceId: "selected_2",
          appId: "analytics",
          status: "revoked",
          syncedAt: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await listWorkspaceResourcesForApp("analytics");

    expect(result.counts).toEqual({
      total: 2,
      workspace: 1,
      global: 1,
      granted: 1,
      autoLoaded: 1,
    });
    expect(result.resources.map((resource) => resource.path)).toEqual([
      "instructions/guardrails.md",
      "context/analytics.md",
    ]);
    expect(result.resources[0]).toEqual(
      expect.objectContaining({
        source: "workspace",
        autoLoaded: true,
        grantId: null,
      }),
    );
    expect(result.resources[1]).toEqual(
      expect.objectContaining({
        source: "grant",
        autoLoaded: false,
        grantId: "grant_1",
      }),
    );
    expect(result.resources[1]).not.toHaveProperty("syncedAt");
  });

  it("previews all-app effective context without requiring a grant or sync", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    const state = {
      resources: [
        {
          id: "global_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Brand",
          description: "Brand guidance",
          path: "context/brand.md",
          content: "# Brand",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      grants: [],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await getWorkspaceResourceEffectiveContext({
      resourceId: "global_1",
      appId: "analytics",
      userEmail: "person@example.test",
    });

    expect(result.availability).toBe("all-apps");
    expect(result.availableToApp).toBe(true);
    expect(result.path).toBe("context/brand.md");
    expect(result.workspaceResource).toEqual(
      expect.objectContaining({
        id: "global_1",
        path: "context/brand.md",
        scope: "all",
      }),
    );
    expect(mocks.resourceEffectiveContext).toHaveBeenCalledWith(
      "person@example.test",
      "context/brand.md",
      { workspaceAppId: "analytics", orgId: "org_123" },
    );
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      ORG_WORKSPACE_OWNER,
      "context/brand.md",
      "# Brand",
      "text/markdown",
      expect.objectContaining({ createdBy: "system" }),
    );
  });

  it("keeps each organization's All-apps copy of the same path separate", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    const materialized = new Map<string, { owner: string; content: string }>();
    mocks.resourcePut.mockImplementation(
      async (owner: string, path: string, content: string) => {
        materialized.set(`${owner}\0${path}`, { owner, content });
      },
    );
    mocks.resourceGetByPath.mockImplementation(
      async (owner: string, path: string) => {
        const row = materialized.get(`${owner}\0${path}`);
        return row ? { id: `${owner}_${path}`, path, ...row } : null;
      },
    );
    const rowFor = (id: string, orgId: string, content: string) => ({
      id,
      ownerEmail: `owner@${orgId}.test`,
      orgId,
      kind: "knowledge",
      name: "Company",
      description: null,
      path: "context/company.md",
      content,
      scope: "all",
      createdBy: `owner@${orgId}.test`,
      createdAt: 1,
      updatedAt: 2,
    });
    const orgA = { resources: [rowFor("company_a", "org_a", "Acme")] };
    const orgB = { resources: [rowFor("company_b", "org_b", "Globex")] };
    const ownerA = "__workspace__:__organization__:org_a";
    const ownerB = "__workspace__:__organization__:org_b";

    mocks.currentOrgId.mockReturnValue("org_a");
    mocks.getDb.mockReturnValue(createFakeDb(orgA));
    await getWorkspaceResourceEffectiveContext({ resourceId: "company_a" });

    mocks.currentOrgId.mockReturnValue("org_b");
    mocks.getDb.mockReturnValue(createFakeDb(orgB));
    await getWorkspaceResourceEffectiveContext({ resourceId: "company_b" });

    expect(materialized.get(`${ownerA}\0context/company.md`)?.content).toBe(
      "Acme",
    );
    expect(materialized.get(`${ownerB}\0context/company.md`)?.content).toBe(
      "Globex",
    );
    expect(materialized.has("__workspace__\0context/company.md")).toBe(false);

    mocks.currentOrgId.mockReturnValue("org_a");
    mocks.getDb.mockReturnValue(createFakeDb(orgA));
    await getWorkspaceResourceEffectiveContext({ resourceId: "company_a" });

    expect(materialized.get(`${ownerB}\0context/company.md`)?.content).toBe(
      "Globex",
    );
    expect(mocks.resourceDeleteIfCurrent).not.toHaveBeenCalled();
  });

  it("returns the winning layer from the runtime effective context stack", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    mocks.resourceEffectiveContext.mockResolvedValueOnce({
      path: "instructions/guardrails.md",
      effectiveScope: "personal",
      effectiveResource: {
        id: "personal_meta",
        path: "instructions/guardrails.md",
        owner: "person@example.test",
        mimeType: "text/markdown",
        size: 24,
        createdAt: 1,
        updatedAt: 4,
        createdBy: "user",
        visibility: "workspace",
        threadId: null,
        runId: null,
        expiresAt: null,
        metadata: null,
      },
      layers: [
        {
          scope: "workspace",
          label: "Workspace default",
          owner: "__workspace__",
          resource: {
            id: "workspace_meta",
            path: "instructions/guardrails.md",
            owner: "__workspace__",
            mimeType: "text/markdown",
            size: 16,
            createdAt: 1,
            updatedAt: 2,
            createdBy: "system",
            visibility: "workspace",
            threadId: null,
            runId: null,
            expiresAt: null,
            metadata: null,
          },
          exists: true,
          effective: false,
          overridden: true,
          canWrite: false,
        },
        {
          scope: "shared",
          label: "Organization/app override",
          owner: "__shared__",
          resource: {
            id: "shared_meta",
            path: "instructions/guardrails.md",
            owner: "__shared__",
            mimeType: "text/markdown",
            size: 20,
            createdAt: 1,
            updatedAt: 3,
            createdBy: "user",
            visibility: "workspace",
            threadId: null,
            runId: null,
            expiresAt: null,
            metadata: null,
          },
          exists: true,
          effective: false,
          overridden: true,
          canWrite: true,
        },
        {
          scope: "personal",
          label: "Personal override",
          owner: "person@example.test",
          resource: {
            id: "personal_meta",
            path: "instructions/guardrails.md",
            owner: "person@example.test",
            mimeType: "text/markdown",
            size: 24,
            createdAt: 1,
            updatedAt: 4,
            createdBy: "user",
            visibility: "workspace",
            threadId: null,
            runId: null,
            expiresAt: null,
            metadata: null,
          },
          exists: true,
          effective: true,
          overridden: false,
          canWrite: true,
        },
      ],
    });
    const state = {
      resources: [
        {
          id: "global_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Guardrails",
          description: null,
          path: "instructions/guardrails.md",
          content: "# Workspace guardrails",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      grants: [],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await getWorkspaceResourceEffectiveContext({
      resourceId: "global_1",
      appId: "analytics",
      userEmail: "person@example.test",
    });

    expect(result.availability).toBe("all-apps");
    expect(result.effectiveScope).toBe("personal");
    expect(result.effectiveResource).toEqual(
      expect.objectContaining({
        id: "personal_meta",
        owner: "person@example.test",
      }),
    );
    expect(
      result.layers.map((layer) => [layer.scope, layer.effective]),
    ).toEqual([
      ["workspace", false],
      ["shared", false],
      ["personal", true],
    ]);
  });

  it("reports selected resources as app-specific exceptions", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    const state = {
      resources: [
        {
          id: "selected_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Analytics launch",
          description: null,
          path: "context/analytics-launch.md",
          content: "# Launch",
          scope: "selected",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      grants: [
        {
          id: "grant_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          resourceId: "selected_1",
          appId: "analytics",
          status: "active",
          syncedAt: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await getWorkspaceResourceEffectiveContext({
      resourceId: "selected_1",
      appId: "analytics",
    });

    expect(result.availability).toBe("selected-granted");
    expect(result.availableToApp).toBe(true);
    expect(result.activeGrantId).toBe("grant_1");
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(mocks.resourceEffectiveContext).toHaveBeenCalledWith(
      "owner@example.test",
      "context/analytics-launch.md",
      { workspaceAppId: "analytics", orgId: "org_123" },
    );
  });

  it("marks selected resources unavailable to apps without an active grant", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    const state = {
      resources: [
        {
          id: "selected_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Analytics launch",
          description: null,
          path: "context/analytics-launch.md",
          content: "# Launch",
          scope: "selected",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      grants: [],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await getWorkspaceResourceEffectiveContext({
      resourceId: "selected_1",
      appId: "analytics",
    });

    expect(result.availability).toBe("selected-not-granted");
    expect(result.availableToApp).toBe(false);
    expect(result.activeGrantId).toBeNull();
  });

  it("queues All-app updates for approval when approval policy is enabled", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    mocks.getApprovalPolicy.mockResolvedValue({
      enabled: true,
      approverEmails: ["admin@example.test"],
    });
    const state = {
      resources: [
        {
          id: "global_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "instruction",
          name: "Guardrails",
          description: null,
          path: "instructions/guardrails.md",
          content: "# Guardrails",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      grants: [],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await updateWorkspaceResource("global_1", {
      content: "# Updated guardrails",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "approval_1",
        status: "pending",
        changeType: "workspace-resource.update",
        targetType: "workspace-instruction",
        targetId: "global_1",
      }),
    );
    expect(mocks.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "workspace-resource.update",
        beforeValue: expect.objectContaining({
          content: "# Guardrails",
          scope: "all",
        }),
        afterValue: expect.objectContaining({
          content: "# Updated guardrails",
          scope: "all",
        }),
      }),
    );
    expect(state.resources[0].content).toBe("# Guardrails");
    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });

  it("updates selected-only resources directly when approval policy is enabled", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    mocks.getApprovalPolicy.mockResolvedValue({
      enabled: true,
      approverEmails: ["admin@example.test"],
    });
    const state = {
      resources: [
        {
          id: "selected_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Launch",
          description: null,
          path: "context/launch.md",
          content: "# Launch",
          scope: "selected",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      grants: [],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await updateWorkspaceResource("selected_1", {
      content: "# Updated launch",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "selected_1",
        content: "# Updated launch",
      }),
    );
    expect(mocks.createApprovalRequest).not.toHaveBeenCalled();
    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });

  it("previews All-app impact, approval behavior, and overrides", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 2 });
    mocks.getApprovalPolicy.mockResolvedValue({
      enabled: true,
      approverEmails: ["admin@example.test"],
    });
    mocks.resourceListAllOwners.mockResolvedValue([
      {
        id: "workspace_meta",
        owner: "__workspace__",
        path: "context/brand.md",
        updatedAt: 1,
      },
      {
        id: "shared_meta",
        owner: "__shared__",
        path: "context/brand.md",
        updatedAt: 2,
      },
      {
        id: "personal_meta",
        owner: "person@example.test",
        path: "context/brand.md",
        updatedAt: 3,
      },
    ]);
    const state = {
      resources: [
        {
          id: "global_1",
          ownerEmail: "owner@example.test",
          orgId: "org_123",
          kind: "knowledge",
          name: "Brand",
          description: null,
          path: "context/brand.md",
          content: "# Brand",
          scope: "all",
          createdBy: "owner@example.test",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      grants: [],
    };
    mocks.getDb.mockReturnValue(createFakeDb(state));

    const result = await previewWorkspaceResourceChange({
      operation: "update",
      resourceId: "global_1",
      scope: "all",
    });

    expect(result.affectsAllApps).toBe(true);
    expect(result.approval).toEqual({
      policyEnabled: true,
      willRequestApproval: true,
    });
    expect(result.overrides).toEqual(
      expect.objectContaining({
        count: 2,
        sharedCount: 1,
        personalCount: 1,
      }),
    );
    expect(result.overrides.items.map((item) => item.owner)).toEqual([
      "__shared__",
      "person@example.test",
    ]);
  });
});
