import { defineActionErrors } from "@agent-native/core/action";
import {
  BuilderBranchFilesError,
  getRequestContext,
  readBuilderBranchBackupStatus,
  readBuilderBranchFiles,
  readOrgMemberRole,
} from "@agent-native/core/server";
import {
  getWorkspaceAppIdValidationError,
  normalizeWorkspaceAppId,
} from "@agent-native/core/shared";
import {
  BUILTIN_AGENT_CATALOG_IDS,
  HIDDEN_FIRST_PARTY_AGENT_IDS,
} from "@agent-native/core/shared/first-party-agents";

import { getAppCreationSettings } from "./app-creation-store.js";
import { CURATED_COMMUNITY_APP_SOURCES } from "./community-apps.js";
import {
  CommunityInstallIntegrityError,
  verifyCommunityBranchFiles,
} from "./community-install-integrity.js";
import { CURATED_WORKSPACE_TEMPLATES } from "./curated-workspace-templates.js";
import { currentOrgId, currentOwnerEmail } from "./dispatch-store.js";

export const communityInstallVerificationErrors = defineActionErrors(
  "community_verification_identity_required",
  "community_verification_role_unavailable",
  "community_verification_owner_required",
  "community_verification_source_unknown",
  "community_verification_app_id_invalid",
  "community_verification_app_id_shadows_first_party",
  "community_verification_branch_invalid",
  "community_verification_project_required",
  "community_verification_project_unavailable",
  "community_verification_readback_unavailable",
  "community_verification_readback_forbidden",
  "community_verification_readback_unverified",
  "community_verification_integrity_failed",
  "community_verification_catalog_invalid",
  "community_verification_internal_error",
);

function verificationFail(
  message: string,
  code: Parameters<typeof communityInstallVerificationErrors.fail>[1],
  options: { statusCode: number; details?: Record<string, unknown> },
): never {
  return communityInstallVerificationErrors.fail(message, code, options);
}

const READBACK_STAGES = new Set([
  "status_request",
  "status_shape",
  "status_binding",
  "status_no_backup",
  "status_currentness",
  "post_read_status_request",
  "post_read_status_shape",
  "post_read_status_binding",
  "post_read_status_currentness",
  "download_url_request",
  "download_url_shape",
  "download_url_binding",
  "bundle_download",
  "bundle_read",
  "bundle_digest",
  "bundle_parse",
  "target_subtree_missing",
  "post_read_currentness",
  "app_integrity",
  "snapshot_ref",
]);

function readbackStage(error: unknown): string {
  const stage =
    error && typeof error === "object"
      ? (error as { readbackStage?: unknown }).readbackStage
      : undefined;
  return typeof stage === "string" && READBACK_STAGES.has(stage)
    ? stage
    : "unknown";
}

function requireHumanOrgOwner(): { orgId: string; ownerEmail: string } {
  const context = getRequestContext();
  const orgId = currentOrgId();
  const contextEmail = context?.userEmail?.trim().toLowerCase();
  if (
    !context ||
    !context.authUserId?.trim() ||
    !contextEmail ||
    !orgId ||
    context.orgId !== orgId ||
    context.isSyntheticTraffic === true ||
    context.isIntegrationCaller === true ||
    context.integration !== undefined ||
    context.verifiedServiceIdentity !== undefined ||
    context.a2aIdentityAssurance !== undefined ||
    context.agentRunAnonymous === true ||
    context.authCapability !== undefined ||
    typeof context.identityAuthenticatedAtMs !== "number" ||
    !Number.isFinite(context.identityAuthenticatedAtMs) ||
    context.orgScope === "personal" ||
    /^integration@|@integration\.local$/i.test(contextEmail)
  ) {
    verificationFail(
      "Sign in directly to an organization as an owner or admin to verify a Builder community branch.",
      "community_verification_identity_required",
      { statusCode: 403 },
    );
  }

  let ownerEmail: string;
  try {
    ownerEmail = currentOwnerEmail().trim().toLowerCase();
  } catch {
    verificationFail(
      "An authenticated organization owner or admin is required.",
      "community_verification_identity_required",
      { statusCode: 403 },
    );
  }
  if (!ownerEmail || ownerEmail !== contextEmail) {
    verificationFail(
      "An authenticated organization owner or admin is required.",
      "community_verification_identity_required",
      { statusCode: 403 },
    );
  }

  return { orgId, ownerEmail };
}

async function requireOrganizationOwnerOrAdmin(
  orgId: string,
  ownerEmail: string,
): Promise<void> {
  let role: string | null;
  try {
    role = await readOrgMemberRole(orgId, ownerEmail);
  } catch {
    verificationFail(
      "Organization membership could not be verified. Try again shortly.",
      "community_verification_role_unavailable",
      { statusCode: 503 },
    );
  }
  if (role !== "owner" && role !== "admin") {
    verificationFail(
      "Only organization owners and admins can verify Builder community branches.",
      "community_verification_owner_required",
      { statusCode: 403 },
    );
  }
}

function requireAppId(appIdInput: string): string {
  const appId = normalizeWorkspaceAppId(appIdInput);
  if (!appId || appId.length > 64 || getWorkspaceAppIdValidationError(appId)) {
    verificationFail(
      "Choose a valid, non-reserved workspace app id.",
      "community_verification_app_id_invalid",
      { statusCode: 400 },
    );
  }
  if (
    CURATED_WORKSPACE_TEMPLATES.some((template) => template.id === appId) ||
    BUILTIN_AGENT_CATALOG_IDS.includes(appId) ||
    HIDDEN_FIRST_PARTY_AGENT_IDS.has(appId)
  ) {
    verificationFail(
      "Community apps cannot use a first-party template app id.",
      "community_verification_app_id_shadows_first_party",
      { statusCode: 409 },
    );
  }
  return appId;
}

