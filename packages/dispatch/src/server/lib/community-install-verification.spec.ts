import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockBuilderBranchFilesError extends Error {
    constructor(
      readonly code: string,
      readonly readbackStage?: string,
    ) {
      super(code);
    }
  }

  return {
    BuilderBranchFilesError: MockBuilderBranchFilesError,
    context: undefined as
      | {
          authUserId?: string;
          userEmail?: string;
          orgId?: string;
          identityAuthenticatedAtMs?: number;
          isSyntheticTraffic?: boolean;
          isIntegrationCaller?: boolean;
          integration?: { taskId: string };
          verifiedServiceIdentity?: { userEmail: string; orgId: string };
          a2aIdentityAssurance?: "user" | "organization" | "org-member";
          agentRunAnonymous?: boolean;
          authCapability?: string;
          orgScope?: "personal";
        }
      | undefined,
    getAppCreationSettings: vi.fn(),
    readBuilderBranchFiles: vi.fn(),
    readBuilderBranchBackupStatus: vi.fn(),
    readOrgMemberRole: vi.fn(),
    curatedSources: [
      {
        id: "community-fixture",
        name: "Fixture",
        description: "Fixture source",
        appId: "community-fixture",
        license: "MIT",
        provenance: "Inline test bytes",
        repo: "BuilderIO/agent-native",
        ref: "main",
        templatePath: "templates/community/fixture",
        files: [
          {
            path: "README.md",
            blobSha: "d82bea9ff7c974a8455933d520b0e529cb5b3593",
          },
        ],
      },
    ],
  };
});

vi.mock("@agent-native/core/server", () => ({
  BuilderBranchFilesError: mocks.BuilderBranchFilesError,
  getRequestContext: () => mocks.context,
  readBuilderBranchFiles: mocks.readBuilderBranchFiles,
  readBuilderBranchBackupStatus: mocks.readBuilderBranchBackupStatus,
  readOrgMemberRole: mocks.readOrgMemberRole,
}));

vi.mock("./app-creation-store.js", () => ({
  getAppCreationSettings: mocks.getAppCreationSettings,
}));

vi.mock("./community-apps.js", () => ({
  CURATED_COMMUNITY_APP_SOURCES: mocks.curatedSources,
}));

vi.mock("./curated-workspace-templates.js", () => ({
  CURATED_WORKSPACE_TEMPLATES: [],
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: () => "org-1",
  currentOwnerEmail: () => "owner@example.test",
}));

import { BuilderBranchFilesError } from "@agent-native/core/server";

import {
  inspectCommunityBuilderBackup,
  verifyCuratedCommunityApp,
} from "./community-install-verification.js";

const content = new TextEncoder().encode("reviewed bytes\n");
const baseSnapshot = {
  projectId: "builder-project-1",
  branchName: "release/community-fixture",
  commitSha: "a".repeat(40),
  files: [
    {
      path: "apps/community-fixture/README.md",
      mode: "100644",
      content,
    },
  ],
};
const input = {
  sourceId: "community-fixture",
  appId: "community-fixture",
  branchName: "release/community-fixture",
};

