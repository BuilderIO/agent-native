import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  DEFAULT_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
} from "../server/lib/gong-limits";
import {
  getCalls,
  getCallTranscript,
  getUsers,
  type GongCall,
  searchCalls,
} from "../server/lib/gong";

const DEFAULT_GONG_TRANSCRIPT_LIMIT = 3;
const MAX_GONG_TRANSCRIPT_LIMIT = 8;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 8_000;
const MAX_TRANSCRIPT_MAX_CHARS = 40_000;

const booleanQueryParam = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

interface TranscriptExtraction {
  text: string;
  sentenceCount: number;
  truncated: boolean;
}

interface TranscriptEvidence extends TranscriptExtraction {
  callId: string;
  title?: string;
  started?: string;
  error?: string;
}

function callLimitGuidance(limit: number, truncated: boolean): string {
  return truncated
    ? `Returned the ${limit} most recent matching calls. Answer from this bounded sample now; ask the user before loading more calls.`
    : `Returned ${limit} or fewer matching calls. Answer from these calls now; do not expand the search unless the user explicitly asks.`;
}

function normalizeBoundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value!)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatTranscriptOffset(value: unknown): string | null {
  const ms =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${minutes}:${String(seconds).padStart(2, "0")}]`;
}

function transcriptSpeaker(record: Record<string, unknown>): string | null {
  const speaker =
    stringValue(record.speakerName) ??
    stringValue(record.speaker) ??
    stringValue(record.name);
  if (speaker) return speaker;

  const speakerId =
    stringValue(record.speakerId) ??
    stringValue(record.speaker_id) ??
    (typeof record.speakerId === "number" ? String(record.speakerId) : null);
  return speakerId ? `Speaker ${speakerId}` : null;
}

function sentenceText(record: Record<string, unknown>): string | null {
  return (
    stringValue(record.text) ??
    stringValue(record.sentence) ??
    stringValue(record.content)
  );
}

export function extractTranscriptText(
  transcript: unknown,
  maxChars = DEFAULT_TRANSCRIPT_MAX_CHARS,
): TranscriptExtraction {
  const limit = normalizeBoundedInt(
    maxChars,
    DEFAULT_TRANSCRIPT_MAX_CHARS,
    1_000,
    MAX_TRANSCRIPT_MAX_CHARS,
  );
  const lines: string[] = [];
  let chars = 0;
  let sentenceCount = 0;
  let truncated = false;

  function addLine(text: string, record?: Record<string, unknown>) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;

    sentenceCount += 1;
    if (chars >= limit) {
      truncated = true;
      return;
    }

    const prefix = record
      ? [
          formatTranscriptOffset(record.start ?? record.startTime),
          transcriptSpeaker(record),
        ]
          .filter(Boolean)
          .join(" ")
      : "";
    const line = prefix ? `${prefix}: ${normalized}` : normalized;
    const remaining = limit - chars;
    if (line.length > remaining) {
      lines.push(line.slice(0, remaining).trimEnd());
      chars = limit;
      truncated = true;
      return;
    }

    lines.push(line);
    chars += line.length + 1;
  }

  function collect(value: unknown, inherited?: Record<string, unknown>) {
    if (truncated || value == null) return;

    if (typeof value === "string") {
      addLine(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) collect(item, inherited);
      return;
    }

    const record = asRecord(value);
    if (!record) return;
    const contextualRecord = inherited ? { ...inherited, ...record } : record;

    const text = sentenceText(record);
    if (text) {
      addLine(text, contextualRecord);
      return;
    }

    for (const key of [
      "callTranscripts",
      "transcript",
      "sentences",
      "segments",
    ]) {
      collect(record[key], contextualRecord);
    }
  }

  collect(transcript);

  if (!lines.length && transcript != null) {
    const raw = JSON.stringify(transcript);
    if (raw) {
      truncated = raw.length > limit;
      return {
        text: raw.slice(0, limit),
        sentenceCount: 0,
        truncated,
      };
    }
  }

  return {
    text: lines.join("\n"),
    sentenceCount,
    truncated,
  };
}

async function loadTranscriptEvidence(
  calls: GongCall[],
  limit: number,
  maxChars: number,
): Promise<TranscriptEvidence[]> {
  return Promise.all(
    calls.slice(0, limit).map(async (call) => {
      try {
        const transcript = await getCallTranscript(call.id);
        return {
          callId: call.id,
          title: call.title,
          started: call.started,
          ...extractTranscriptText(transcript, maxChars),
        };
      } catch (err) {
        return {
          callId: call.id,
          title: call.title,
          started: call.started,
          text: "",
          sentenceCount: 0,
          truncated: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

export default defineAction({
  description:
    "Query Gong sales calls, transcripts, and users. Pass --users for user list, --transcript for one transcript, --company to search by company/domain/person/email. For deal, customer, objection, next-step, or deep-dive analysis, set includeTranscripts=true so the answer uses transcript evidence instead of call metadata alone.",
  schema: z.object({
    users: booleanQueryParam
      .optional()
      .describe("Set to true to list Gong users"),
    transcript: z.string().optional().describe("Call ID to get transcript"),
    rawTranscript: booleanQueryParam
      .optional()
      .describe(
        "Set true only for debugging/export. By default transcript lookups return compact extracted text, not the large raw Gong payload.",
      ),
    company: z
      .string()
      .optional()
      .describe("Search calls by company name, domain, person, or email"),
    days: z.coerce
      .number()
      .optional()
      .describe("Number of days to look back (default 30)"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe(
        "Maximum number of calls to return for call searches (default 8, max 25). Use 5-8 for ordinary analysis.",
      ),
    includeTranscripts: booleanQueryParam
      .optional()
      .describe(
        "Fetch transcript excerpts for the newest matching calls. Use true for deep dives, deal/customer context, objections, risks, next steps, or qualitative analysis.",
      ),
    transcriptLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_GONG_TRANSCRIPT_LIMIT)
      .optional()
      .describe(
        "Number of matching calls to load transcripts for when includeTranscripts=true (default 3, max 8).",
      ),
    transcriptMaxChars: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(MAX_TRANSCRIPT_MAX_CHARS)
      .optional()
      .describe(
        "Maximum transcript characters to return per call (default 8000, max 40000). Use the default for analysis; raise it only when the user asks for more quoted detail.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (args.users) {
      const users = await getUsers();
      return { users, total: users.length };
    } else if (args.transcript) {
      const transcript = await getCallTranscript(args.transcript);
      const transcriptText = extractTranscriptText(
        transcript,
        args.transcriptMaxChars,
      );
      return {
        callId: args.transcript,
        transcriptText,
        ...(args.rawTranscript ? { transcript } : {}),
        guidance: args.rawTranscript
          ? "Returned compact transcript text and the raw Gong transcript payload. Avoid passing the raw payload into save-analysis; preserve call IDs and short excerpts instead."
          : "Returned compact transcript text only. Use callId plus short excerpts in analysis evidence; set rawTranscript=true only for debugging or export.",
      };
    } else if (args.company) {
      const days = args.days ?? 90;
      const limit = normalizeGongCallLimit(
        args.limit ?? DEFAULT_GONG_CALL_LIMIT,
      );
      const result = await searchCalls(args.company, days, limit);
      const shouldLoadTranscripts = Boolean(args.includeTranscripts);
      const transcriptLimit = normalizeBoundedInt(
        args.transcriptLimit,
        DEFAULT_GONG_TRANSCRIPT_LIMIT,
        1,
        MAX_GONG_TRANSCRIPT_LIMIT,
      );
      const transcriptMaxChars = normalizeBoundedInt(
        args.transcriptMaxChars,
        DEFAULT_TRANSCRIPT_MAX_CHARS,
        1_000,
        MAX_TRANSCRIPT_MAX_CHARS,
      );
      const transcripts = shouldLoadTranscripts
        ? await loadTranscriptEvidence(
            result.calls,
            transcriptLimit,
            transcriptMaxChars,
          )
        : undefined;

      return {
        ...result,
        total: result.calls.length,
        ...(transcripts ? { transcripts } : {}),
        guidance: [
          callLimitGuidance(result.limit, result.truncated),
          shouldLoadTranscripts
            ? `Loaded transcript excerpts for ${transcripts?.length ?? 0} matching call(s). Ground qualitative claims in the transcript text and cite the inspected call count.`
            : "For deep-dive or qualitative analysis, call this action again with includeTranscripts=true before drawing conclusions from call content.",
        ].join(" "),
      };
    } else {
      const days = args.days ?? 30;
      const limit = normalizeGongCallLimit(
        args.limit ?? DEFAULT_GONG_CALL_LIMIT,
      );
      const fromDateTime = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      const result = await getCalls({ fromDateTime });
      const limited = limitGongCalls(result.calls, limit);
      const shouldLoadTranscripts = Boolean(args.includeTranscripts);
      const transcriptLimit = normalizeBoundedInt(
        args.transcriptLimit,
        DEFAULT_GONG_TRANSCRIPT_LIMIT,
        1,
        MAX_GONG_TRANSCRIPT_LIMIT,
      );
      const transcriptMaxChars = normalizeBoundedInt(
        args.transcriptMaxChars,
        DEFAULT_TRANSCRIPT_MAX_CHARS,
        1_000,
        MAX_TRANSCRIPT_MAX_CHARS,
      );
      const transcripts = shouldLoadTranscripts
        ? await loadTranscriptEvidence(
            limited.calls,
            transcriptLimit,
            transcriptMaxChars,
          )
        : undefined;

      return {
        ...limited,
        total: limited.calls.length,
        ...(transcripts ? { transcripts } : {}),
        guidance: [
          callLimitGuidance(limited.limit, limited.truncated),
          shouldLoadTranscripts
            ? `Loaded transcript excerpts for ${transcripts?.length ?? 0} call(s). Ground qualitative claims in the transcript text and cite the inspected call count.`
            : "For deep-dive or qualitative analysis, call this action again with includeTranscripts=true before drawing conclusions from call content.",
        ].join(" "),
      };
    }
  },
});
