import { fail } from "@agent-native/core/action";

import { authorizeFavoriteTables } from "./data-table-details.js";

type TableRef = { connectionId: string; tableId: string };

/** Resolve accessible saved refs in order without provider metadata fanout. */
export async function resolveSavedDataTables(
  refs: readonly TableRef[],
  caller?: string,
) {
  const groups = new Map<string, TableRef[]>();
  for (const ref of refs)
    groups.set(ref.connectionId, [
      ...(groups.get(ref.connectionId) ?? []),
      ref,
    ]);
  const names = new Map<string, string>();
  for (const [connectionId, group] of groups) {
    try {
      const resolved = await authorizeFavoriteTables(group, caller);
      group.forEach((ref, index) => {
        const name = resolved[index];
        if (name === undefined)
          fail("Saved data tables could not be read.", {
            statusCode: 500,
            errorCode: "saved_data_tables_incomplete",
          });
        names.set(JSON.stringify([connectionId, ref.tableId]), name);
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "errorCode" in error &&
        error.errorCode === "data_connection_not_found"
      )
        continue;
      throw error;
    }
  }
  return refs.flatMap((ref) => {
    const name = names.get(JSON.stringify([ref.connectionId, ref.tableId]));
    return name === undefined ? [] : [{ ...ref, name }];
  });
}
