import { runWithRequestContext } from "@agent-native/core/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateWorkspaceAppDescription,
  getAppCreationSettings,
  listAvailableWorkspaceTemplates,
  listWorkspaceApps,
  scaffoldWorkspaceAppFromTemplate,
  setAppCreationSettings,
  startWorkspaceAppCreation,
  updateWorkspaceAppMetadata,
} from "./app-creation-store.js";

const originalFetch = globalThis.fetch;
const settingsKey = "dispatch-app-creation-settings:user:dev@example.test";

const mocks = vi.hoisted(() => {
  const settings = new Map<string, unknown>();
  const state = {
    orgRole: "admin" as string | null,
  };
  return {
    settings,
    state,
    getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
    mutateSetting: vi.fn(
      async (key: string, updater: (current: any) => any) => {
        const next = await updater(settings.get(key) ?? null);
        settings.set(key, next);
        return next;
      },
    ),
    putSetting: vi.fn(async (key: string, value: unknown) => {
      settings.set(key, value);
    }),
    getOrgSetting: vi.fn(async () => null),
    resolveAccess: vi.fn(async () => ({
      role: "viewer",
      resource: {},
    })),
    getDbExec: vi.fn(() => ({
      execute: vi.fn(async (statement: unknown) => {
        const sql =
          typeof statement === "string"
            ? statement
            : String((statement as { sql?: unknown })?.sql ?? "");
        if (sql.includes("SELECT id FROM workspace_apps")) {
          return { rows: [], rowsAffected: 0 };
        }
        return {
          rows: state.orgRole ? [{ role: state.orgRole }] : [],
          rowsAffected: 0,
        };
      }),
    })),
    resolveBuilderCredentialsDetailed: vi.fn(async () => ({
      privateKey: null as string | null,
      publicKey: null as string | null,
      userId: null as string | null,
      orgName: null,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
      source: null,
      lookupFailed: false,
    })),
    ensureBuilderProject: vi.fn(),
    runBuilderAgent: vi.fn(),
    getBuilderBranchProjectId: vi.fn(() => ""),
    writeAppSecret: vi.fn(async () => "secret-id"),
    deleteAppSecret: vi.fn(async () => true),
  };
});

vi.mock("@agent-native/core/secrets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/secrets")>();
  return {
    ...actual,
    writeAppSecret: (...args: any[]) => mocks.writeAppSecret(...args),
    deleteAppSecret: (...args: any[]) => mocks.deleteAppSecret(...args),
  };
});

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core/db")>();
  return {
    ...actual,
    getDbExec: () => mocks.getDbExec(),
  };
});

vi.mock("@agent-native/core/settings", () => ({
  getSetting: (...args: any[]) => mocks.getSetting(...args),
  mutateSetting: (...args: any[]) => mocks.mutateSetting(...args),
  putSetting: (...args: any[]) => mocks.putSetting(...args),
  getOrgSetting: (...args: any[]) => mocks.getOrgSetting(...args),
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    resolveAccess: (...args: any[]) => mocks.resolveAccess(...args),
  };
});

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    resolveBuilderCredentialsDetailed: (...args: any[]) =>
      mocks.resolveBuilderCredentialsDetailed(...args),
    ensureBuilderProject: (...args: any[]) =>
      mocks.ensureBuilderProject(...args),
    runBuilderAgent: (...args: any[]) => mocks.runBuilderAgent(...args),
    getBuilderBranchProjectId: (...args: any[]) =>
      mocks.getBuilderBranchProjectId(...args),
  };
});

