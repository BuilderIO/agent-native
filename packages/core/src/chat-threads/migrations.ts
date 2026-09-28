import { isServerlessRuntime } from "../db/client.js";
import type { MigrationEntry } from "../db/migrations.js";
import { runMigrations } from "../db/migrations.js";
import { repairLegacyChatThreadMessageCounts } from "./store.js";

export const CHAT_THREADS_MIGRATIONS_TABLE = "_chat_threads_migrations";
export {
  CHAT_THREAD_SCHEMA_MIGRATIONS,
  CHAT_THREAD_SCHEMA_MIGRATIONS_TABLE,
} from "./schema-migrations.js";

export const CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION =
  "chat-threads-repair-legacy-message-counts";

export const CHAT_THREADS_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION,
    sql: {},
    run: async () => {
      const { scanned, updated } = await repairLegacyChatThreadMessageCounts();
      if (scanned > 0) {
        console.log(
          `[chat-threads] repaired legacy message_count on ${updated} of ${scanned} scanned row(s)`,
        );
      }
    },
  },
];

/**
 * Apply data migrations only in a long-lived process. A serverless cold start
 * must never launch the legacy blob scan: concurrent isolates would all race
 * the same repair and exhaust the shared database even if route readiness does
 * not await it. Operators can run the app in a long-lived maintenance process
 * against the target database to apply the name-tracked repair once.
 */
export async function runChatThreadDataMigrations(
  nitroApp: unknown,
): Promise<"applied" | "skipped-serverless"> {
  if (isServerlessRuntime()) return "skipped-serverless";
  const migrate = runMigrations(CHAT_THREADS_MIGRATIONS, {
    table: CHAT_THREADS_MIGRATIONS_TABLE,
  });
  await migrate(nitroApp);
  return "applied";
}
