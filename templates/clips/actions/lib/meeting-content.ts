export interface MeetingContentFields {
  recordingId?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  summaryMd?: string | null;
  userNotesMd?: string | null;
  bulletsJson?: string | null;
  actionItemsJson?: string | null;
}

export const AGENT_MEETINGS_PER_CALL = 25;

/**
 * A meeting row for an agent picking a meeting. Whole summaries, notes and
 * bullets can run long, and an MCP read isn't cut down, so the row keeps a
 * preview and get-meeting has the rest.
 */
export function meetingRowForAgent<T extends MeetingContentFields>({
  summaryMd,
  userNotesMd,
  bulletsJson: _bulletsJson,
  ...row
}: T) {
  const summary = (summaryMd ?? "").trim();
  return {
    ...row,
    summaryPreview: summary ? summary.replace(/\s+/g, " ").slice(0, 100) : null,
    hasNotes: Boolean((userNotesMd ?? "").trim()),
  };
}

export function meetingRowHasContent(row: MeetingContentFields): boolean {
  return Boolean(
    row.recordingId ||
    row.actualStart ||
    row.actualEnd ||
    (row.summaryMd ?? "").trim() ||
    (row.userNotesMd ?? "").trim() ||
    (row.bulletsJson ?? "[]") !== "[]" ||
    (row.actionItemsJson ?? "[]") !== "[]",
  );
}