vi.mock("./dispatch-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dispatch-store.js")>();
  return {
    ...actual,
    recordAudit: vi.fn(async () => {}),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.settings.clear();
  mocks.getOrgSetting.mockReset();
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.mutateSetting.mockReset();
  mocks.mutateSetting.mockImplementation(
    async (key: string, updater: (current: any) => any) => {
      const next = await updater(mocks.settings.get(key) ?? null);
      mocks.settings.set(key, next);
      return next;
    },
  );
  mocks.state.orgRole = "admin";
  mocks.getDbExec.mockReset();
  mocks.getDbExec.mockImplementation(() => ({
    execute: vi.fn(async (statement: unknown) => {
      const sql =
        typeof statement === "string"
          ? statement
          : String((statement as { sql?: unknown })?.sql ?? "");
      if (sql.includes("SELECT id FROM workspace_apps")) {
        return { rows: [], rowsAffected: 0 };
      }
      return {
        rows: mocks.state.orgRole ? [{ role: mocks.state.orgRole }] : [],
        rowsAffected: 0,
      };
    }),
  }));
  mocks.resolveAccess.mockReset();
  mocks.resolveAccess.mockResolvedValue({ role: "viewer", resource: {} });
  mocks.resolveBuilderCredentialsDetailed.mockResolvedValue({
    privateKey: null,
    publicKey: null,
    userId: null,
    orgName: null,
    orgKind: null,
    subscription: null,
    subscriptionLevel: null,
    subscriptionName: null,
    isEnterprise: null,
    isFreeAccount: null,
    source: null,
    lookupFailed: false,
  });
  mocks.getBuilderBranchProjectId.mockReturnValue("");
  mocks.ensureBuilderProject.mockReset();
  globalThis.fetch = originalFetch;
});

describe("getAppCreationSettings", () => {
  it("treats the Dispatch project as authoritative over the environment", async () => {
    mocks.settings.set("dispatch-app-creation-settings:org:builder_io", {
      builderProjectId: "dispatch-project",
    });
    vi.stubEnv("DISPATCH_BUILDER_PROJECT_ID", "stale-env-project");

    const result = await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "builder_io" },
      () => getAppCreationSettings(),
    );

    expect(result).toMatchObject({
      builderProjectId: "dispatch-project",
      builderProjectIdSource: "dispatch",
      envBuilderProjectId: "stale-env-project",
    });
  });

  it("treats an explicit Dispatch null as disabled over the environment", async () => {
    mocks.settings.set("dispatch-app-creation-settings:org:builder_io", {
      builderProjectId: null,
    });
    vi.stubEnv("DISPATCH_BUILDER_PROJECT_ID", "stale-env-project");

    const result = await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "builder_io" },
      () => getAppCreationSettings(),
    );

    expect(result).toMatchObject({
      builderProjectId: null,
      builderProjectIdSource: "dispatch",
      envBuilderProjectId: "stale-env-project",
      builderBranchingEnabled: false,
    });
  });
});

