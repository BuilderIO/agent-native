import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  generateWorkspaceAppDescription,
  listWorkspaceApps,
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
    putSetting: vi.fn(async (key: string, value: unknown) => {
      settings.set(key, value);
    }),
    getDbExec: vi.fn(() => ({
      execute: vi.fn(async () => ({
        rows: state.orgRole ? [{ role: state.orgRole }] : [],
      })),
    })),
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
  putSetting: (...args: any[]) => mocks.putSetting(...args),
}));

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
  mocks.state.orgRole = "admin";
  globalThis.fetch = originalFetch;
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
              name: "Agent-Native Dispatch",
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
    expect(mocks.getDbExec).toHaveBeenCalled();
  });

  it("blocks non-admin workspace members from updating app display metadata", async () => {
    mocks.state.orgRole = "member";
    stubNoPendingContext();
    stubManifest([{ id: "todo", name: "Todo", path: "/todo" }]);

    await expect(
      runWithRequestContext(
        { userEmail: "dev@example.test", orgId: "org-123" },
        () =>
          updateWorkspaceAppMetadata({
            appId: "todo",
            name: "Todo Board",
          }),
      ),
    ).rejects.toThrow(
      "Only organization owners and admins can update app creation settings.",
    );
    expect(
      mocks.settings.get("workspace-app-metadata:org:org-123"),
    ).toBeUndefined();
  });

  it("generates a concise seed description from an app prompt", () => {
    expect(
      generateWorkspaceAppDescription(
        "Build me an app that tracks customer onboarding risks and handoffs",
        "customer-onboarding",
      ),
    ).toBe("Tracks customer onboarding risks and handoffs.");
  });
});
