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

/** How many action items the row stores, or null when its list can't be read. */
function countActionItems(raw: string | null | undefined): number | null {
  if (!raw) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // coercion-ok: null says the list couldn't be read; an empty one counts 0
    return null;
  }
  return Array.isArray(parsed) ? parsed.length : null;
}

/**
 * The columns an agent row is made from. Each is required, since a column a
 * query leaves out would read as an empty summary or no action items.
 */
interface MeetingAgentRowFields {
  summaryMd: string | null;
  userNotesMd: string | null;
  bulletsJson?: string | null;
  actionItemsJson: string | null;
  participants?: readonly unknown[];
}

/** How many participants an agent row names; get-meeting has them all. */
export const AGENT_ROW_PARTICIPANT_LIMIT = 10;

/**
 * A meeting row for an agent picking a meeting. Whole summaries, notes,
 * bullets, action items and attendee lists can run long, and an MCP read
 * isn't cut down, so the row keeps a preview and counts, and get-meeting has
 * the rest.
 */
export function meetingRowForAgent<T extends MeetingAgentRowFields>({
  summaryMd,
  userNotesMd,
  bulletsJson: _bulletsJson,
  actionItemsJson,
  participants,
  ...row
}: T) {
  const summary = (summaryMd ?? "").trim();
  return {
    ...row,
    ...(participants
      ? {
          participants: participants.slice(0, AGENT_ROW_PARTICIPANT_LIMIT),
          participantCount: participants.length,
        }
      : {}),
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
