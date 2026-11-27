export const CONTENT_TRASH_RETENTION_DAYS = 30;

export const CONTENT_TRASH_RETENTION_MS =
  CONTENT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface ContentTrashRetention {
  retentionDays: number;
  startedAt: string | null;
  deletionsBeginAt: string | null;
}

export function contentTrashRetentionDeletionsBeginAt(
  startedAt: string,
): string {
  return new Date(
    Date.parse(startedAt) + CONTENT_TRASH_RETENTION_MS,
  ).toISOString();
}
