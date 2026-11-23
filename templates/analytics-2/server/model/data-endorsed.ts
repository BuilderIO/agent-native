import { fail } from "@agent-native/core/action";
import {
  getUserSettingEntry,
  mutateUserSetting,
} from "@agent-native/core/settings";

import {
  endorsedListSchema,
  type EndorsedItem,
} from "../../shared/qa-keyscreen-fixture.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";

function settingKey(orgId: string) {
  return `analytics.data.endorsed:v1:${encodeURIComponent(orgId)}`;
}

function parseStored(value: unknown) {
  const parsed = endorsedListSchema.safeParse(value);
  if (!parsed.success)
    fail("Endorsed data could not be read.", {
      statusCode: 500,
      errorCode: "data_endorsed_corrupt",
    });
  return parsed.data;
}

export async function listDataEndorsed(): Promise<{ items: EndorsedItem[] }> {
  const current = await requireCurrentWorkspace();
  const entry = await getUserSettingEntry(
    current.ownerEmail,
    settingKey(current.orgId),
  );
  return entry.found ? parseStored(entry.value) : { items: [] };
}

export async function writeDataEndorsed(items: EndorsedItem[]): Promise<void> {
  const current = await requireCurrentWorkspace();
  await mutateUserSetting(
    current.ownerEmail,
    settingKey(current.orgId),
    () => ({ items }),
    {
      validateStoredValue: (value) => {
        parseStored(value);
      },
    },
  );
}
