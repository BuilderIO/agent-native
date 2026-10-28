import { afterAll, expect, it } from "vitest";

import { agentRunsStore } from "../agent/run-store.js";
import { chatThreadsStore } from "../chat-threads/store.js";
import { closeDbExec, getDbExec } from "./client.js";
// Relevant tables and ledger entries from the published 0.210.0 schema snapshot.
import oldSnapshot from "./tests/fixtures/core-0.210.0-stores.json";
import {
  __setSchemaSnapshotForTests,
  type SchemaSnapshot,
} from "./store-registry.js";

const previousUrl = process.env.DATABASE_URL;

it("upgrades a 0.210 snapshot during local startup", async () => {
  process.env.DATABASE_URL = "pglite:memory";
  __setSchemaSnapshotForTests(oldSnapshot as SchemaSnapshot);
  await agentRunsStore.ready();
  await chatThreadsStore.ready();
  const result = await getDbExec().execute(
    "SELECT interrupt_run_id, retry_count FROM agent_chat_submission_inbox LIMIT 1",
  );
  expect(result.rows).toEqual([]);
  const indexes = await getDbExec().execute(
    "SELECT indexname FROM pg_indexes WHERE indexname IN ('agent_runs_thread_projection_retry_order_idx', 'agent_chat_submission_inbox_thread_pending_idx') ORDER BY indexname",
  );
  expect(indexes.rows).toHaveLength(2);
});

afterAll(async () => {
  await closeDbExec();
  __setSchemaSnapshotForTests(undefined);
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});
