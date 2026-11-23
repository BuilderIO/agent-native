import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Role-level fixtures for the schema-refresh permission. The `readBrowsableDataConnection`
 * seam reproduces the canonical read contract: a 404 when this user holds no
 * grant, otherwise the stored connection (including disabled and draft rows,
 * which the real caller reads with `includeDisabled`). No provider, credential
 * or network access.
 */
interface AccessState {
  actor: { userEmail: string; orgId: string } | null;
  manager: boolean;
  explorer: boolean;
  aiIncluded: boolean;
  granted: boolean;
  missing: boolean;
  readError: { errorCode: string; message: string } | null;
  connection: {
    id: string;
    provider: string;
    label: string;
    status: "connected" | "disabled";
    orgId: string | null;
    ownerEmail: string;
    allowedUsers: string[];
    config: Record<string, unknown>;
    credentialRefs: never[];
  };
  reads: string[];
  providerPages: { connectionId: string; first: number; after?: string }[];
  settingWrites: number;
  settings: Map<string, unknown>;
  /** Runs inside the provider read, so a race can be staged mid-refresh. */
  onPage?: (() => void) | null;
  /** Runs on guard entry, so a race can be staged between check and lease. */
  onGuardEnter?: (() => void) | null;
}

const state = vi.hoisted(
  () =>
    ({
      actor: { userEmail: "qa-query@example.invalid", orgId: "qa-workspace" },
      manager: false,
      explorer: true,
      aiIncluded: true,
      granted: true,
      missing: false,
      readError: null,
      connection: undefined,
      reads: [],
      providerPages: [],
      settingWrites: 0,
      settings: new Map<string, unknown>(),
      onPage: null,
      onGuardEnter: null,
    }) as unknown as AccessState,
);

const connectionId = "qa-connection";
const org = "qa-workspace";

function connectionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: connectionId,
    provider: "bigquery",
    label: "QA connection",
    status: "connected" as const,
    orgId: org,
    ownerEmail: "qa-owner@example.invalid",
    allowedUsers: [] as string[],
    config: {},
    credentialRefs: [],
    ...overrides,
  };
}

vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => {
    if (!state.actor) {
      const { fail } = await import("@agent-native/core/action");
      fail("Sign in to continue.", {
        statusCode: 401,
        errorCode: "sign_in_required",
      });
    }
    const actor = state.actor!;
    return { ownerEmail: actor.userEmail, orgId: actor.orgId };
  },
  currentWorkspaceCapabilities: async () => ({
    isManagerOrAbove: state.manager,
    allows: () => state.explorer || state.manager,
    roles: state.manager ? ["manager"] : state.explorer ? ["explorer"] : [],
  }),
}));

vi.mock("./data-connections.js", () => ({
  readBrowsableDataConnection: async (id: string) => {
    state.reads.push(id);
    if (state.readError)
      throw Object.assign(new Error(state.readError.message), state.readError);
    if (state.missing || !state.granted) {
      const { fail } = await import("@agent-native/core/action");
      fail("Data connection not found.", {
        statusCode: 404,
        errorCode: "data_connection_not_found",
      });
    }
    return { ...state.connection, id };
  },
  connectionIncludedForAgent: async () => state.aiIncluded,
  connectionPresentation: async () => ({
    description: "",
    effectiveAiUsage: state.aiIncluded ? "included" : "excluded",
    descriptionInitialized: false,
    aiUsageInitialized: false,
    annotationRevision: 0,
  }),
  listConnectionDatasets: async (input: {
    connectionId: string;
    first: number;
    after?: string;
  }) => {
    state.providerPages.push({ ...input });
    state.onPage?.();
    return { items: [], endCursor: null, hasNextPage: false };
  },
}));

vi.mock("./data-connection-mutations.js", () => ({
  withConnectionGuard: async (
    _scope: unknown,
    _id: string,
    run: (tx: unknown) => Promise<unknown>,
  ) => {
    state.onGuardEnter?.();
    return run("qa-transaction");
  },
  metadataOptions: () => ({ bypassCache: true }),
}));

vi.mock("./data-resource-metadata.js", () => ({
  readConnectionDeletionState: async () => null,
  readResourcePolicyRevision: async () => 0,
}));

vi.mock("./data-change-events.js", () => ({
  noteOrgDataChange: async () => {},
}));