describe("listWorkspaceApps", () => {
  function stubNoPendingContext() {
    for (const key of [
      "BRANCH",
      "HEAD",
      "VERCEL_GIT_COMMIT_REF",
      "CF_PAGES_BRANCH",
      "RENDER_GIT_BRANCH",
      "FLY_BRANCH",
      "WORKSPACE_GATEWAY_URL",
      "DEPLOY_PRIME_URL",
      "DEPLOY_URL",
      "URL",
      "APP_URL",
      "BETTER_AUTH_URL",
    ]) {
      vi.stubEnv(key, "");
    }
  }

  function stubManifest(
    apps = [{ id: "dispatch", name: "Dispatch", path: "/dispatch" }],
  ) {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", JSON.stringify(apps));
  }

  function pendingApp(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      description: `${id} is being created`,
      path: `/${id}`,
      builderUrl: `https://builder.io/app/projects/project-123/branch/${id}`,
      branchName: id,
      projectId: "project-123",
      createdAt: "2026-05-20T18:00:00.000Z",
      updatedAt: "2026-05-20T18:00:00.000Z",
      expiresAt: "2999-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("prefers the live workspace gateway manifest when available", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          apps: [
            {
              id: "dispatch",
              name: "Dispatch",
              path: "/dispatch",
            },
            {
              id: "todo",
              name: "Todo",
              description: "Tracks personal tasks and follow-ups",
              path: "/todo",
              audience: "public",
              publicPaths: ["/"],
              protectedPaths: ["/admin"],
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "dispatch", name: "Dispatch", path: "/dispatch" }]),
    );

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    const [urlArg, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(urlArg)).toBe("http://127.0.0.1:8080/_workspace/apps");
    expect(init).toEqual(
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );
    expect(apps.map((app) => app.id)).toEqual(["dispatch", "todo"]);
    expect(apps.find((app) => app.id === "todo")?.description).toBe(
      "Tracks personal tasks and follow-ups",
    );
    expect(apps.find((app) => app.id === "todo")?.audience).toBe("public");
    expect(apps.find((app) => app.id === "todo")?.publicPaths).toEqual(["/"]);
    expect(apps.find((app) => app.id === "todo")?.protectedPaths).toEqual([
      "/admin",
    ]);
  });

  it("falls back to the authenticated workspace action for hosted gateways", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "atlas",
              name: "Atlas",
              path: "/atlas",
              url: "https://agent-workspace.builder.io/atlas",
            },
          ]),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://agent-workspace.builder.io");

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://agent-workspace.builder.io/_agent-native/actions/list-workspace-apps?includeAgentCards=false&audience=all",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    );
    expect(apps.map((app) => app.id)).toEqual(["atlas"]);
    expect(apps[0]?.url).toBe("https://agent-workspace.builder.io/atlas");
  });

  it("keeps the exact request org in hosted registry tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://agent-workspace.builder.io");

    await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "org-exact" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    const authorization = fetchMock.mock.calls[1]?.[1]?.headers
      ?.Authorization as string;
    const tokenPayload = JSON.parse(
      Buffer.from(
        authorization.slice("Bearer ".length).split(".")[1]!,
        "base64url",
      ).toString(),
    ) as { org_id?: string };
    expect(tokenPayload.org_id).toBe("org-exact");
  });

  it("falls back to local discovery when the gateway URL is malformed", async () => {
    stubManifest();
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "not-a-url");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("keeps legacy apps organization-visible when the org default cannot be read", async () => {
    stubManifest([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
      { id: "private-app", name: "Private app", path: "/private-app" },
    ]);
    mocks.getOrgSetting.mockRejectedValueOnce(
      new Error("settings store unavailable"),
    );

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "org-123" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "private-app"]);
  });

  it("fails closed when the workspace-app access schema is unavailable", async () => {
    stubManifest([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
      { id: "private-app", name: "Private app", path: "/private-app" },
    ]);
    mocks.resolveAccess.mockRejectedValueOnce(
      new Error("no such table: workspace_app_shares"),
    );

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "org-123" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("does not expose the workspace app registry without an authenticated user", async () => {
    stubNoPendingContext();
    stubManifest([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
      { id: "private-app", name: "Private app", path: "/private-app" },
    ]);

    const apps = await runWithRequestContext({ orgId: "org-123" }, () =>
      listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps).toEqual([]);
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
  });

  it("does not apply the current default retroactively to legacy apps", async () => {
    stubNoPendingContext();
    stubManifest([
      {
        id: "legacy-app",
        name: "Legacy app",
        path: "/legacy-app",
      },
      {
        id: "new-app",
        name: "New app",
        path: "/new-app",
        createdBy: "creator@example.test",
      },
    ]);
    mocks.getOrgSetting.mockResolvedValueOnce({ visibility: "private" });
    const execute = vi.fn(async (statement: unknown) => {
      const sql =
        typeof statement === "string"
          ? statement
          : String((statement as { sql?: unknown })?.sql ?? "");
      if (sql.includes("SELECT id, owner_email, org_id, visibility")) {
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    mocks.getDbExec.mockReturnValue({ execute });

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "org-123" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.find((app) => app.id === "legacy-app")?.visibility).toBe("org");
    expect(apps.find((app) => app.id === "new-app")?.visibility).toBe("org");
    expect(mocks.getOrgSetting).not.toHaveBeenCalled();
    const inserts = execute.mock.calls.filter(([statement]) =>
      String((statement as { sql?: unknown })?.sql ?? "").includes(
        "INSERT INTO workspace_apps",
      ),
    );
    expect(inserts.map(([statement]) => (statement as any).args?.[3])).toEqual([
      "org",
      "org",
    ]);
  });

  it("projects exact custom SSO eligibility without exposing registry details", async () => {
    stubNoPendingContext();
    stubManifest([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
      {
        id: "workspace-reports",
        name: "Workspace Reports",
        path: "/workspace-reports",
        url: "https://reports.example.com/workspace-reports",
      },
      {
        id: "unregistered",
        name: "Unregistered",
        path: "/unregistered",
        url: "https://unregistered.example.com",
      },
    ]);
    vi.stubEnv(
      "IDENTITY_SSO_APP_REGISTRY_JSON",
      JSON.stringify([
        {
          appId: "workspace-reports",
          clientId: "workspace-reports-client",
          origin: "https://reports.example.com",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    );

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.find((app) => app.id === "workspace-reports")).toMatchObject({
      workspaceSso: true,
    });
    expect(apps.find((app) => app.id === "unregistered")).toMatchObject({
      workspaceSso: false,
    });
  });

  it("filters workspace apps by audience", async () => {
    stubNoPendingContext();
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([
        {
          id: "dispatch",
          name: "Dispatch",
          path: "/dispatch",
          audience: "internal",
        },
        {
          id: "portal",
          name: "Portal",
          path: "/portal",
          audience: "public",
        },
      ]),
    );

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () =>
        listWorkspaceApps({
          includeAgentCards: false,
          audience: "public",
        }),
    );

    expect(apps.map((app) => app.id)).toEqual(["portal"]);
  });

  it("shows current branch and legacy pending Builder app rows", async () => {
    stubManifest();
    vi.stubEnv("BRANCH", "feature-a");
    mocks.settings.set(settingsKey, {
      pendingApps: [
        pendingApp("mail", {
          builderUrl: "https://builder.io/app/projects/project-123/branch/old",
        }),
        pendingApp("mail", {
          contextId: "branch:feature-a",
          contextLabel: "Branch: feature-a",
          builderUrl:
            "https://builder.io/app/projects/project-123/branch/feature-a",
        }),
        pendingApp("calendar", {
          contextId: "branch:feature-b",
          contextLabel: "Branch: feature-b",
        }),
        pendingApp("legacy"),
      ],
    });

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "legacy", "mail"]);
    expect(apps.find((app) => app.id === "mail")?.statusLabel).toBe(
      "Pending Builder branch",
    );
    expect(apps.filter((app) => app.id === "mail")).toHaveLength(1);
    expect(apps.find((app) => app.id === "mail")?.builderUrl).toContain(
      "feature-a",
    );
  });

  it("keeps unscoped legacy pending rows visible when there is no deploy context", async () => {
    stubNoPendingContext();
    stubManifest();
    mocks.settings.set(settingsKey, {
      pendingApps: [pendingApp("legacy")],
    });

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "legacy"]);
  });

  it("hides private pending apps from non-creators", async () => {
    stubNoPendingContext();
    stubManifest();
    mocks.settings.set(settingsKey, {
      pendingApps: [
        pendingApp("private-pending", {
          visibility: "private",
          createdBy: "creator@example.test",
          owner: "creator@example.test",
        }),
      ],
    });

    const apps = await runWithRequestContext(
      { userEmail: "viewer@example.test", orgId: "org-123" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("fails closed when a private app access record cannot be inserted", async () => {
    stubNoPendingContext();
    stubManifest([
      { id: "scaffolded", name: "Scaffolded", path: "/scaffolded" },
    ]);
    mocks.settings.set("workspace-app-metadata:org:org-123", {
      apps: {
        scaffolded: {
          visibility: "private",
          createdBy: "creator@example.test",
        },
      },
    });
    const execute = vi.fn(async (statement: unknown) => {
      const sql =
        typeof statement === "string"
          ? statement
          : String((statement as { sql?: unknown })?.sql ?? "");
      if (sql.includes("SELECT id, owner_email, org_id, visibility")) {
        return { rows: [], rowsAffected: 0 };
      }
      throw new Error("workspace app access insert failed");
    });
    mocks.getDbExec.mockReturnValue({ execute });
    mocks.resolveAccess.mockResolvedValue(null);

    const apps = await runWithRequestContext(
      { userEmail: "viewer@example.test", orgId: "org-123" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps).toEqual([]);
  });

  it("hides expired pending Builder app rows", async () => {
    stubManifest();
    vi.stubEnv("BRANCH", "feature-a");
    mocks.settings.set(settingsKey, {
      pendingApps: [
        pendingApp("old-app", {
          contextId: "branch:feature-a",
          expiresAt: "2000-01-01T00:00:00.000Z",
        }),
        pendingApp("fresh-app", {
          contextId: "branch:feature-a",
        }),
      ],
    });

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "fresh-app"]);
  });

  it("does not show a pending row after the app is present in the manifest", async () => {
    stubNoPendingContext();
    stubManifest([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
      { id: "mail", name: "Mail", path: "/mail" },
    ]);
    mocks.settings.set(settingsKey, {
      pendingApps: [pendingApp("mail")],
    });

    const apps = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listWorkspaceApps({ includeAgentCards: false }),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "mail"]);
    expect(apps.find((app) => app.id === "mail")?.status).toBe("ready");
  });

  it("lets workspace admins update app display metadata", async () => {
    stubNoPendingContext();
    stubManifest([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
      {
        id: "todo",
        name: "Todo",
        description: "Original description",
        path: "/todo",
      },
    ]);

    const updated = await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "org-123" },
      () =>
        updateWorkspaceAppMetadata({
          appId: "todo",
          name: "Todo Board",
          description: "Tracks team work.",
        }),
    );

    expect(updated.name).toBe("Todo Board");
    expect(updated.description).toBe("Tracks team work.");
    expect(mocks.settings.get("workspace-app-metadata:org:org-123")).toEqual({
      apps: {
        todo: expect.objectContaining({
          name: "Todo Board",
          description: "Tracks team work.",
          updatedBy: "dev@example.test",
        }),
      },
    });
  });

  it("lets workspace members update app display metadata", async () => {
    mocks.state.orgRole = "member";
    stubNoPendingContext();
    stubManifest([
      {
        id: "todo",
        name: "Todo",
        description: "Original description",
        path: "/todo",
      },
    ]);

    const updated = await runWithRequestContext(
      { userEmail: "dev@example.test", orgId: "org-123" },
      () =>
        updateWorkspaceAppMetadata({
          appId: "todo",
          name: "Todo Board",
          description: "Tracks team work.",
        }),
    );

    expect(updated).toMatchObject({
      name: "Todo Board",
      description: "Tracks team work.",
    });
    expect(mocks.settings.get("workspace-app-metadata:org:org-123")).toEqual({
      apps: {
        todo: expect.objectContaining({
          name: "Todo Board",
          description: "Tracks team work.",
          updatedBy: "dev@example.test",
        }),
      },
    });
  });

  it("generates a concise seed description from an app prompt", () => {
    expect(
      generateWorkspaceAppDescription(
        "Build me an app that tracks customer onboarding risks and handoffs",
        "customer-onboarding",
      ),
    ).toBe("Tracks customer onboarding risks and handoffs.");
  });

  it("offers Brain and Assets as workspace template tiles", async () => {
    stubNoPendingContext();
    stubManifest([{ id: "dispatch", name: "Dispatch", path: "/dispatch" }]);

    const templates = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listAvailableWorkspaceTemplates(),
    );

    expect(templates.map((template) => template.name)).toEqual(
      expect.arrayContaining(["brain", "assets"]),
    );
  });

  it("hides local scaffold templates in hosted runtimes", async () => {
    stubNoPendingContext();
    vi.stubEnv("NETLIFY", "1");
    stubManifest([{ id: "dispatch", name: "Dispatch", path: "/dispatch" }]);

    const templates = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => listAvailableWorkspaceTemplates(),
    );

    expect(templates).toEqual([]);
  });
});