function requireBranchName(branchNameInput: string): string {
  const branchName = branchNameInput.trim();
  if (
    branchName !== branchNameInput ||
    branchName.length > 256 ||
    !branchName ||
    branchName
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
      )
  ) {
    verificationFail(
      "Choose a valid Builder branch name.",
      "community_verification_branch_invalid",
      { statusCode: 400 },
    );
  }
  return branchName;
}

function failBranchReadback(error: unknown): never {
  if (error instanceof BuilderBranchFilesError) {
    if (error.code === "forbidden" || error.code === "not_connected") {
      verificationFail(
        "Builder project read access is missing or does not include this project.",
        "community_verification_readback_forbidden",
        { statusCode: error.code === "forbidden" ? 403 : 409 },
      );
    }
    if (error.code === "unverified" || error.code === "integrity_failed") {
      verificationFail(
        "Builder could not provide a complete, identity-bound branch snapshot.",
        "community_verification_readback_unverified",
        { statusCode: 422, details: { readbackStage: readbackStage(error) } },
      );
    }
    if (error.code === "invalid_request") {
      verificationFail(
        "Builder rejected the requested branch reference.",
        "community_verification_branch_invalid",
        { statusCode: 400 },
      );
    }
  }
  verificationFail(
    "Builder branch readback is unavailable. Try again later.",
    "community_verification_readback_unavailable",
    {
      statusCode: 503,
      details: { readbackStage: readbackStage(error) },
    },
  );
}

export async function inspectCommunityBuilderBackup(input: {
  branchName: string;
}) {
  const { orgId, ownerEmail } = requireHumanOrgOwner();
  await requireOrganizationOwnerOrAdmin(orgId, ownerEmail);

  const branchName = requireBranchName(input.branchName);
  let settings: Awaited<ReturnType<typeof getAppCreationSettings>>;
  try {
    settings = await getAppCreationSettings();
  } catch {
    verificationFail(
      "The organization Builder project setting could not be read. Try again shortly.",
      "community_verification_project_unavailable",
      { statusCode: 503 },
    );
  }
  const projectId = settings.savedBuilderProjectId?.trim();
  if (!projectId || settings.builderProjectId !== projectId) {
    verificationFail(
      "Configure a Builder project for this organization before inspecting a branch backup.",
      "community_verification_project_required",
      { statusCode: 409 },
    );
  }

  let status: Awaited<ReturnType<typeof readBuilderBranchBackupStatus>>;
  try {
    status = await readBuilderBranchBackupStatus({ projectId, branchName });
  } catch (error) {
    failBranchReadback(error);
  }
  return { branchName, ...status };
}

export async function verifyCuratedCommunityApp(input: {
  sourceId: string;
  appId: string;
  branchName: string;
}) {
  const { orgId, ownerEmail } = requireHumanOrgOwner();
  await requireOrganizationOwnerOrAdmin(orgId, ownerEmail);

  const source = CURATED_COMMUNITY_APP_SOURCES.find(
    (candidate) => candidate.id === input.sourceId.trim(),
  );
  if (!source) {
    verificationFail(
      "That community app is not in Dispatch's reviewed install catalog.",
      "community_verification_source_unknown",
      { statusCode: 404 },
    );
  }

  const appId = requireAppId(input.appId);
  const branchName = requireBranchName(input.branchName);

  let settings: Awaited<ReturnType<typeof getAppCreationSettings>>;
  try {
    settings = await getAppCreationSettings();
  } catch {
    verificationFail(
      "The organization Builder project setting could not be read. Try again later.",
      "community_verification_project_unavailable",
      { statusCode: 503 },
    );
  }
  const projectId = settings.savedBuilderProjectId?.trim();
  if (!projectId || settings.builderProjectId !== projectId) {
    verificationFail(
      "Configure a Builder project for this organization before verifying a branch.",
      "community_verification_project_required",
      { statusCode: 409 },
    );
  }

  let snapshot: Awaited<ReturnType<typeof readBuilderBranchFiles>>;
  try {
    snapshot = await readBuilderBranchFiles({
      projectId,
      branchName,
      appPath: `apps/${appId}`,
    });
  } catch (error) {
    failBranchReadback(error);
  }

  try {
    return verifyCommunityBranchFiles(source, appId, snapshot, {
      projectId,
      branchName,
    });
  } catch (error) {
    if (!(error instanceof CommunityInstallIntegrityError)) {
      verificationFail(
        "Community branch verification could not be completed.",
        "community_verification_internal_error",
        { statusCode: 500 },
      );
    }

    switch (error.code) {
      case "file_set_mismatch":
      case "file_mode_unsupported":
      case "file_too_large":
      case "total_too_large":
      case "blob_mismatch":
        verificationFail(
          "Builder branch files do not match the reviewed community template.",
          "community_verification_integrity_failed",
          { statusCode: 422, details: { readbackStage: "app_integrity" } },
        );
      case "ref_mismatch":
      case "invalid_snapshot":
        verificationFail(
          "Builder could not provide a complete, identity-bound branch snapshot.",
          "community_verification_readback_unverified",
          { statusCode: 422, details: { readbackStage: "snapshot_ref" } },
        );
      case "invalid_source":
        verificationFail(
          "The reviewed community catalog entry is invalid.",
          "community_verification_catalog_invalid",
          { statusCode: 500 },
        );
      case "invalid_target":
        verificationFail(
          "Community branch verification could not be completed.",
          "community_verification_internal_error",
          { statusCode: 500 },
        );
    }
  }
}
