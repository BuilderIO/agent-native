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
import {
  authorizeFavoriteTables,
  getDataTableDetails,
} from "./data-table-details.js";
import { resolveSavedDataTables } from "./saved-data-tables.js";

export const dataFavoriteRefSchema = z
  .object({ connectionId: z.string().min(1), tableId: z.string().min(1) })
  .strict();
export const setDataFavoriteSchema = dataFavoriteRefSchema.extend({
  favorited: z.boolean(),
});
export const dataFavoritesSchema = z.object({
  favorites: z.array(dataFavoriteRefSchema.extend({ name: z.string() })),
});
const storedSchema = z
  .object({ favorites: z.array(dataFavoriteRefSchema).max(100) })
  .strict();
type Stored = z.infer<typeof storedSchema>;

function parseStored(value: unknown): Stored {
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success)
    fail("Data favorites could not be read.", {
      statusCode: 500,
      errorCode: "data_favorites_corrupt",
    });
  return parsed.data;
}

async function workspace() {
  const current = await requireCurrentWorkspace();
  const capabilities = await currentWorkspaceCapabilities(current);
  if (!capabilities.allows("context-studio"))
    fail("You do not have access to the data browser.", {
      statusCode: 403,
      errorCode: "data_favorites_access_denied",
    });
  return current;
}

function settingKey(orgId: string) {
  return `analytics.data.favorites:v1:${encodeURIComponent(orgId)}`;
}

export async function listDataFavorites(caller?: string) {
  const current = await workspace();
  const entry = await getUserSettingEntry(
    current.ownerEmail,
    settingKey(current.orgId),
  );
  const refs = entry.found ? parseStored(entry.value).favorites : [];
  const favorites = await resolveSavedDataTables(refs, caller);
  return { favorites };
}

export async function setDataFavorite(
  input: z.infer<typeof setDataFavoriteSchema>,
  caller?: string,
) {
  const current = await workspace();
  const { connectionId, tableId, favorited } =
    setDataFavoriteSchema.parse(input);
  const ref = { connectionId, tableId };
  if (favorited) await getDataTableDetails(ref, caller);
  else
    await authorizeFavoriteTables([ref], caller, { allowMissingSample: true });
  const result = await mutateUserSetting(
    current.ownerEmail,
    settingKey(current.orgId),
    (value) => {
      const stored = value === null ? { favorites: [] } : parseStored(value);
      const remaining = stored.favorites.filter(
        (item) =>
          item.connectionId !== connectionId || item.tableId !== tableId,
      );
      if (favorited && remaining.length >= 100)
        fail("Too many data favorites.", {
          statusCode: 409,
          errorCode: "data_favorites_limit",
        });
      return { favorites: favorited ? [ref, ...remaining] : remaining };
    },
    {
      validateStoredValue: (value) => {
        parseStored(value);
      },
    },
  );
  parseStored(result);
  return { ...ref, favorited };
}