describe("startWorkspaceAppCreation", () => {
  const leakedProjectId = "940ebc5a83164aa6a37dde445e494f3a";

  function stubHostedRuntime() {
    vi.stubEnv("NODE_ENV", "production");
  }

  function stubBuilderProjectConfigured() {
    vi.stubEnv("DISPATCH_BUILDER_PROJECT_ID", leakedProjectId);
  }

  function credentials(overrides: Record<string, unknown> = {}) {
    return {
      privateKey: null,
      publicKey: null,
      userId: null,
      orgName: null,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
      source: null,
      lookupFailed: false,
      ...overrides,
    };
  }

  function create(
    appId = "onboarding",
    ctx: { userEmail: string; orgId?: string } = {
      userEmail: "dev@example.test",
    },
  ) {
    return runWithRequestContext(ctx, () =>
      startWorkspaceAppCreation({ prompt: "Track onboarding tasks", appId }),
    );
  }

  it("persists the private default for local-agent app creation", async () => {
    mocks.getOrgSetting.mockResolvedValueOnce({ visibility: "private" });

    const result = (await create("onboarding", {
      userEmail: "dev@example.test",
      orgId: "org-123",
    })) as any;

    expect(result.mode).toBe("local-agent");
    expect(
      mocks.settings.get("workspace-app-metadata:org:org-123"),
    ).toMatchObject({
      apps: {
        onboarding: { visibility: "private" },
      },
    });
  });

  it("rejects a cross-member collision with an active pending app id", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.getOrgSetting.mockResolvedValueOnce({ visibility: "private" });
    mocks.settings.set("dispatch-app-creation-settings:org:org-123", {
      pendingApps: [
        {
          id: "onboarding",
          name: "Onboarding",
          description: "Already being created",
          path: "/onboarding",
          builderUrl:
            "https://builder.io/app/projects/project-1/branch/onboarding",
          branchName: "onboarding",
          projectId: "project-1",
          createdBy: "creator@example.test",
          owner: "creator@example.test",
          createdAt: "2026-08-19T21:00:00.000Z",
          updatedAt: "2026-08-19T21:00:00.000Z",
          expiresAt: "2999-01-01T00:00:00.000Z",
        },
      ],
    });

    await expect(
      create("onboarding", {
        userEmail: "other@example.test",
        orgId: "org-123",
      }),
    ).rejects.toThrow("already being created by another member");
    expect(mocks.runBuilderAgent).not.toHaveBeenCalled();
    expect(
      mocks.settings.get("dispatch-app-creation-settings:org:org-123"),
    ).toMatchObject({
      pendingApps: [
        expect.objectContaining({ createdBy: "creator@example.test" }),
      ],
    });
  });

  it("rejects a collision from another deployment context", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.settings.set("dispatch-app-creation-settings:org:org-123", {
      pendingApps: [
        {
          id: "onboarding",
          name: "Onboarding",
          description: "Already being created",
          path: "/onboarding",
          contextId: "branch:other-context",
          createdBy: "creator@example.test",
          owner: "creator@example.test",
          createdAt: "2026-08-19T21:00:00.000Z",
          updatedAt: "2026-08-19T21:00:00.000Z",
          expiresAt: "2999-01-01T00:00:00.000Z",
        },
      ],
    });

    await expect(
      create("onboarding", {
        userEmail: "other@example.test",
        orgId: "org-123",
      }),
    ).rejects.toThrow("already being created by another member");
    expect(mocks.runBuilderAgent).not.toHaveBeenCalled();
  });

  it("atomically reserves an app id before starting Builder", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(
      credentials({
        privateKey: "priv",
        publicKey: "pub",
        userId: "builder-user-42",
      }),
    );
    mocks.runBuilderAgent.mockImplementation(async () => {
      expect(
        mocks.settings.get("dispatch-app-creation-settings:org:org-123"),
      ).toMatchObject({
        pendingApps: [
          expect.objectContaining({
            id: "onboarding",
            createdBy: "dev@example.test",
          }),
        ],
      });
      return {
        branchName: "onboarding1",
        url: "https://builder.io/app/projects/project-1/branch/onboarding1",
        status: "processing",
      };
    });

    const result = (await create("onboarding", {
      userEmail: "dev@example.test",
      orgId: "org-123",
    })) as any;

    expect(result.mode).toBe("builder");
    expect(mocks.mutateSetting).toHaveBeenCalled();
  });

  it("releases the reservation when Builder handoff fails", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(
      credentials({
        privateKey: "priv",
        publicKey: "pub",
        userId: "builder-user-42",
      }),
    );
    mocks.runBuilderAgent.mockRejectedValue(new Error("Builder unavailable"));

    const result = (await create("onboarding", {
      userEmail: "dev@example.test",
      orgId: "org-123",
    })) as any;

    expect(result).toMatchObject({ mode: "builder-unavailable" });
    expect(
      mocks.settings.get("dispatch-app-creation-settings:org:org-123"),
    ).toMatchObject({ pendingApps: [] });
    expect(mocks.settings.get("workspace-app-metadata:org:org-123")).toBe(
      undefined,
    );
  });

  it("rejects a scaffold id already registered in the shared app registry", async () => {
    mocks.getDbExec.mockReturnValue({
      execute: vi.fn(async (statement: unknown) => {
        const sql = String((statement as { sql?: unknown })?.sql ?? "");
        if (sql.includes("SELECT id FROM workspace_apps")) {
          return { rows: [{ id: "mail" }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      }),
    });

    await expect(
      runWithRequestContext(
        { userEmail: "dev@example.test", orgId: "org-123" },
        () =>
          scaffoldWorkspaceAppFromTemplate({
            template: "mail",
            appId: "mail",
          }),
      ),
    ).rejects.toThrow("already registered");
  });

  it("returns builder-not-connected without leaking the project id when no Builder credentials are configured", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(credentials());

    const result = (await create()) as any;

    expect(result.mode).toBe("builder-unavailable");
    expect(result.reason).toBe("builder-not-connected");
    expect(result.message).not.toContain(leakedProjectId);
    expect(mocks.runBuilderAgent).not.toHaveBeenCalled();
  });

  it("returns credential-store-unavailable when the credential lookup itself fails", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(
      credentials({ lookupFailed: true }),
    );

    const result = (await create()) as any;

    expect(result.mode).toBe("builder-unavailable");
    expect(result.reason).toBe("credential-store-unavailable");
    expect(mocks.runBuilderAgent).not.toHaveBeenCalled();
  });

  it("returns builder-error with the raw failure in detail when runBuilderAgent throws", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(
      credentials({
        privateKey: "priv",
        publicKey: "pub",
        userId: "builder-user-1",
      }),
    );
    mocks.runBuilderAgent.mockRejectedValue(
      new Error("Builder keys are not configured"),
    );

    const result = (await create()) as any;

    expect(result.mode).toBe("builder-unavailable");
    expect(result.reason).toBe("builder-error");
    expect(result.detail).toBe("Builder keys are not configured");
    expect(result.message).not.toContain(leakedProjectId);
  });

  it("starts the Builder branch and passes the resolved userId through", async () => {
    stubHostedRuntime();
    stubBuilderProjectConfigured();
    mocks.getOrgSetting.mockResolvedValueOnce({ visibility: "private" });
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(
      credentials({
        privateKey: "priv",
        publicKey: "pub",
        userId: "builder-user-42",
      }),
    );
    mocks.runBuilderAgent.mockResolvedValue({
      branchName: "onboarding1",
      url: "https://builder.io/app/projects/project-1/branch/onboarding1",
      status: "processing",
    });

    const result = (await create("onboarding", {
      userEmail: "dev@example.test",
      orgId: "org-123",
    })) as any;

    expect(result.mode).toBe("builder");
    expect(mocks.runBuilderAgent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "builder-user-42" }),
    );
    const builderPrompt = String(
      mocks.runBuilderAgent.mock.calls.at(-1)?.[0]?.prompt ?? "",
    );
    expect(builderPrompt).toContain("Autonomous Builder handoff contract:");
    expect(builderPrompt).toContain(
      "do not invoke a clarification, guided-question, or choice flow",
    );
    expect(builderPrompt).toContain(
      "choose the most direct, conservative default",
    );
    expect(builderPrompt).toContain(
      "Treat the source brief's unknowns and follow-up items as assumptions",
    );
    expect(
      mocks.settings.get("workspace-app-metadata:org:org-123"),
    ).toMatchObject({
      apps: {
        onboarding: { visibility: "private" },
      },
    });
  });

  it("provisions and remembers the workspace Builder project when none is configured", async () => {
    stubHostedRuntime();
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(
      credentials({
        privateKey: "priv",
        publicKey: "pub",
        userId: "builder-user-42",
      }),
    );
    mocks.ensureBuilderProject.mockResolvedValue({
      projectId: "project-provisioned",
      name: "Agent-Native Workspace",
      repoUrl: "https://github.com/BuilderIO/builder-agent-native-workspace",
      browserUrl: "https://builder.io/app/projects/project-provisioned",
      created: true,
    });
    mocks.runBuilderAgent.mockResolvedValue({
      branchName: "onboarding1",
      url: "https://builder.io/app/projects/project-provisioned/onboarding1",
      status: "processing",
    });

    const result = (await create()) as any;

    expect(result.mode).toBe("builder");
    expect(result.projectId).toBe("project-provisioned");
    expect(mocks.ensureBuilderProject).toHaveBeenCalledWith({
      name: "Agent-Native Workspace",
      repoUrl: "https://github.com/BuilderIO/builder-agent-native-workspace",
    });
    expect(mocks.runBuilderAgent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-provisioned" }),
    );
    expect(mocks.settings.get(settingsKey)).toMatchObject({
      builderProjectId: "project-provisioned",
    });
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
  });

  it("does not let an organization member persist an auto-provisioned project", async () => {
    stubHostedRuntime();
    mocks.state.orgRole = "member";
    mocks.resolveBuilderCredentialsDetailed.mockResolvedValue(
      credentials({
        privateKey: "priv",
        publicKey: "pub",
        userId: "builder-user-42",
      }),
    );

    const result = (await create("onboarding", {
      userEmail: "dev@example.test",
      orgId: "builder_io",
    })) as any;

    expect(result).toMatchObject({
      mode: "builder-unavailable",
      reason: "settings-management-required",
    });
    expect(mocks.ensureBuilderProject).not.toHaveBeenCalled();
    expect(mocks.putSetting).not.toHaveBeenCalled();
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });
});

