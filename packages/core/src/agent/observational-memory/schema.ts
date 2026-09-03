import { table, text, integer, ownableColumns } from "../../db/schema.js";

/**
 * Observational Memory (OM) entries.
 *
 * A long-running agent thread is compacted in the background into a dated,
 * three-tier context so it costs far fewer tokens and stays prompt-cache
 * stable:
 *
 *   recent raw messages  →  dense "observations"  →  higher-level "reflections"
 *
 * Each row is ONE compaction artifact for a thread:
 *
 * - `tier = "observation"` — a dense, dated digest of a contiguous range of
 *   thread messages (task status, names, dates, decisions preserved). Produced
 *   by the Observer once a thread's unobserved messages exceed a token
 *   threshold.
 * - `tier = "reflection"` — a higher-level condensation OVER observations,
 *   produced by the Reflector once the observation log itself grows past its
 *   own threshold.
 *
 * The table is ownable (scoped reads/writes via `accessFilter`/`assertAccess`
 * per the `security` skill) and dialect-agnostic (Drizzle helpers from
 * `db/schema`, never raw SQLite types). The companion migrations live in
 * `./migrations.ts` and are additive-only.
 */
export const observationalMemory = table("observational_memory", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  /** Which tier this entry belongs to. */
  tier: text("tier", { enum: ["observation", "reflection"] }).notNull(),
  /** The dated, compacted text content of this entry. */
  text: text("text").notNull(),
  /** Estimated token count of `text` (used for the reflection threshold). */
  tokenEstimate: integer("token_estimate").notNull().default(0),
  /**
   * Inclusive index range of the source thread messages this entry summarizes.
   * For observations these are indices into the flattened thread-message array;
   * for reflections they span the observation indices that were folded.
   */
  sourceStartIndex: integer("source_start_index"),
  sourceEndIndex: integer("source_end_index"),
  /** How many source messages/observations this entry covers. */
  sourceMessageCount: integer("source_message_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  ...ownableColumns(),
});
