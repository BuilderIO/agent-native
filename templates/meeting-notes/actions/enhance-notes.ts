/**
 * Enhance meeting notes by merging the user's raw notes with the transcript.
 *
 * This delegates to the agent chat via sendToAgentChat — the agent reads
 * the raw notes + transcript, applies the selected template, and writes
 * the enhanced result back to meeting_notes.enhanced_content.
 *
 * Usage:
 *   pnpm action enhance-notes --meetingId=<id>
 *   pnpm action enhance-notes --meetingId=<id> --templateId=<tid>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { sendToAgentChat } from "@agent-native/core/agent-chat";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Enhance meeting notes by merging the user's raw notes with the transcript using AI. Delegates to the agent chat. Optionally uses a template to structure the output.",
  schema: z.object({
    meetingId: z.string().describe("Meeting ID"),
    templateId: z
      .string()
      .optional()
      .describe("Template ID to use for structuring the enhanced notes"),
  }),
  run: async (args) => {
    const db = getDb();

    // Fetch meeting
    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.meetingId));
    if (!meeting) throw new Error(`Meeting not found: ${args.meetingId}`);

    // Fetch transcript
    const [transcript] = await db
      .select()
      .from(schema.meetingTranscripts)
      .where(eq(schema.meetingTranscripts.meetingId, args.meetingId));

    // Fetch notes
    const [notes] = await db
      .select()
      .from(schema.meetingNotes)
      .where(eq(schema.meetingNotes.meetingId, args.meetingId));

    // Fetch template if specified
    let templatePrompt = "";
    if (args.templateId) {
      const [template] = await db
        .select()
        .from(schema.meetingTemplates)
        .where(eq(schema.meetingTemplates.id, args.templateId));
      if (template) {
        templatePrompt = `\n\nUse this template to structure the enhanced notes:\n${template.prompt}`;
      }
    }

    // Mark meeting as enhancing
    await db
      .update(schema.meetings)
      .set({ status: "enhancing", updatedAt: new Date().toISOString() })
      .where(eq(schema.meetings.id, args.meetingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    // Build context for the agent
    const context = [
      `Meeting: "${meeting.title}"`,
      meeting.startTime ? `Start: ${meeting.startTime}` : null,
      transcript?.fullText
        ? `Transcript:\n${transcript.fullText}`
        : "No transcript available.",
      notes?.rawContent
        ? `User's raw notes:\n${notes.rawContent}`
        : "No raw notes.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const message = `Enhance the notes for meeting "${meeting.title}" (id: ${args.meetingId}). Merge the user's raw notes with the transcript to create comprehensive, well-structured meeting notes. Include key decisions, action items, and important discussion points.${templatePrompt}

After generating the enhanced notes, update the meeting by calling update-meeting with --id=${args.meetingId} --status=done, and store the enhanced content in the meeting_notes table.`;

    await sendToAgentChat({
      background: true,
      context,
      message,
    });

    return {
      meetingId: args.meetingId,
      status: "enhancing",
      message: "Notes enhancement delegated to agent.",
    };
  },
});
