import type { DbExec } from "../db/client.js";
import { assertIdentityColumnsRegistered as validateIdentityColumns } from "./rekey.js";

/** Validate a migrated app database after its identity policies are registered. */
export async function assertIdentityColumnsRegistered(
  db: DbExec,
): Promise<void> {
  await validateIdentityColumns({
    async unsafe(sql) {
      const { rows } = await db.execute(sql);
      return rows;
    },
  });
}
