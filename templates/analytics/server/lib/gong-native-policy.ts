import type { OrgRole } from "@agent-native/core/org";
import { canManageOrg } from "@agent-native/core/org/permissions";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { createError } from "h3";

import { resolveOrgRole } from "./db-admin-connections";

export const GONG_NATIVE_INSIGHTS_SETTING_KEY = "gong-native-insights-policy";

export interface GongNativeInsightsPolicy {
  enabled: boolean;
  configured: boolean;
  scope: "workspace" | "user" | "none";
  updatedAt: string | null;
}

function parsePolicy(
  value: Record<string, unknown> | null,
  scope: GongNativeInsightsPolicy["scope"],
): GongNativeInsightsPolicy {
  return {
    // Unconfigured means on: Gong's semantic MCP is the answer path for
    // account/deal questions, and a stored value fails closed unless it is true.
    enabled: value == null ? true : value.enabled === true,
    configured: value != null,
    scope,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

export async function readGongNativeInsightsPolicy(): Promise<GongNativeInsightsPolicy> {
  const orgId = getRequestOrgId() || null;
  if (orgId) {
    return parsePolicy(
      await getOrgSetting(orgId, GONG_NATIVE_INSIGHTS_SETTING_KEY),
      "workspace",
    );
  }

  const email = getRequestUserEmail();
  if (email) {
    return parsePolicy(
      await getUserSetting(email, GONG_NATIVE_INSIGHTS_SETTING_KEY),
      "user",
    );
  }

  // No workspace or user to read a policy from: fail closed.
  return { ...parsePolicy(null, "none"), enabled: false };
}

export async function writeGongNativeInsightsPolicy(
  enabled: boolean,
): Promise<GongNativeInsightsPolicy> {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  const value = {
    enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: email ?? "authenticated-agent",
  };

  if (orgId) {
    // The org setting is the workspace's only control over paid requests, and
    // needsApproval only confirms the caller, so a member must not flip it.
    if (
      !email ||
      !canManageOrg((await resolveOrgRole(email, orgId)) as OrgRole)
    ) {
      throw createError({
        statusCode: 403,
        statusMessage:
          "Only organization owners and admins can change the workspace's Gong native insights policy",
      });
    }
    await putOrgSetting(orgId, GONG_NATIVE_INSIGHTS_SETTING_KEY, value);
    return parsePolicy(value, "workspace");
  }
  if (!email) throw new Error("no authenticated user");

  await putUserSetting(email, GONG_NATIVE_INSIGHTS_SETTING_KEY, value);
  return parsePolicy(value, "user");
}
