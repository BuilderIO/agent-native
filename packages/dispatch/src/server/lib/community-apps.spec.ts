import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserLabEnabled: vi.fn(async () => true),
  normalizeWorkspaceAppId: vi.fn((value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-"),
  ),
  getWorkspaceAppIdValidationError: vi.fn((value: string) =>
    value === "invalid" ? "invalid app id" : null,
  ),
  getAppCreationSettings: vi.fn(async () => ({
    builderProjectId: "project-1",
  })),
  getWorkspaceInfo: vi.fn(() => ({ rootPath: "/workspace" })),
  isLocalAppCreationRuntime: vi.fn(() => false),
  listWorkspaceApps: vi.fn(async () => [] as any[]),
  startWorkspaceAppCreation: vi.fn(),
  loadPinnedCommunitySourceAttachments: vi.fn(),
  currentOrgId: vi.fn(() => "org-1"),
  currentOwnerEmail: vi.fn(() => "owner@example.com"),
  recordAudit: vi.fn(async () => undefined),
  fail: vi.fn((message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  }),
}));

vi.mock("@agent-native/core/action", () => ({ fail: mocks.fail }));
vi.mock("@agent-native/core/labs/server", () => ({
  getUserLabEnabled: mocks.getUserLabEnabled,
}));
vi.mock("@agent-native/core/shared", () => ({
  normalizeWorkspaceAppId: mocks.normalizeWorkspaceAppId,
  getWorkspaceAppIdValidationError: mocks.getWorkspaceAppIdValidationError,
}));
vi.mock("@agent-native/core/shared/first-party-agents", () => ({
  BUILTIN_AGENT_CATALOG_IDS: ["plan", "chat", "tasks", "crm", "factory"],
  HIDDEN_FIRST_PARTY_AGENT_IDS: new Set(["removed-agent"]),
}));
vi.mock("../../shared/labs.js", () => ({
  COMMUNITY_APPS_LAB: { key: "dispatch.community-apps", defaultEnabled: false },
}));
vi.mock("./app-creation-store.js", () => ({
  getAppCreationSettings: mocks.getAppCreationSettings,
  getWorkspaceInfo: mocks.getWorkspaceInfo,
  isLocalAppCreationRuntime: mocks.isLocalAppCreationRuntime,
  listWorkspaceApps: mocks.listWorkspaceApps,
  startWorkspaceAppCreation: mocks.startWorkspaceAppCreation,
}));
vi.mock("./community-source.js", () => ({
  loadPinnedCommunitySourceAttachments:
    mocks.loadPinnedCommunitySourceAttachments,
}));
vi.mock("./dispatch-store.js", () => ({
  currentOrgId: mocks.currentOrgId,
  currentOwnerEmail: mocks.currentOwnerEmail,
  recordAudit: mocks.recordAudit,
}));
vi.mock("./curated-workspace-templates.js", () => ({
  CURATED_WORKSPACE_TEMPLATES: [{ id: "mail" }, { id: "calendar" }],
}));

import {
  CURATED_COMMUNITY_APP_SOURCES,
  installCuratedCommunityApp,
  listCuratedCommunityApps,
} from "./community-apps.js";

