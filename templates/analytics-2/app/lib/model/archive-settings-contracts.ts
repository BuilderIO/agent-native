import { z } from "zod";

export const MIN_ARCHIVE_CADENCE_DAYS = 1;
export const MAX_ARCHIVE_CADENCE_DAYS = 999;
export const DEFAULT_ARCHIVE_CADENCE_DAYS = 365;

const cadence = z
  .number()
  .int()
  .min(MIN_ARCHIVE_CADENCE_DAYS)
  .max(MAX_ARCHIVE_CADENCE_DAYS)
  .nullable();

export const archiveSettingsSchema = z
  .object({
    noEditArchiveCadence: cadence,
    noViewArchiveCadence: cadence,
  })
  .strict();

export type ArchiveSettings = z.infer<typeof archiveSettingsSchema>;
