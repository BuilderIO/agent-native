import { defineEventHandler, getRouterParam } from "h3";
import { getDbExec } from "@agent-native/core/db";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) return { error: "id required" };

  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM slide_comments WHERE id = ?`,
    args: [id],
  });

  return { ok: true };
});
