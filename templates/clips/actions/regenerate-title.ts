/**
 * Regenerate the recording's title using its transcript.
 *
 * Title generation uses the same Gemini 3.1 Flash-Lite media-pipeline path as
 * transcript cleanup so a freshly recorded clip can get a useful title without
 * waiting for the agent chat bridge. If the fast path is unavailable, we still
 * queue the older agent-chat request as a fallback.
 *
 * Usage:
 *   pnpm action regenerate-title --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import cleanupTranscript from "./cleanup-transcript.js";
import { loadAgentsMdContext } from "./lib/agents-md-context.js";
import {
  isAutoTitleReplaceable,
  isDefaultTitle,
} from "./lib/title-source.js";

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

function cleanGeneratedTitle(raw: string | null | undefined): string | null {
  const title = (raw ?? "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  return title.slice(0, 80);
}

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
]);

function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  if (TITLE_STOPWORDS.has(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function fallbackTitleFromTranscript(text: string): string | null {
  const normalized = text
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const chunks = normalized
    .split(/(?<=[.!?])\s+|(?:\s+-\s+)|(?:\s+—\s+)/)
    .map((chunk) =>
      chunk
        .replace(/^(ok|okay|yeah|yep|so|um|uh|alright|all right)[,\s]+/i, "")
        .trim(),
    )
    .filter(Boolean);
  const candidates = chunks.slice(0, 4).map((chunk) => {
    const words = chunk
      .split(/\s+/)
      .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'-]+$/gu, ""))
      .filter(Boolean)
      .slice(0, 9);
    const signal = words.filter(
      (word) => !TITLE_STOPWORDS.has(word.toLowerCase()),
    ).length;
    return { words, score: signal * 10 + Math.min(words.length, 9) };
  });
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  const words = best?.words ?? [];
  if (words.length < 2) return null;
  const title = words.map(titleCaseWord).join(" ");
  return cleanGeneratedTitle(title);
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

export default defineAction({
  description:
    "Regenerate this recording's title from its transcript using the configured cleanup/title path, falling back to a local transcript title when unavailable.",
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
    if (
      (!args.transcriptText && transcript?.status !== "ready") ||
      !transcriptText
    ) {
      throw new Error(
        "Transcript is not ready yet. Try again after transcription finishes.",
      );
    }

    const agentsContext = await loadAgentsMdContext({
      ownerEmail: getRequestUserEmail() ?? transcript?.ownerEmail,
      purpose: "title",
    });

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

    const request = {
      kind: "regenerate-title" as const,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      currentTitle: rec.title,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText,
      segmentsJson: transcript?.segmentsJson ?? "[]",
      agentsContext,
      message:
        `Regenerate the title for recording ${args.recordingId}. ` +
        `Read the native transcript and AGENTS.md context in this request's context and call ` +
        `\`update-recording --id=${args.recordingId} --title="..."\` with a concise ` +
        `4-9 word descriptive title. Current title: "${rec.title}". ` +
        "Do not prompt the user.",
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Delegation queued: regenerate-title for ${args.recordingId}`);
    return {
      queued: true,
      recordingId: args.recordingId,
    };
  },
});
