import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockBuilderBranchFilesError extends Error {
    constructor(readonly code: string) {
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
    readOrgMemberRole: vi.fn(),
  };
});

vi.mock("@agent-native/core/server", () => ({
  BuilderBranchFilesError: mocks.BuilderBranchFilesError,
  getRequestContext: () => mocks.context,
  readBuilderBranchFiles: mocks.readBuilderBranchFiles,
  readOrgMemberRole: mocks.readOrgMemberRole,
}));

vi.mock("./app-creation-store.js", () => ({
  getAppCreationSettings: mocks.getAppCreationSettings,
}));

vi.mock("./community-apps.js", () => ({
  CURATED_COMMUNITY_APP_SOURCES: [
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
}));

vi.mock("./curated-workspace-templates.js", () => ({
  CURATED_WORKSPACE_TEMPLATES: [],
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: () => "org-1",
  currentOwnerEmail: () => "owner@example.test",
}));

import { BuilderBranchFilesError } from "@agent-native/core/server";

import { verifyCuratedCommunityApp } from "./community-install-verification.js";

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
      errorCode: "community_verification_integrity_failed",
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

  it("maps Builder read failures to typed errors without returning a receipt", async () => {
    mocks.readBuilderBranchFiles.mockRejectedValue(
      new BuilderBranchFilesError("unverified"),
    );

    await expect(verifyCuratedCommunityApp(input)).rejects.toMatchObject({
      errorCode: "community_verification_readback_unverified",
      statusCode: 422,
    });
  });
});