describe("setAppCreationSettings", () => {
  const projectId = "274d28fec94b48f2b2d68f2274d390eb";
  const orgId = "builder_io";

  function save(
    builderProjectId: string | null,
    ctx: { userEmail: string; orgId?: string } = {
      userEmail: "dev@example.test",
      orgId,
    },
  ) {
    return runWithRequestContext(ctx, () =>
      setAppCreationSettings({ builderProjectId }),
    );
  }

  it("stores the project id in the org-scoped Dispatch settings row", async () => {
    await save(projectId);

    expect(
      mocks.settings.get("dispatch-app-creation-settings:org:builder_io"),
    ).toEqual({ builderProjectId: projectId });
    expect(mocks.putSetting).toHaveBeenCalledWith(
      "dispatch-app-creation-settings:org:builder_io",
      { builderProjectId: projectId },
    );
    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("scopes the settings row to one organization rather than every tenant", async () => {
    await save(projectId);

    expect(mocks.putSetting.mock.calls.at(-1)?.[0]).toBe(
      "dispatch-app-creation-settings:org:builder_io",
    );
    expect(mocks.putSetting.mock.calls.at(-1)?.[0]).not.toContain(":user:");
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("uses a user-scoped settings row when there is no active org", async () => {
    await save(projectId, { userEmail: "dev@example.test" });

    expect(mocks.settings.get(settingsKey)).toEqual({
      builderProjectId: projectId,
    });
    expect(mocks.putSetting).toHaveBeenCalledWith(settingsKey, {
      builderProjectId: projectId,
    });
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("persists an explicit null when the project id is cleared", async () => {
    await save(null);

    expect(
      mocks.settings.get("dispatch-app-creation-settings:org:builder_io"),
    ).toEqual({ builderProjectId: null });
    expect(mocks.putSetting).toHaveBeenCalledWith(
      "dispatch-app-creation-settings:org:builder_io",
      { builderProjectId: null },
    );
    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("never consults the project secret store when saving settings", async () => {
    mocks.writeAppSecret.mockRejectedValueOnce(
      new Error("credential store down"),
    );

    await expect(save(projectId)).resolves.toMatchObject({
      builderProjectId: projectId,
    });
    expect(
      mocks.settings.get("dispatch-app-creation-settings:org:builder_io"),
    ).toEqual({ builderProjectId: projectId });
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
  });
});
