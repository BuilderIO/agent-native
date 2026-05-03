/**
 * Finalize a meeting — runs the Gemini cleanup pass on its transcript and
 * persists summary, bullets, and action items.
 *
 * Reads the linked recording's transcript (`recording_transcripts`) and
 * delegates to `cleanup-transcript` (task='summary'). Writes results to:
 *   - meetings.summaryMd / bulletsJson / actionItemsJson / transcriptStatus
 *   - meeting_action_items (one row per item)
 *
 * Idempotent: rerunning replaces the previous summary + action item rows.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import cleanupTranscript from "./cleanup-transcript.js";

export default defineAction({
  description:
    "Finalize a meeting: run the Gemini 3.1 Flash-Lite cleanup pass on its transcript, persist summary + bullets + action items, and flip transcriptStatus to 'ready'. Editor access required.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
    overrideTranscript: z
      .string()
      .optional()
      .describe(
        "Use this transcript text instead of the linked recording's transcript (rarely needed — for tests / replays).",
      ),
  }),
  run: async (args) => {
    await assertAccess("meeting", args.meetingId, "editor");
    const db = getDb();
    const nowIso = new Date().toISOString();

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.meetingId))
      .limit(1);
    if (!meeting) throw new Error(`Meeting not found: ${args.meetingId}`);

    let transcriptText = args.overrideTranscript ?? "";
    if (!transcriptText && meeting.recordingId) {
      const [t] = await db
        .select()
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, meeting.recordingId))
        .limit(1);
      transcriptText = t?.fullText ?? "";
    }
    if (!transcriptText.trim()) {
      await db
        .update(schema.meetings)
        .set({
          transcriptStatus: "failed",
          updatedAt: nowIso,
        })
        .where(eq(schema.meetings.id, args.meetingId));
      throw new Error(
        `Cannot finalize meeting ${args.meetingId} — no transcript text available yet.`,
      );
    }

    // Mark pending so the UI shows a spinner during the LLM call.
    await db
      .update(schema.meetings)
      .set({ transcriptStatus: "pending", updatedAt: nowIso })
      .where(eq(schema.meetings.id, args.meetingId));

    const participants = await db
      .select()
      .from(schema.meetingParticipants)
      .where(eq(schema.meetingParticipants.meetingId, args.meetingId));

    const contextLines: string[] = [];
    if (meeting.title) contextLines.push(`Meeting: ${meeting.title}`);
    if (meeting.scheduledStart)
      contextLines.push(`Scheduled: ${meeting.scheduledStart}`);
    if (participants.length) {
      contextLines.push(
        `Attendees: ${participants
          .map((p) => `${p.name ?? p.email} <${p.email}>`)
          .join(", ")}`,
      );
    }

    let result;
    try {
      result = await cleanupTranscript.run({
        transcript: transcriptText,
        task: "summary",
        context: contextLines.join("\n") || undefined,
      });
    } catch (err) {
      await db
        .update(schema.meetings)
        .set({
          transcriptStatus: "failed",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.meetings.id, args.meetingId));
      throw err;
    }

    const summaryMd = result.summaryMd ?? "";
    const bullets = result.bullets ?? [];
    const actionItems = result.actionItems ?? [];

    await db
      .update(schema.meetings)
      .set({
        transcriptStatus: "ready",
        summaryMd,
        bulletsJson: JSON.stringify(bullets),
        actionItemsJson: JSON.stringify(actionItems),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.meetings.id, args.meetingId));

    // Replace the per-row action items so the dedicated table mirrors the
    // JSON column. Best-effort.
    await db
      .delete(schema.meetingActionItems)
      .where(eq(schema.meetingActionItems.meetingId, args.meetingId));
    if (actionItems.length) {
      await db.insert(schema.meetingActionItems).values(
        actionItems.map((item) => ({
          id: nanoid(),
          meetingId: args.meetingId,
          assigneeEmail: item.assigneeEmail ?? null,
          text: item.text,
          dueDate: item.dueDate ?? null,
          completedAt: null,
        })),
      );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      meetingId: args.meetingId,
      summaryMd,
      bullets,
      actionItems,
      provider: result.provider,
    };
  },
});
