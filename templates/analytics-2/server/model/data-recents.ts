import { fail } from "@agent-native/core/action";
import {
  getUserSettingEntry,
  mutateUserSetting,
} from "@agent-native/core/settings";
import { z } from "zod";

import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import { authorizeFavoriteTables } from "./data-table-details.js";
import { resolveSavedDataTables } from "./saved-data-tables.js";

export const dataRecentRefSchema = z
  .object({ connectionId: z.string().min(1), tableId: z.string().min(1) })
  .strict();
export const touchDataRecentSchema = dataRecentRefSchema;
export const dataRecentsSchema = z.object({
  recents: z.array(dataRecentRefSchema.extend({ name: z.string() })),
});
const storedSchema = z
  .object({ recents: z.array(dataRecentRefSchema).max(100) })
  .strict();
type Stored = z.infer<typeof storedSchema>;

function parseStored(value: unknown): Stored {
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success)
    fail("Data recents could not be read.", {
      statusCode: 500,
      errorCode: "data_recents_corrupt",
    });
  return parsed.data;
}

async function workspace() {
  const current = await requireCurrentWorkspace();
  const capabilities = await currentWorkspaceCapabilities(current);
  if (!capabilities.allows("context-studio"))
    fail("You do not have access to the data browser.", {
      statusCode: 403,
      errorCode: "data_recents_access_denied",
    });
  return current;
}

function settingKey(orgId: string) {
  return `analytics.data.recents:v1:${encodeURIComponent(orgId)}`;
}

export async function listDataRecents(caller?: string) {
  const current = await workspace();
  const entry = await getUserSettingEntry(
    current.ownerEmail,
    settingKey(current.orgId),
  );
  const refs = entry.found ? parseStored(entry.value).recents : [];
  const recents = await resolveSavedDataTables(refs, caller);
  return { recents };
}

export async function touchDataRecent(
  input: z.infer<typeof touchDataRecentSchema>,
  caller?: string,
) {
  const current = await workspace();
  const { connectionId, tableId } = touchDataRecentSchema.parse(input);
  const ref = { connectionId, tableId };
  await authorizeFavoriteTables([ref], caller);
  const latest = await workspace();
  if (
    latest.orgId !== current.orgId ||
    latest.ownerEmail !== current.ownerEmail
  )
    fail("The workspace changed. Retry the request.", {
      statusCode: 409,
      errorCode: "data_recents_scope_changed",
    });
  const result = await mutateUserSetting(
    current.ownerEmail,
    settingKey(current.orgId),
    (value) => {
      const stored = value === null ? { recents: [] } : parseStored(value);
      const remaining = stored.recents.filter(
        (item) =>
          item.connectionId !== connectionId || item.tableId !== tableId,
      );
      return { recents: [ref, ...remaining].slice(0, 100) };
    },
    {
      validateStoredValue: (value) => {
        parseStored(value);
      },
    },
  );
  const saved = parseStored(result);
  const first = saved.recents.at(0);
  if (
    !first ||
    first.connectionId !== connectionId ||
    first.tableId !== tableId
  )
    fail("Data recents could not be saved.", {
      statusCode: 500,
      errorCode: "data_recents_write_failed",
    });
  const persisted = await getUserSettingEntry(
    current.ownerEmail,
    settingKey(current.orgId),
    { bypassCache: true },
  );
  if (
    !persisted.found ||
    !parseStored(persisted.value).recents.some(
      (item) => item.connectionId === connectionId && item.tableId === tableId,
    )
  )
    fail("Data recents could not be saved.", {
      statusCode: 500,
      errorCode: "data_recents_write_failed",
    });
  return ref;
}
