import { getAppConfig } from "../app-config/index.js";
import { getOrgSettingEntry } from "../settings/org-settings.js";
import {
  canInviteOrgMembersUnderPolicy,
  type OrgInvitationPolicy,
} from "./permissions.js";
import type { OrgRole } from "./types.js";

export const ORG_ONLY_ADMINS_CAN_INVITE_KEY = "only-admins-can-invite";

export const ORG_INVITE_DENIED_MESSAGE =
  "Only owners and admins can invite members";

/**
 * The one reader of who may invite in an org. The mode comes from server
 * config, never from a request; only the `org-setting` mode reads the org's
 * stored flag, and an unreadable flag throws rather than defaulting open.
 */
export async function readOrgInvitationPolicy(
  orgId: string,
): Promise<OrgInvitationPolicy> {
  const mode = getAppConfig().access.memberInvitations;
  if (mode === "admins") return { mode, onlyAdminsCanInvite: true };
  if (mode === "members") return { mode, onlyAdminsCanInvite: false };
  const entry = await getOrgSettingEntry(orgId, ORG_ONLY_ADMINS_CAN_INVITE_KEY);
  if (!entry.found) return { mode, onlyAdminsCanInvite: false };
  const value = entry.value;
  const flag =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).onlyAdminsCanInvite
      : undefined;
  if (typeof flag !== "boolean") {
    throw new Error(
      `Invalid ${ORG_ONLY_ADMINS_CAN_INVITE_KEY} setting for organization ${orgId}`,
    );
  }
  return { mode, onlyAdminsCanInvite: flag };
}

/**
 * `role` must already be the caller's verified role in `orgId`. Reads the
 * org setting only for a plain member under `org-setting` mode.
 */
export async function canRoleInviteInOrg(
  orgId: string,
  role: OrgRole | null | undefined,
): Promise<boolean> {
  if (role === "owner" || role === "admin") return true;
  if (role !== "member") return false;
  return canInviteOrgMembersUnderPolicy(
    role,
    await readOrgInvitationPolicy(orgId),
  );
}
