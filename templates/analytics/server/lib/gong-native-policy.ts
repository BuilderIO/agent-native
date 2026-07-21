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
    enabled: value?.enabled === true,
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

  return parsePolicy(null, "none");
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
    await putOrgSetting(orgId, GONG_NATIVE_INSIGHTS_SETTING_KEY, value);
    return parsePolicy(value, "workspace");
  }
  if (!email) throw new Error("no authenticated user");

  await putUserSetting(email, GONG_NATIVE_INSIGHTS_SETTING_KEY, value);
  return parsePolicy(value, "user");
}
