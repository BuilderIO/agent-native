/**
 * Get a single meeting (with its participants and action items) — access checked.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";

interface Bullet {
  text: string;
}
interface ActionItem {
  assigneeEmail?: string;
  text: string;
  dueDate?: string;
}

/**
 * Defensive JSON parse — returns the fallback (and logs a warning) on bad
 * data so legacy / malformed rows don't crash the response.
 */
function safeParseArray<T>(
  raw: string | null | undefined,
  rowId: string,
  field: string,
): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (err) {
    console.warn(
      `[get-meeting] malformed ${field} JSON on row ${rowId}:`,
      (err as Error)?.message ?? err,
    );
    return [];
  }
}

export default defineAction({
  description:
    "Get a meeting by id with its participants, action items, and a reference to its recording (if any). Returns null if the user lacks access.",
  schema: z.object({
    id: z.string().describe("Meeting id"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const access = await resolveAccess("meeting", args.id);
    if (!access) return { meeting: null };

    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.id))
      .limit(1);
    if (!row) return { meeting: null };

    // Server-side JSON parse — clients see structured arrays, not raw TEXT.
    const bullets = safeParseArray<Bullet>(
      row.bulletsJson,
      row.id,
      "bullets_json",
    );
    const actionItemsParsed = safeParseArray<ActionItem>(
      row.actionItemsJson,
      row.id,
      "action_items_json",
    );

    const meeting = {
      ...row,
      bullets,
      actionItemsParsed,
    };

    const participants = await db
      .select()
      .from(schema.meetingParticipants)
      .where(eq(schema.meetingParticipants.meetingId, args.id));

    const actionItems = await db
      .select()
      .from(schema.meetingActionItems)
      .where(eq(schema.meetingActionItems.meetingId, args.id));

    let recording = null;
    let transcript = null;
    if (row.recordingId) {
      const [rec] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, row.recordingId))
        .limit(1);
      recording = rec ?? null;
      const [tr] = await db
        .select()
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, row.recordingId))
        .limit(1);
      transcript = tr ?? null;
    }

    return { meeting, participants, actionItems, recording, transcript };
  },
});
