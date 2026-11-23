import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import {
  ForbiddenError,
  getShareableResource,
} from "@agent-native/core/sharing";

import {
  DEFAULT_WORKSPACE_SHARING_SETTINGS,
  workspaceSharingSettingsSchema,
  type WorkspaceSharingCapabilities,
  type WorkspaceSharingSettings,
} from "../../app/lib/model/sharing-settings-contracts.js";

const SETTING_KEY = "analytics.sharingSettings";

export function getWorkspaceSharingCapabilities(): WorkspaceSharingCapabilities {
  const projectRegistration = getShareableResource("analytics-project");
  return {
    publicSharingSupported: projectRegistration?.allowPublic === true,
    guestSharingSupported:
      projectRegistration !== undefined &&
      projectRegistration.requireOrgMemberForUserShares !== true,
  };
}

export async function readWorkspaceSharingSettings(
  orgId: string,
): Promise<WorkspaceSharingSettings> {
  const capabilities = getWorkspaceSharingCapabilities();
  const parsed = workspaceSharingSettingsSchema.safeParse(
    await getOrgSetting(orgId, SETTING_KEY),
  );
  const raw = parsed.success
    ? parsed.data
    : { ...DEFAULT_WORKSPACE_SHARING_SETTINGS };
  return {
    allowPublicSharing: capabilities.publicSharingSupported
      ? raw.allowPublicSharing
      : false,
    allowWorkspaceSharing: raw.allowWorkspaceSharing,
    allowGuestCreation: capabilities.guestSharingSupported
      ? raw.allowGuestCreation
      : false,
  };
}

export async function writeWorkspaceSharingSettings(
  orgId: string,
  settings: WorkspaceSharingSettings,
): Promise<WorkspaceSharingSettings> {
  const value = workspaceSharingSettingsSchema.parse(settings);
  await putOrgSetting(orgId, SETTING_KEY, value);
  return value;
}

export async function assertWorkspaceSharingPolicy(args: {
  resource: { orgId?: string | null };
  change:
    | { kind: "visibility"; visibility: "private" | "org" | "public" }
    | { kind: "grant" };
}): Promise<void> {
  if (args.change.kind !== "visibility" || args.change.visibility !== "org") {
    return;
  }
  const orgId =
    typeof args.resource?.orgId === "string" ? args.resource.orgId.trim() : "";
  if (!orgId) return;
  const settings = await readWorkspaceSharingSettings(orgId);
  if (!settings.allowWorkspaceSharing) {
    throw new ForbiddenError(
      "Sharing with the workspace is disabled by workspace sharing settings.",
    );
  }
}
