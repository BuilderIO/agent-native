import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";

import {
  archiveSettingsSchema,
  type ArchiveSettings,
} from "../../app/lib/model/archive-settings-contracts.js";

const SETTING_KEY = "analytics.archiveSettings";

const DISABLED: ArchiveSettings = {
  noEditArchiveCadence: null,
  noViewArchiveCadence: null,
};

export async function readArchiveSettings(
  orgId: string,
): Promise<ArchiveSettings> {
  const parsed = archiveSettingsSchema.safeParse(
    await getOrgSetting(orgId, SETTING_KEY),
  );
  return parsed.success ? parsed.data : { ...DISABLED };
}

export async function writeArchiveSettings(
  orgId: string,
  settings: ArchiveSettings,
): Promise<ArchiveSettings> {
  const value = archiveSettingsSchema.parse(settings);
  await putOrgSetting(orgId, SETTING_KEY, value);
  return value;
}