function blobSha(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function authenticatedOwnerContext() {
  return {
    authUserId: "auth-user-1",
    userEmail: "owner@example.test",
    orgId: "org-1",
    identityAuthenticatedAtMs: 1234,
  };
}

describe("verifyCuratedCommunityApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context = authenticatedOwnerContext();
    mocks.getAppCreationSettings.mockResolvedValue({
      builderProjectId: "builder-project-1",
      savedBuilderProjectId: "builder-project-1",
    });
    mocks.readOrgMemberRole.mockResolvedValue("owner");
    mocks.readBuilderBranchBackupStatus.mockResolvedValue({
      branchState: "active",
      backupPartial: false,
      backupValid: true,
      backupComplete: true,
      backupCurrent: true,
      agentIdle: true,
      hasUnpushedChanges: false,
      verificationPerformed: false,
    });
    mocks.readBuilderBranchFiles.mockResolvedValue(baseSnapshot);
  });

  it("uses the organization project and returns only the exact hash receipt", async () => {
    const result = await verifyCuratedCommunityApp(input);

    expect(mocks.readBuilderBranchFiles).toHaveBeenCalledWith({
      projectId: "builder-project-1",
      branchName: input.branchName,
      appPath: "apps/community-fixture",
    });
    expect(result).toEqual({
      projectId: "builder-project-1",
      branchName: input.branchName,
      commitSha: "a".repeat(40),
      sourceId: "community-fixture",
      appId: "community-fixture",
      files: [
        {
          path: "apps/community-fixture/README.md",
          blobSha: blobSha(content),
        },
      ],
      verified: true,
    });
    expect(JSON.stringify(result)).not.toContain("reviewed bytes");
  });

  it("rejects unknown sources before reading Builder", async () => {
    await expect(
      verifyCuratedCommunityApp({ ...input, sourceId: "unknown" }),
    ).rejects.toMatchObject({
      errorCode: "community_verification_source_unknown",
    });
    expect(mocks.readBuilderBranchFiles).not.toHaveBeenCalled();
  });

  it("requires an explicitly saved organization Builder project", async () => {
    mocks.getAppCreationSettings.mockResolvedValue({
      builderProjectId: "deployment-project",
      savedBuilderProjectId: null,
    });

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_project_required",
    });
    expect(mocks.readBuilderBranchFiles).not.toHaveBeenCalled();
  });

  it("denies non-owner members before inspecting backup metadata", async () => {
    mocks.readOrgMemberRole.mockResolvedValueOnce("member");

    await expect(
      inspectCommunityBuilderBackup({ branchName: input.branchName }),
    ).rejects.toMatchObject({
      errorCode: "community_verification_owner_required",
    });
    expect(mocks.readBuilderBranchBackupStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["integration caller", { isIntegrationCaller: true }],
    ["synthetic traffic", { isSyntheticTraffic: true }],
    ["A2A identity", { a2aIdentityAssurance: "organization" as const }],
  ])("denies %s before inspecting backup metadata", async (_name, override) => {
    mocks.context = { ...authenticatedOwnerContext(), ...override };

    await expect(
      inspectCommunityBuilderBackup({ branchName: input.branchName }),
    ).rejects.toMatchObject({
      errorCode: "community_verification_identity_required",
    });
    expect(mocks.readOrgMemberRole).not.toHaveBeenCalled();
    expect(mocks.readBuilderBranchBackupStatus).not.toHaveBeenCalled();
  });

  it("denies non-owner members before reading Builder", async () => {
    mocks.readOrgMemberRole.mockResolvedValue("member");

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_owner_required",
    });
    expect(mocks.readBuilderBranchFiles).not.toHaveBeenCalled();
  });

  it("fails closed when role lookup is unavailable", async () => {
    mocks.readOrgMemberRole.mockRejectedValue(new Error("db unavailable"));

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_role_unavailable",
      statusCode: 503,
    });
    expect(mocks.readBuilderBranchFiles).not.toHaveBeenCalled();
  });

  it("inspects only bound backup status for the saved Builder project", async () => {
    mocks.readBuilderBranchBackupStatus.mockResolvedValueOnce({
      branchState: "active",
      backupPartial: true,
      backupValid: true,
      backupComplete: true,
      backupCurrent: false,
      agentIdle: true,
      hasUnpushedChanges: false,
      verificationPerformed: false,
    });

    await expect(
      inspectCommunityBuilderBackup({ branchName: input.branchName }),
    ).resolves.toEqual({
      branchName: input.branchName,
      branchState: "active",
      backupPartial: true,
      backupValid: true,
      backupComplete: true,
      backupCurrent: false,
      agentIdle: true,
      hasUnpushedChanges: false,
      verificationPerformed: false,
    });
    expect(mocks.readBuilderBranchBackupStatus).toHaveBeenCalledExactlyOnceWith(
      { projectId: "builder-project-1", branchName: input.branchName },
    );
    expect(mocks.readBuilderBranchFiles).not.toHaveBeenCalled();
  });

  it("requires the explicitly saved Builder project for status inspection", async () => {
    mocks.getAppCreationSettings.mockResolvedValueOnce({
      builderProjectId: "deployment-project",
      savedBuilderProjectId: null,
    });

    await expect(
      inspectCommunityBuilderBackup({ branchName: input.branchName }),
    ).rejects.toMatchObject({
      errorCode: "community_verification_project_required",
    });
    expect(mocks.readBuilderBranchBackupStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["integration caller", { isIntegrationCaller: true }],
    ["integration context", { integration: { taskId: "task-1" } }],
    ["synthetic traffic", { isSyntheticTraffic: true }],
    ["synthetic principal", { userEmail: "integration@integration.local" }],
    ["organization A2A principal", { a2aIdentityAssurance: "organization" }],
    ["org-member A2A principal", { a2aIdentityAssurance: "org-member" }],
    [
      "service principal",
      {
        verifiedServiceIdentity: {
          userEmail: "owner@example.test",
          orgId: "org-1",
        },
      },
    ],
    ["capability session", { authCapability: "capability:read" }],
    ["missing authenticated user id", { authUserId: undefined }],
  ])("rejects %s before Builder readback", async (_name, override) => {
    mocks.context = { ...authenticatedOwnerContext(), ...override };

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_identity_required",
    });
    expect(mocks.readOrgMemberRole).not.toHaveBeenCalled();
    expect(mocks.readBuilderBranchFiles).not.toHaveBeenCalled();
  });

  it("rejects a snapshot bound to another branch", async () => {
    mocks.readBuilderBranchFiles.mockResolvedValue({
      ...baseSnapshot,
      branchName: "different-branch",
    });

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_readback_unverified",
      statusCode: 422,
    });
  });

  it("rejects bytes that do not match the reviewed source pin", async () => {
    mocks.readBuilderBranchFiles.mockResolvedValue({
      ...baseSnapshot,
      files: [
        {
          ...baseSnapshot.files[0],
          content: new TextEncoder().encode("tampered bytes\n"),
        },
      ],
    });

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_integrity_failed",
      statusCode: 422,
    });
  });

  it("reports malformed reviewed pins as a catalog error", async () => {
    const source = mocks.curatedSources[0];
    const originalBlobSha = source.files[0].blobSha;
    source.files[0].blobSha = "invalid-pin";

    try {
      await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
        errorCode: "community_verification_catalog_invalid",
        statusCode: 500,
      });
    } finally {
      source.files[0].blobSha = originalBlobSha;
    }

    expect(mocks.readBuilderBranchFiles).toHaveBeenCalledOnce();
  });

  it("sanitizes unexpected verifier errors as internal failures", async () => {
    const snapshotWithThrowingFiles = Object.defineProperty(
      { ...baseSnapshot },
      "files",
      {
        get() {
          throw new Error("private provider detail");
        },
      },
    );
    mocks.readBuilderBranchFiles.mockResolvedValue(snapshotWithThrowingFiles);

    const error = await verifyCuratedCommunityApp(input).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      errorCode: "community_verification_internal_error",
      statusCode: 500,
      message: "Community branch verification could not be completed.",
    });
    expect(String(error)).not.toContain("private provider detail");
  });

  it("maps Builder read failures to typed errors without returning a receipt", async () => {
    mocks.readBuilderBranchFiles.mockRejectedValue(
      new BuilderBranchFilesError("unverified", "status_currentness"),
    );

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_readback_unverified",
      statusCode: 422,
      details: { readbackStage: "status_currentness" },
    });
  });

  it("preserves a typed no-backup status failure for the inspection action", async () => {
    mocks.readBuilderBranchBackupStatus.mockRejectedValueOnce(
      new BuilderBranchFilesError("unverified", "status_no_backup"),
    );

    await expect(
      inspectCommunityBuilderBackup({ branchName: input.branchName }),
    ).rejects.toMatchObject({
      errorCode: "community_verification_readback_unverified",
      statusCode: 422,
      details: { readbackStage: "status_no_backup" },
    });
  });

  it("keeps older and unrecognized Core diagnostics explicitly unknown", async () => {
    for (const error of [
      new BuilderBranchFilesError("unverified"),
      new BuilderBranchFilesError(
        "unverified",
        "https://provider.invalid/private",
      ),
    ]) {
      mocks.readBuilderBranchFiles.mockRejectedValueOnce(error);
      await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
        errorCode: "community_verification_readback_unverified",
        details: { readbackStage: "unknown" },
      });
    }
  });
});
