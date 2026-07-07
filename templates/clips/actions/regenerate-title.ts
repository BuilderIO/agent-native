/**
 * Regenerate the recording's title using its transcript.
 *
 * Title generation uses the same Gemini 3.1 Flash-Lite media-pipeline path as
 * transcript cleanup so a freshly recorded clip can get a useful title without
 * waiting for the agent chat bridge. If the fast path is unavailable, we still
 * queue the older agent-chat request as a fallback.
 *
 * When the user enables Include full video, we skip the transcript-only fast
 * path and always delegate so the agent can watch the recording.
 *
 * Usage:
 *   pnpm action regenerate-title --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isBuilderCreditsExhaustedMessage } from "../shared/builder-credits.js";
import { withFullVideoAiInstructions } from "../shared/clips-ai-prefs.js";
import cleanupTranscript from "./cleanup-transcript.js";
import { loadAgentsMdContext } from "./lib/agents-md-context.js";
import { clearBuilderCreditsExhausted } from "./lib/builder-credits-state.js";
import { readIncludeFullVideoInAi } from "./lib/clips-ai-prefs.js";
import {
  cleanGeneratedTitle,
  fallbackTitleFromTranscript,
} from "./lib/title-fallback.js";
import { isAutoTitleReplaceable, isDefaultTitle } from "./lib/title-source.js";

function transcriptTextFromSegments(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return "";
    return parsed
      .map((segment) =>
        typeof segment?.text === "string" ? segment.text.trim() : "",
      )
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function buildTitleContext({
  currentTitle,
  agentsContext,
}: {
  currentTitle?: string | null;
  agentsContext?: string;
}): string | undefined {
  const parts: string[] = [];
  if (currentTitle && !isDefaultTitle(currentTitle)) {
    parts.push(`Current title: ${currentTitle}`);
  }
  if (agentsContext) parts.push(agentsContext);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export async function queueTitleRegenerationRequest({
  recordingId,
  currentTitle,
  transcriptText,
  transcriptStatus = "ready",
  segmentsJson = "[]",
  ownerEmail,
  includeFullVideoInAi,
}: {
  recordingId: string;
  currentTitle: string | null | undefined;
  transcriptText: string;
  transcriptStatus?: string;
  segmentsJson?: string | null;
  ownerEmail?: string | null;
  includeFullVideoInAi?: boolean;
}) {
  const agentsContext = await loadAgentsMdContext({
    ownerEmail,
    purpose: "title",
  });
  const useVideo =
    includeFullVideoInAi ?? (await readIncludeFullVideoInAi(ownerEmail));
  const baseMessage =
    `Regenerate the title for recording ${recordingId}. ` +
    `Read the native transcript and AGENTS.md context in this request's context and call ` +
    `\`update-recording --id=${recordingId} --title="..."\` with a concise ` +
    `4-9 word descriptive title. Current title: "${currentTitle ?? ""}". ` +
    "Do not prompt the user.";
  const request = {
    kind: "regenerate-title" as const,
    recordingId,
    requestedAt: new Date().toISOString(),
    currentTitle: currentTitle ?? "",
    transcriptStatus,
    transcriptText,
    segmentsJson: segmentsJson ?? "[]",
    agentsContext,
    includeFullVideoInAi: useVideo,
    message: withFullVideoAiInstructions(baseMessage, recordingId, useVideo),
  };

  await writeAppState(`clips-ai-request-${recordingId}`, request as any);
  await writeAppState("refresh-signal", { ts: Date.now() });
  return request;
}

export default defineAction({
  description:
    "Regenerate this recording's title from its transcript using the configured cleanup/title path, falling back to a local transcript title when unavailable. When the user has enabled Include full video, delegates to the agent so it can watch the recording.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    transcriptText: z
      .string()
      .optional()
      .describe(
        "Optional native Web Speech/macOS Speech transcript text to title from immediately.",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const [rec] = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        titleSource: schema.recordings.titleSource,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!rec) throw new Error(`Recording not found: ${args.recordingId}`);

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    const transcriptText =
      args.transcriptText?.trim() ||
      transcript?.fullText?.trim() ||
      transcriptTextFromSegments(transcript?.segmentsJson);

    const includeFullVideoInAi = await readIncludeFullVideoInAi();

    // Full-video mode needs the agent to watch the clip; skip the transcript-
    // only Gemini fast path so we don't generate titles from audio alone.
    if (includeFullVideoInAi) {
      await queueTitleRegenerationRequest({
        recordingId: args.recordingId,
        currentTitle: rec.title,
        transcriptStatus: transcript?.status ?? "pending",
        transcriptText: transcriptText || "",
        segmentsJson: transcript?.segmentsJson ?? "[]",
        ownerEmail: getRequestUserEmail() ?? transcript?.ownerEmail,
        includeFullVideoInAi: true,
      });
      console.log(
        `Delegation queued: regenerate-title (full video) for ${args.recordingId}`,
      );
      return {
        queued: true,
        recordingId: args.recordingId,
        includeFullVideoInAi: true,
      };
    }

    if (
      (!args.transcriptText && transcript?.status !== "ready") ||
      !transcriptText
    ) {
      return {
        updated: false,
        skipped: true,
        reason: "transcript_not_ready",
        recordingId: args.recordingId,
        transcriptStatus: transcript?.status ?? "missing",
      };
    }

    const agentsContext = await loadAgentsMdContext({
      ownerEmail: getRequestUserEmail() ?? transcript?.ownerEmail,
      purpose: "title",
    });
    let builderCreditsPaused = false;

    try {
      const result = await cleanupTranscript.run({
        transcript: transcriptText,
        task: "title",
        context: buildTitleContext({
          currentTitle: rec.title,
          agentsContext,
        }),
      });
      const generatedTitle = cleanGeneratedTitle(result.title);

      if (generatedTitle) {
        const [fresh] = await db
          .select({
            title: schema.recordings.title,
            titleSource: schema.recordings.titleSource,
          })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId))
          .limit(1);

        if (!fresh) throw new Error(`Recording not found: ${args.recordingId}`);

        if (
          isAutoTitleReplaceable(fresh.title, fresh.titleSource) ||
          fresh.title === rec.title
        ) {
          await db
            .update(schema.recordings)
            .set({
              title: generatedTitle,
              titleSource: "ai",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.recordings.id, args.recordingId));
          await writeAppState("refresh-signal", { ts: Date.now() });
          if (result.provider === "builder") {
            await clearBuilderCreditsExhausted();
          }

          console.log(
            `Regenerated title for ${args.recordingId} via ${result.provider}: ${generatedTitle}`,
          );
          return {
            updated: true,
            recordingId: args.recordingId,
            title: generatedTitle,
            provider: result.provider,
          };
        }

        return {
          updated: false,
          skipped: true,
          reason: "Recording title changed before generation completed",
          recordingId: args.recordingId,
        };
      }
    } catch (err) {
      builderCreditsPaused = isBuilderCreditsExhaustedMessage(
        (err as Error)?.message ?? String(err),
      );
      console.warn(
        `[clips] AI title generation failed for ${args.recordingId}; falling back to local title:`,
        (err as Error).message,
      );
    }

    const fallbackTitle = fallbackTitleFromTranscript(transcriptText);
    if (fallbackTitle) {
      const [fresh] = await db
        .select({
          title: schema.recordings.title,
          titleSource: schema.recordings.titleSource,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId))
        .limit(1);

      if (!fresh) throw new Error(`Recording not found: ${args.recordingId}`);

      if (
        isAutoTitleReplaceable(fresh.title, fresh.titleSource) ||
        fresh.title === rec.title
      ) {
        await db
          .update(schema.recordings)
          .set({
            title: fallbackTitle,
            titleSource: "ai",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.recordings.id, args.recordingId));
        await writeAppState("refresh-signal", { ts: Date.now() });

        console.log(
          `Regenerated title for ${args.recordingId} via local fallback: ${fallbackTitle}`,
        );
        return {
          updated: true,
          recordingId: args.recordingId,
          title: fallbackTitle,
          provider: "local",
        };
      }
    }

    if (builderCreditsPaused) {
      return {
        updated: false,
        skipped: true,
        reason: "builder_credits_paused",
        recordingId: args.recordingId,
      };
    }

    await queueTitleRegenerationRequest({
      recordingId: args.recordingId,
      currentTitle: rec.title,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText,
      segmentsJson: transcript?.segmentsJson ?? "[]",
      ownerEmail: getRequestUserEmail() ?? transcript?.ownerEmail,
      includeFullVideoInAi: false,
    });

    console.log(`Delegation queued: regenerate-title for ${args.recordingId}`);
    return {
      queued: true,
      recordingId: args.recordingId,
    };
  },
});
