/**
 * The team-vocabulary-unique-term migration: one team word per organization and lowercased
 * term, so two admins adding the same word at once can't create two rows
 * (server/lib/vocabulary.ts upserts on this index).
 *
 * Duplicates added before the index existed are dropped first, keeping the
 * most recently updated row per word; otherwise the index can't be built and
 * startup fails.
 */
export const TEAM_VOCABULARY_UNIQUE_TERM_SQL = `DELETE FROM clips_vocabulary AS older
  USING clips_vocabulary AS newer
  WHERE older.visibility = 'org' AND newer.visibility = 'org'
    AND older.org_id = newer.org_id
    AND lower(older.term) = lower(newer.term)
    AND (older.updated_at < newer.updated_at
      OR (older.updated_at = newer.updated_at AND older.id < newer.id));
CREATE UNIQUE INDEX IF NOT EXISTS clips_vocabulary_team_term_idx
  ON clips_vocabulary (org_id, lower(term))
  WHERE visibility = 'org'`;
