import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDbExec: vi.fn(),
  isPostgres: vi.fn(() => false),
  currentOwnerEmail: vi.fn(() => "owner@example.test"),
  currentOrgId: vi.fn(() => "org_123"),
  recordAudit: vi.fn(async () => undefined),
  resourcePut: vi.fn(async () => undefined),
  resourceGetByPath: vi.fn(async () => null),
  resourceDeleteByPath: vi.fn(async () => undefined),
  getOrgSetting: vi.fn(async () => null),
  getUserSetting: vi.fn(async () => null),
  putOrgSetting: vi.fn(async () => undefined),
  putUserSetting: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => mocks.getDbExec(),
  isPostgres: () => mocks.isPostgres(),
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
  currentOwnerEmail: () => mocks.currentOwnerEmail(),
  currentOrgId: () => mocks.currentOrgId(),
  recordAudit: (...args: any[]) => mocks.recordAudit(...args),
}));

vi.mock("@agent-native/core/resources/store", () => ({
  SHARED_OWNER: "__shared__",
  resourcePut: (...args: any[]) => mocks.resourcePut(...args),
  resourceGetByPath: (...args: any[]) => mocks.resourceGetByPath(...args),
  resourceDeleteByPath: (...args: any[]) => mocks.resourceDeleteByPath(...args),
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
  listWorkspaceResourcesForApp,
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

function createFakeDb(state: {
  resources: ResourceRow[];
  grants?: GrantRow[];
}) {
  const latestResource = () => state.resources.at(-1);

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
      set: vi.fn((updates: Partial<ResourceRow | GrantRow>) => ({
        where: vi.fn(async () => {
          const resource = latestResource();
          if (resource) Object.assign(resource, updates);
        }),
      })),
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

beforeEach(() => {
  mocks.getDb.mockReturnValue(createFakeDb({ resources: [] }));
  mocks.getDbExec.mockReturnValue({ execute: vi.fn() });
  mocks.isPostgres.mockReturnValue(false);
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
      "__shared__",
      "context/company.md",
      expect.stringContaining("# Company Profile"),
      "text/markdown",
      expect.objectContaining({ createdBy: "system" }),
    );
    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org_123",
      "dispatch-starter-workspace-resources",
      expect.objectContaining({
        version: 1,
        resources: STARTER_GLOBAL_WORKSPACE_RESOURCES.map((resource) => ({
          path: resource.path,
          kind: resource.kind,
          scope: resource.scope,
        })),
      }),
    );
  });

  it("skips starter seeding after the scope marker exists", async () => {
    mocks.getOrgSetting.mockResolvedValueOnce({ version: 1 });

    await ensureStarterWorkspaceResources({
      ownerEmail: "owner@example.test",
      orgId: "org_123",
    });

    expect(mocks.getDbExec).not.toHaveBeenCalled();
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("materializes scope=all starter resources into the core shared resource store", async () => {
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
      "__shared__",
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
      "__shared__",
      "remote-agents/research.json",
      '{"name":"Research"}',
      "application/json",
      expect.any(Object),
    );
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
    expect(mocks.resourceDeleteByPath).not.toHaveBeenCalled();
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
    mocks.resourceGetByPath.mockResolvedValueOnce({
      id: "shared_1",
      owner: "__shared__",
      path: "instructions/starter.md",
      metadata: dispatchMetadata(state.resources[0]),
    });

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceDeleteByPath).toHaveBeenCalledWith(
      "__shared__",
      "instructions/starter.md",
    );
    expect(mocks.resourcePut).not.toHaveBeenCalled();
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
      owner: "__shared__",
      path: "instructions/starter.md",
      metadata: JSON.stringify({
        source: "manual",
        resourceId: "resource_1",
      }),
    });

    await updateWorkspaceResource("resource_1", { scope: "selected" });

    expect(mocks.resourceDeleteByPath).not.toHaveBeenCalled();
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
    mocks.resourceGetByPath.mockResolvedValueOnce({
      id: "shared_1",
      owner: "__shared__",
      path: "context/positioning.md",
      metadata: dispatchMetadata(state.resources[0]),
    });

    await deleteWorkspaceResource("resource_1");

    expect(mocks.resourceDeleteByPath).toHaveBeenCalledWith(
      "__shared__",
      "context/positioning.md",
    );
  });

  it("lists the global and granted workspace resources an app receives", async () => {
    mocks.getOrgSetting.mockResolvedValue({ version: 1 });
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
        source: "global",
        autoLoaded: true,
        grantId: null,
      }),
    );
    expect(result.resources[1]).toEqual(
      expect.objectContaining({
        source: "grant",
        autoLoaded: false,
        grantId: "grant_1",
        syncedAt: 123,
      }),
    );
  });
});
