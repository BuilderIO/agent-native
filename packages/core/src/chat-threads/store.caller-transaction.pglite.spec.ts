import { afterAll, beforeAll, expect, it } from "vitest";

import { withExecutionFence } from "../agent/execution-fence.js";
import { claimTaskExecutionLease } from "../agent/run-store.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { createThread, getThread, updateThreadData } from "./store.js";

let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

it("rolls a fenced thread-data write back with the caller's transaction", async () => {
  const threadId = "caller-transaction";
  await createThread("owner@example.com", { id: threadId });
  const fence = await claimTaskExecutionLease(threadId, "turn-1", "run-1");
  const db = getDbExec();
  const transaction = db.transaction?.bind(db);
  if (!transaction) throw new Error("PGlite executor has no transactions");

  await expect(
    withExecutionFence(fence, () =>
      transaction(async (tx) => {
        await updateThreadData(
          threadId,
          JSON.stringify({ messages: [{ id: "admitted" }] }),
          "",
          "",
          1,
          { transaction: tx },
        );
        const { rows } = await tx.execute({
          sql: "SELECT thread_data FROM chat_threads WHERE id = ?",
          args: [threadId],
        });
        expect(String(rows[0]?.thread_data)).toContain("admitted");
        throw new Error("Caller write failed");
      }),
    ),
  ).rejects.toThrow("Caller write failed");

  expect((await getThread(threadId))?.threadData).not.toContain("admitted");
});