vi.mock("@agent-native/core/settings", () => {
  const location = (orgId: string, key: string) => `o:${orgId}:${key}`;
  return {
    getSettingEntry: async (key: string) =>
      state.settings.has(key)
        ? { found: true as const, value: state.settings.get(key) }
        : { found: false as const },
    mutateOrgSetting: async (
      orgId: string,
      key: string,
      updater: (current: unknown | null) => Record<string, unknown>,
      options?: { validateStoredValue?: (value: unknown) => void },
    ) => {
      state.settingWrites += 1;
      const at = location(orgId, key);
      const present = state.settings.has(at);
      const current = present ? (state.settings.get(at) ?? null) : null;
      if (present) options?.validateStoredValue?.(current);
      const next = updater(current);
      state.settings.set(at, next);
      return next;
    },
    deleteSetting: async (key: string) => state.settings.delete(key),
    deleteSettingIfValue: async (key: string, expected: unknown) => {
      if (JSON.stringify(state.settings.get(key)) !== JSON.stringify(expected))
        return false;
      return state.settings.delete(key);
    },
  };
});

import { refreshDataBrowserCatalog } from "./data-browser-catalog";
import { resolveSchemaRefreshAccess } from "./data-schema-refresh-access";

beforeEach(() => {
  state.actor = { userEmail: "qa-query@example.invalid", orgId: org };
  state.manager = false;
  state.explorer = true;
  state.aiIncluded = true;
  state.granted = true;
  state.missing = false;
  state.readError = null;
  state.connection = connectionFixture();
  state.reads = [];
  state.providerPages = [];
  state.settingWrites = 0;
  state.settings.clear();
  state.onPage = null;
  state.onGuardEnter = null;
});

describe("schema refresh permission for the actual actor", () => {
  it("allows a granted member when the connection flag is on", async () => {
    state.connection = connectionFixture({
      config: { canQueryCanRefreshSchema: true },
    });
    const access = await resolveSchemaRefreshAccess(connectionId);
    expect(access.allowed).toBe(true);
    expect(access.via).toBe("connection");
  });

  it("denies a granted member when an admin turned the flag off", async () => {
    state.connection = connectionFixture({
      config: { canQueryCanRefreshSchema: false },
    });
    const access = await resolveSchemaRefreshAccess(connectionId);
    expect(access.allowed).toBe(false);
    expect(access.denial).toBe("admin_only");
  });

  it("treats an absent flag as allowed", async () => {
    const access = await resolveSchemaRefreshAccess(connectionId);
    expect(access.allowed).toBe(true);
  });

  it("takes the connection read's 404 as the query-grant answer", async () => {
    state.granted = false;
    await expect(
      resolveSchemaRefreshAccess(connectionId),
    ).rejects.toMatchObject({ errorCode: "data_connection_not_found" });
  });

  it("denies a viewer-level member before any connection read", async () => {
    state.explorer = false;
    const access = await resolveSchemaRefreshAccess(connectionId);
    expect(access.allowed).toBe(false);
    expect(access.denial).toBe("workspace_capability");
    expect(state.reads).toHaveLength(0);
  });

  it("allows a manager when the connection flag is off", async () => {
    state.manager = true;
    state.connection = connectionFixture({
      config: { canQueryCanRefreshSchema: false },
    });
    const access = await resolveSchemaRefreshAccess(connectionId);
    expect(access.allowed).toBe(true);
    expect(access.via).toBe("manager");
    // The manager answer still comes from a real connection read.
    expect(state.reads).toEqual([connectionId]);
  });

  it("keeps an unknown or other-workspace connection a 404 for a manager", async () => {
    state.manager = true;
    state.missing = true;
    await expect(
      resolveSchemaRefreshAccess("other-org-connection"),
    ).rejects.toMatchObject({ errorCode: "data_connection_not_found" });
  });

  it("denies a manager an inactive connection", async () => {
    state.manager = true;
    state.connection = connectionFixture({ config: { draft: true } });
    const draft = await resolveSchemaRefreshAccess(connectionId);
    expect(draft.allowed).toBe(false);
    expect(draft.denial).toBe("connection_inactive");

    state.connection = connectionFixture({ status: "disabled" });
    const disabled = await resolveSchemaRefreshAccess(connectionId);
    expect(disabled.allowed).toBe(false);
    expect(disabled.denial).toBe("connection_inactive");
  });

  it("denies a draft or disabled connection to a granted member", async () => {
    state.connection = connectionFixture({ status: "disabled" });
    const access = await resolveSchemaRefreshAccess(connectionId);
    expect(access.allowed).toBe(false);
    expect(access.denial).toBe("connection_inactive");
  });

  it("reports an unreadable lookup as a typed failure instead of false", async () => {
    state.readError = {
      errorCode: "settings_unavailable",
      message: "settings store offline",
    };
    await expect(
      resolveSchemaRefreshAccess(connectionId),
    ).rejects.toMatchObject({
      errorCode: "data_schema_refresh_access_unavailable",
      statusCode: 503,
    });
  });
});