describe("curated community apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserLabEnabled.mockResolvedValue(true);
    mocks.getAppCreationSettings.mockResolvedValue({
      builderProjectId: "project-1",
    });
    mocks.isLocalAppCreationRuntime.mockReturnValue(false);
    mocks.listWorkspaceApps.mockResolvedValue([]);
    mocks.recordAudit.mockResolvedValue(undefined);
    mocks.loadPinnedCommunitySourceAttachments.mockResolvedValue([
      {
        type: "upload",
        contentType: "text/plain",
        name: "community-qr/README.md",
        text: "pinned README",
        dataUrl: "",
        id: "community-qr:README.md",
      },
    ]);
  });

  it("uses namespaced ids and pins every source file by Git blob id", () => {
    expect(CURATED_COMMUNITY_APP_SOURCES.length).toBeGreaterThan(0);
    expect(
      CURATED_COMMUNITY_APP_SOURCES.every((source) =>
        source.id.startsWith("community-"),
      ),
    ).toBe(true);
    expect(
      CURATED_COMMUNITY_APP_SOURCES.every(
        (source) =>
          source.ref === "main" &&
          source.files.every((file) => /^[a-f0-9]{40}$/i.test(file.blobSha)),
      ),
    ).toBe(true);
    expect(
      CURATED_COMMUNITY_APP_SOURCES.some((source) =>
        ["mail", "calendar"].includes(source.id),
      ),
    ).toBe(false);
  });

  it("refuses the catalog and installs while the Lab is off", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(false);

    await expect(listCuratedCommunityApps()).rejects.toMatchObject({
      errorCode: "community_apps_lab_disabled",
      statusCode: 403,
    });
    await expect(
      installCuratedCommunityApp({ sourceId: "community-qr" }),
    ).rejects.toMatchObject({
      errorCode: "community_apps_lab_disabled",
      statusCode: 403,
    });
    expect(mocks.listWorkspaceApps).not.toHaveBeenCalled();
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
  });

  it("marks existing pending installs and workspace availability", async () => {
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "community-qr",
        communitySourceId: "community-qr",
        name: "QR",
        path: "/community-qr",
        url: null,
        status: "pending",
      },
    ]);

    await expect(listCuratedCommunityApps()).resolves.toEqual([
      expect.objectContaining({
        id: "community-qr",
        installed: false,
        pending: true,
        installable: false,
      }),
    ]);
  });

  it("returns existing progress when the same install is requested twice", async () => {
    const pending = {
      id: "community-qr",
      communitySourceId: "community-qr",
      name: "QR",
      path: "/community-qr",
      url: null,
      status: "pending" as const,
      statusLabel: "Creating",
      builderUrl: "https://builder.io/project/branch",
      branchName: "community-qr",
    };
    mocks.listWorkspaceApps.mockResolvedValue([pending]);

    await expect(
      installCuratedCommunityApp({ sourceId: "community-qr" }),
    ).resolves.toMatchObject({ mode: "pending", app: { id: "community-qr" } });
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
  });

  it("passes only the catalog's pinned source into app creation", async () => {
    mocks.startWorkspaceAppCreation.mockResolvedValue({
      mode: "builder",
      appId: "qr-team",
      path: "/qr-team",
      projectId: "project-1",
      branchName: "qr-team",
      url: "https://builder.io/branch",
      workspaceUrl: null,
      status: "processing",
      message: "App creation started.",
    });

    await installCuratedCommunityApp({
      sourceId: "community-qr",
      appId: "QR Team",
      repo: "attacker/arbitrary" as never,
    });

    const [request] = mocks.startWorkspaceAppCreation.mock.calls[0] ?? [];
    const source = CURATED_COMMUNITY_APP_SOURCES[0]!;
    expect(request).toMatchObject({
      appId: "qr-team",
      template: "community-qr",
      communitySourceId: "community-qr",
      prompt: expect.stringContaining(
        `https://github.com/${source.repo}/tree/${source.ref}/${source.templatePath}`,
      ),
      attachments: [
        expect.objectContaining({
          name: "community-qr/README.md",
          text: "pinned README",
        }),
      ],
    });
    expect(mocks.loadPinnedCommunitySourceAttachments).toHaveBeenCalledWith(
      source,
      "qr-team",
    );
    expect(request.prompt).not.toContain("attacker/arbitrary");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace-app.community-install-requested",
        metadata: expect.objectContaining({
          ref: source.ref,
          blobShas: source.files.map((file) => file.blobSha),
        }),
      }),
    );
  });

  it("requires an associated workspace and prevents first-party id shadowing", async () => {
    mocks.getAppCreationSettings.mockResolvedValue({ builderProjectId: null });
    await expect(
      installCuratedCommunityApp({ sourceId: "community-qr" }),
    ).rejects.toMatchObject({ errorCode: "community_workspace_required" });
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();

    mocks.getAppCreationSettings.mockResolvedValue({
      builderProjectId: "project-1",
    });
    await expect(
      installCuratedCommunityApp({ sourceId: "community-qr", appId: "mail" }),
    ).rejects.toMatchObject({
      errorCode: "community_app_id_shadows_first_party",
      statusCode: 409,
    });
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
  });

  it.each(["plan", "chat", "tasks", "crm", "factory", "removed-agent"])(
    "prevents shadowing first-party agent id %s",
    async (appId) => {
      await expect(
        installCuratedCommunityApp({ sourceId: "community-qr", appId }),
      ).rejects.toMatchObject({
        errorCode: "community_app_id_shadows_first_party",
        statusCode: 409,
      });
      expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the pinned community source cannot be verified", async () => {
    mocks.loadPinnedCommunitySourceAttachments.mockRejectedValueOnce(
      new Error("Git blob mismatch"),
    );

    await expect(
      installCuratedCommunityApp({ sourceId: "community-qr" }),
    ).rejects.toMatchObject({
      errorCode: "community_source_unavailable",
      statusCode: 503,
    });
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
  });

  it("does not mistake an unrelated app with the same id for a curated install", async () => {
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "community-qr",
        name: "Unrelated QR App",
        path: "/community-qr",
        url: null,
        status: "ready",
      },
    ]);

    await expect(listCuratedCommunityApps()).resolves.toEqual([
      expect.objectContaining({
        id: "community-qr",
        installed: false,
        pending: false,
        installable: false,
        installUnavailableReason: "app-id-conflict",
      }),
    ]);
    await expect(
      installCuratedCommunityApp({ sourceId: "community-qr" }),
    ).rejects.toMatchObject({
      errorCode: "community_app_id_conflict",
      statusCode: 409,
    });
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
  });
});
