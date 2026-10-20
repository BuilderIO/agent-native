/** Age past which a source table counts as stale for display. */
export const SOURCE_GENERATION_STALE_AFTER_MS = 75 * 60_000;

export type SourceGenerationUnavailableReason =
  | "invalid_table_id"
  | "not_found"
  | "access_denied"
  | "no_modified_time"
  | "lookup_failed";

/**
 * One table's generation: its BigQuery `lastModifiedTime`. That is when the
 * table was last modified, a conservative change token, not proof that the
 * job which modified it succeeded end to end.
 */
export interface AvailableSourceGeneration {
  tableId: string;
  status: "ok";
  generation: string;
  modifiedAt: string;
  checkedAt: string;
}

export interface UnavailableSourceGeneration {
  tableId: string;
  status: "unavailable";
  reason: SourceGenerationUnavailableReason;
  checkedAt: string;
}

export type SourceGenerationEntry =
  | AvailableSourceGeneration
  | UnavailableSourceGeneration;

/**
 * The generation vector for the tables one query reads. Tables are built
 * independently, so `generation` identifies the combination; it does not
 * claim the tables form one consistent snapshot.
 */
export type SourceGenerationResult =
  | {
      status: "ok";
      sources: AvailableSourceGeneration[];
      generation: string;
      oldestModifiedAt: string;
      ageMs: number;
      stale: boolean;
      checkedAt: string;
    }
  | {
      status: "unavailable";
      sources: SourceGenerationEntry[];
      reason: SourceGenerationUnavailableReason;
      checkedAt: string;
    };
