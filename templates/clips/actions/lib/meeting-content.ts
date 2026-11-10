import { isAgentRecordingCaller } from "../../server/lib/agent-recording-access.js";

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
 * Agents reading meetings: the in-app agent, outside MCP clients, A2A, and an
 * agent driving the page through WebMCP. Their meeting reads come back short.
 */
export function isAgentMeetingCaller(caller: string | undefined): boolean {
  return isAgentRecordingCaller(caller) || caller === "webmcp";
}

function countActionItems(raw: string | null | undefined): number {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * A meeting row for an agent picking a meeting. Whole summaries, notes,
 * bullets and action items can run long, and an MCP read isn't cut down, so
 * the row keeps a preview and counts, and get-meeting has the rest.
 */
export function meetingRowForAgent<T extends MeetingContentFields>({
  summaryMd,
  userNotesMd,
  bulletsJson: _bulletsJson,
  actionItemsJson,
  ...row
}: T) {
  const summary = (summaryMd ?? "").trim();
  return {
    ...row,
    summaryPreview: summary ? summary.replace(/\s+/g, " ").slice(0, 100) : null,
    hasNotes: Boolean((userNotesMd ?? "").trim()),
    actionItemCount: countActionItems(actionItemsJson),
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
