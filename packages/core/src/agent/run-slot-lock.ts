import type { DbExec } from "../db/client.js";

export async function lockThreadRunSlot(
  tx: DbExec,
  threadId: string,
): Promise<void> {
  await tx.execute({
    sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
    args: [`agent-native:run-slot:${threadId}`],
  });
}
