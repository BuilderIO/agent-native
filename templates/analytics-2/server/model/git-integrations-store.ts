import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";

import {
  EMPTY_GIT_INTEGRATIONS,
  gitIntegrationsSettingsSchema,
  type GitIntegrationsSettings,
} from "../../app/lib/model/git-integrations-contracts.js";

const SETTING_KEY = "analytics.gitIntegrations";

export async function readGitIntegrationsSettings(
  orgId: string,
): Promise<GitIntegrationsSettings> {
  const parsed = gitIntegrationsSettingsSchema.safeParse(
    await getOrgSetting(orgId, SETTING_KEY),
  );
  return parsed.success
    ? parsed.data
    : {
        packageImports: [...EMPTY_GIT_INTEGRATIONS.packageImports],
        projectExports: [...EMPTY_GIT_INTEGRATIONS.projectExports],
        repoSyncs: [...EMPTY_GIT_INTEGRATIONS.repoSyncs],
      };
}

export async function writeGitIntegrationsSettings(
  orgId: string,
  settings: GitIntegrationsSettings,
): Promise<GitIntegrationsSettings> {
  const value = gitIntegrationsSettingsSchema.parse(settings);
  await putOrgSetting(orgId, SETTING_KEY, value);
  return value;
}
