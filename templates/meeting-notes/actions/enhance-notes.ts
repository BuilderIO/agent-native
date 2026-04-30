/**
 * Delegate: enhance meeting notes by merging raw notes with the transcript.
 *
 * DELEGATION PATTERN:
 * This is a server-side action, so it cannot call `sendToAgentChat` (which is
 * a browser-only postMessage API). Instead, we write a structured delegation
 * request to application_state. The app's UI listens for these requests via
 * polling and dispatches them to the agent chat. Alternatively the agent may
 * call this action as a tool -- in which case it already has the context and
 * will enhance the notes directly.
 *
 * Usage:
 *   pnpm action enhance-notes --meetingId=<id>
 *   pnpm action enhance-notes --meetingId=<id> --templateId=<tid>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

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
    await assertAccess("meeting", args.meetingId, "editor");

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

    // Write delegation request to application state. The UI polls for these
    // and dispatches them to the agent chat. When called as a tool, the agent
    // sees the context directly and processes the request inline.
    const request = {
      kind: "enhance-notes" as const,
      meetingId: args.meetingId,
      templateId: args.templateId ?? null,
      requestedAt: new Date().toISOString(),
      meetingTitle: meeting.title,
      startTime: meeting.startTime ?? null,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText: transcript?.fullText ?? "",
      rawNotes: notes?.rawContent ?? "{}",
      templatePrompt: templatePrompt || null,
      message:
        `Enhance the notes for meeting "${meeting.title}" (id: ${args.meetingId}). ` +
        `Merge the user's raw notes with the transcript to create comprehensive, ` +
        `well-structured meeting notes. Include key decisions, action items, and ` +
        `important discussion points.${templatePrompt}\n\n` +
        `After generating the enhanced notes, update the meeting by calling ` +
        `update-meeting with --id=${args.meetingId} --status=done.`,
    };

    await writeAppState(`notes-ai-request-${args.meetingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: enhance-notes for ${args.meetingId}`);

    return {
      queued: true,
      meetingId: args.meetingId,
      status: "enhancing",
      message: "Notes enhancement delegated to agent.",
    };
  },
});