describe("refresh admission for a connection-scoped actor", () => {
  it("refreshes for a granted member and reads the provider", async () => {
    const result = await refreshDataBrowserCatalog(connectionId, {
      authorization: "connection",
      caller: "frontend",
    });
    expect(result.refreshState).toBe("ready");
    expect(state.providerPages).toHaveLength(1);
  });

  it("denies before any provider page when the flag is off", async () => {
    state.connection = connectionFixture({
      config: { canQueryCanRefreshSchema: false },
    });
    await expect(
      refreshDataBrowserCatalog(connectionId, { authorization: "connection" }),
    ).rejects.toMatchObject({ errorCode: "data_catalog_refresh_denied" });
    expect(state.providerPages).toHaveLength(0);
    expect(state.settingWrites).toBe(0);
  });

  it("denies before any provider page when the connection is inactive", async () => {
    state.manager = true;
    state.connection = connectionFixture({ config: { draft: true } });
    await expect(
      refreshDataBrowserCatalog(connectionId, { authorization: "connection" }),
    ).rejects.toMatchObject({ errorCode: "data_catalog_refresh_denied" });
    expect(state.providerPages).toHaveLength(0);
  });

  it("keeps the agent AI-policy gate on top of a granted permission", async () => {
    state.aiIncluded = false;
    await expect(
      refreshDataBrowserCatalog(connectionId, {
        authorization: "connection",
        caller: "agent",
      }),
    ).rejects.toMatchObject({ errorCode: "data_connection_ai_disabled" });
    expect(state.providerPages).toHaveLength(0);
  });

  it("lets a manager refresh a connection whose flag is off", async () => {
    state.manager = true;
    state.connection = connectionFixture({
      config: { canQueryCanRefreshSchema: false },
    });
    const result = await refreshDataBrowserCatalog(connectionId, {
      authorization: "connection",
      caller: "frontend",
    });
    expect(result.refreshState).toBe("ready");
  });
});

describe("revocation while provider pages are read", () => {
  function storedSnapshot() {
    return state.settings.get(
      `o:${org}:analytics.catalog:v1:${connectionId}`,
    ) as
      | {
          refreshState: string;
          totalCount: number;
          resources: unknown[];
          refreshError: { code: string } | null;
        }
      | undefined;
  }

  it("fails when the connection flag is turned off mid-refresh", async () => {
    state.connection = connectionFixture({
      config: { canQueryCanRefreshSchema: true },
    });
    state.onPage = () => {
      state.connection = connectionFixture({
        config: { canQueryCanRefreshSchema: false },
      });
    };
    await expect(
      refreshDataBrowserCatalog(connectionId, {
        authorization: "connection",
        caller: "frontend",
      }),
    ).rejects.toMatchObject({
      errorCode: "data_catalog_refresh_denied",
      statusCode: 403,
    });
    const snapshot = storedSnapshot();
    expect(snapshot?.refreshState).toBe("failed");
    expect(snapshot?.totalCount).toBe(0);
    expect(snapshot?.resources).toEqual([]);
  });

  it("fails when the workspace role is revoked mid-refresh", async () => {
    state.onPage = () => {
      state.explorer = false;
    };
    await expect(
      refreshDataBrowserCatalog(connectionId, {
        authorization: "connection",
        caller: "agent",
      }),
    ).rejects.toMatchObject({
      errorCode: "data_catalog_refresh_denied",
      statusCode: 403,
    });
    const snapshot = storedSnapshot();
    expect(snapshot?.refreshState).toBe("failed");
    expect(snapshot?.resources).toEqual([]);
  });

  it("returns a failed state instead of a successful refresh after revocation", async () => {
    state.onPage = () => {
      state.granted = false;
    };
    await expect(
      refreshDataBrowserCatalog(connectionId, {
        authorization: "connection",
        caller: "frontend",
      }),
    ).rejects.toMatchObject({ errorCode: "data_catalog_refresh_denied" });
    expect(storedSnapshot()?.refreshState).not.toBe("ready");
  });
});

describe("revocation before the refresh lease is taken", () => {
  it("reads no page and writes no lease when the flag goes off at guard entry", async () => {
    state.connection = connectionFixture({
      config: { canQueryCanRefreshSchema: true },
    });
    state.onGuardEnter = () => {
      state.connection = connectionFixture({
        config: { canQueryCanRefreshSchema: false },
      });
      state.onGuardEnter = null;
    };
    await expect(
      refreshDataBrowserCatalog(connectionId, {
        authorization: "connection",
        caller: "frontend",
      }),
    ).rejects.toMatchObject({
      errorCode: "data_catalog_refresh_denied",
      statusCode: 403,
    });
    expect(
      state.settings.has(`o:${org}:analytics.catalog:v1:${connectionId}`),
    ).toBe(false);
    expect(state.providerPages).toHaveLength(0);
  });
});
