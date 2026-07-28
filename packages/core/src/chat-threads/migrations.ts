import type { MigrationEntry } from "../db/migrations.js";
import { repairLegacyChatThreadMessageCounts } from "./store.js";

export const CHAT_THREADS_MIGRATIONS_TABLE = "_chat_threads_migrations";

export const CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION =
  "chat-threads-repair-legacy-message-counts";

/**
 * Rows written before `message_count` was maintained still carry 0, and both
 * `listThreads` and `searchThreads` filter `message_count > 0` in SQL — so on a
 * database that predates the column, threads that do have messages never appear
 * in the sidebar. This entry is the only reachable caller of the repair; being
 * name-tracked, the `thread_data` scan it performs runs once per database and
 * is skipped entirely on every later boot.
 */
export const CHAT_THREADS_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION,
    // Run-only: the count comes from `normalizeThreadRepository`, which dedupes
    // and re-parents message entries. No portable SQL equivalent.
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
