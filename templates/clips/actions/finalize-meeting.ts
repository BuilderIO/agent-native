
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import type { VoiceContextPack } from "@agent-native/core/voice";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import cleanupTranscript, { CleanupResult } from "./cleanup-transcript.js";
import { loadAgentsMdContext } from "./lib/agents-md-context.js";

const PENDING_STALE_MS = 2 * 60 * 1000;

export function skippedFinalizeResult(meetingId: string) {
  return {
    meetingId,
    summaryMd: "",
    bullets: [],
    actionItems: [],
    provider: null,
    skipped: "no-transcript" as const,
  };
}

function trimContextValue(value: string, maxChars: number): string {
  const trimmed = value.replace(/\0/g, "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

export default defineAction({
  description:
    "Finalize a meeting: run the low-cost text-model cleanup pass on its transcript, persist summary + bullets + action items, and flip transcriptStatus to 'ready'. Editor access required.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
    overrideTranscript: z
      .string()
      .optional()
      .describe(
        "Use this transcript text instead of the linked recording's transcript (rarely needed — for tests / replays).",
      ),
    force: z
      .boolean()
      .default(false)
      .describe(
        "Bypass the in-flight compare-and-swap guard. Used by the manual 'Regenerate notes' flow, which intentionally reruns finalize while transcriptStatus is already 'ready'.",
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
      if (!args.force) return skippedFinalizeResult(args.meetingId);
      throw new Error(
        `Cannot finalize meeting ${args.meetingId} — no transcript text available yet.`,
      );
    }

    const staleBefore = new Date(Date.now() - PENDING_STALE_MS).toISOString();
    const claimUpdatedAt = nowIso;
    const claimPredicate = args.force
      ? or(
          inArray(schema.meetings.transcriptStatus, ["ready", "failed"]),
          and(
            eq(schema.meetings.transcriptStatus, "pending"),
            lt(schema.meetings.updatedAt, staleBefore),
          ),
        )
      : inArray(schema.meetings.transcriptStatus, ["ready", "failed"]);
    const claimed = await db
      .update(schema.meetings)
      .set({ transcriptStatus: "pending", updatedAt: nowIso })
      .where(and(eq(schema.meetings.id, args.meetingId), claimPredicate))
      .returning({ id: schema.meetings.id });

    if (!claimed.length) {
      const [current] = await db
        .select()
        .from(schema.meetings)
        .where(eq(schema.meetings.id, args.meetingId))
        .limit(1);
      const bulletsJson = current?.bulletsJson ?? meeting.bulletsJson ?? "[]";
      const actionItemsJson =
        current?.actionItemsJson ?? meeting.actionItemsJson ?? "[]";
      return {
        meetingId: args.meetingId,
        summaryMd: current?.summaryMd ?? meeting.summaryMd,
        bullets: JSON.parse(bulletsJson),
        actionItems: JSON.parse(actionItemsJson),
        provider: null,
        skipped: "already-in-progress",
      };
    }

    const [participants, recordingRows, agentsContext] = await Promise.all([
      db
        .select()
        .from(schema.meetingParticipants)
        .where(eq(schema.meetingParticipants.meetingId, args.meetingId)),
      meeting.recordingId
        ? db
            .select({
              title: schema.recordings.title,
              sourceAppName: schema.recordings.sourceAppName,
              sourceWindowTitle: schema.recordings.sourceWindowTitle,
              description: schema.recordings.description,
            })
            .from(schema.recordings)
            .where(eq(schema.recordings.id, meeting.recordingId))
            .limit(1)
        : Promise.resolve([]),
      loadAgentsMdContext({
        ownerEmail: meeting.ownerEmail,
        purpose: "summary",
      }),
    ]);
    const linkedRecording = recordingRows[0] ?? null;

    const contextSnippets: NonNullable<VoiceContextPack["snippets"]> = [];
    const addSnippet = (label: string, value: string, maxChars = 2_000) => {
      const trimmed = trimContextValue(value, maxChars);
      if (trimmed) contextSnippets.push({ label, value: trimmed });
    };
    if (meeting.title) addSnippet("Meeting title", meeting.title, 200);
    if (meeting.scheduledStart)
      addSnippet("Scheduled start", meeting.scheduledStart, 120);
    if (participants.length) {
      addSnippet(
        "Attendees",
        participants.map((p) => `${p.name ?? p.email} <${p.email}>`).join(", "),
        1800,
      );
    }
    if (meeting.userNotesMd.trim()) {
      addSnippet("User notes", meeting.userNotesMd, 3_000);
    }
    if (linkedRecording) {
      addSnippet(
        "Linked Clip",
        [
          linkedRecording.title,
          linkedRecording.sourceAppName,
          linkedRecording.sourceWindowTitle,
          linkedRecording.description,
        ]
          .filter(Boolean)
          .join("\n"),
        1800,
      );
    }
    if (agentsContext)
      addSnippet("AGENTS.md preferences", agentsContext, 3_000);
    const contextPack: VoiceContextPack | undefined = contextSnippets.length
      ? {
          surface: "clips-meeting",
          mode: "summary",
          snippets: contextSnippets,
          metadata: {
            meetingId: meeting.id,
            recordingId: meeting.recordingId,
            calendarEventId: meeting.calendarEventId,
            source: meeting.source,
            platform: meeting.platform,
          },
        }
      : undefined;

    let result: CleanupResult;
    try {
      result = await cleanupTranscript.run({
        transcript: transcriptText,
        task: "summary",
        contextPack,
      });
    } catch (err) {
      await db
        .update(schema.meetings)
        .set({
          transcriptStatus: "failed",
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.meetings.id, args.meetingId),
            eq(schema.meetings.transcriptStatus, "pending"),
          ),
        );
      throw err;
    }

    const summaryMd = result.summaryMd ?? "";
    const bullets = result.bullets ?? [];
    const actionItems = result.actionItems ?? [];

    let persistedActionItems = actionItems;
    await db.transaction(async (tx) => {
      const finalNow = new Date().toISOString();
      const written = await tx
        .update(schema.meetings)
        .set({
          transcriptStatus: "ready",
          summaryMd,
          bulletsJson: JSON.stringify(bullets),
          actionItemsJson: JSON.stringify(actionItems),
          updatedAt: finalNow,
        })
        .where(
          and(
            eq(schema.meetings.id, args.meetingId),
            eq(schema.meetings.transcriptStatus, "pending"),
            eq(schema.meetings.updatedAt, claimUpdatedAt),
          ),
        )
        .returning({ id: schema.meetings.id });
      if (written.length) {
        await tx
          .delete(schema.meetingActionItems)
          .where(eq(schema.meetingActionItems.meetingId, args.meetingId));
        if (actionItems.length) {
          await tx.insert(schema.meetingActionItems).values(
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
        return;
      }

      const [preserved] = await tx
        .update(schema.meetings)
        .set({
          transcriptStatus: "ready",
          summaryMd,
          bulletsJson: JSON.stringify(bullets),
          updatedAt: finalNow,
        })
        .where(
          and(
            eq(schema.meetings.id, args.meetingId),
            eq(schema.meetings.transcriptStatus, "pending"),
          ),
        )
        .returning({ actionItemsJson: schema.meetings.actionItemsJson });
      if (!preserved?.actionItemsJson) return;

      try {
        const currentActionItems = JSON.parse(preserved.actionItemsJson);
        if (Array.isArray(currentActionItems)) {
          persistedActionItems = currentActionItems;
        }
      } catch (error) {
        console.warn(
          "[finalize-meeting] preserved action items JSON was malformed; keeping dedicated rows",
          error,
        );
      }
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      meetingId: args.meetingId,
      summaryMd,
      bullets,
      actionItems: persistedActionItems,
      provider: result.provider,
    };
  },
});
