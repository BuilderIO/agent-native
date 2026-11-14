import {
  defineAction,
  resolveToolMaxResultChars,
} from "@agent-native/core/action";
import { z } from "zod";

import {
  type FitPlan,
  type FitStep,
  fitResult,
} from "../server/lib/fit-result";
import {
  getAllCalls,
  getCalls,
  getCallTranscript,
  getCallTranscripts,
  getUsers,
  type GongCall,
  type GongUser,
  searchCalls,
} from "../server/lib/gong";
import {
  DEFAULT_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
} from "../server/lib/gong-limits";
import { cliBoolean } from "./schema-helpers";

const GONG_MAX_RESULT_CHARS = 100_000;
const DEFAULT_GONG_TRANSCRIPT_LIMIT = 3;
const MAX_GONG_TRANSCRIPT_LIMIT = 50;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 8_000;
const MAX_TRANSCRIPT_MAX_CHARS = 100_000;
const MAX_AGGREGATE_TRANSCRIPT_CHARS = 40_000;
const DEFAULT_TRANSCRIPT_SCAN_LIMIT = 50;
const MAX_TRANSCRIPT_SCAN_LIMIT = 200;
const DEFAULT_TRANSCRIPT_SEARCH_MAX_CHARS = MAX_TRANSCRIPT_MAX_CHARS;
const TRANSCRIPT_BATCH_SIZE = 20;
const TRANSCRIPT_BATCH_CONCURRENCY = 3;
const MAX_TRANSCRIPT_MATCHES_PER_CALL = 5;
const MATCH_SNIPPET_RADIUS = 240;

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

interface TranscriptSearchMatch {
  callId: string;
  title?: string;
  started?: string;
  url?: string;
  matchCount: number;
  snippets: string[];
  transcriptTruncated: boolean;
  sentenceCount: number;
}

interface TranscriptSearchError {
  callId: string;
  title?: string;
  started?: string;
  error: string;
}

function callLimitGuidance(limit: number, truncated: boolean): string {
  return truncated
    ? `Coverage is incomplete: returned the ${limit} most recent matching calls and more Gong pages remain. Do not increase the limit or page this action for broad or exhaustive analysis. Switch to tracker staging with provider-api-request plus query-staged-dataset or a Data Program, or use provider-corpus-job when raw transcript bodies are required.`
    : `Returned ${limit} or fewer matching calls. Answer from these calls; expand limit if broader coverage is needed.`;
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

function boundedTranscriptExcerptChars(
  requestedChars: number,
  transcriptCount: number,
): number {
  if (transcriptCount <= 0) return requestedChars;
  return Math.min(
    requestedChars,
    Math.max(500, Math.floor(MAX_AGGREGATE_TRANSCRIPT_CHARS / transcriptCount)),
  );
}

// What can still be trimmed from a result that is over the size cap. Steps
// run in this order: transcript excerpt text, search-match snippets (shortened
// around the matched phrase), then the lowest-ranked matches.
interface FitState {
  transcripts?: TranscriptEvidence[];
  matches?: TranscriptSearchMatch[];
  matchesTrimmed: number;
}

const MIN_SNIPPET_CHARS = 100;
const FIT_MARGIN_CHARS = 1_000;

function snippetWindow(snippet: string, query: string, maxChars: number) {
  if (snippet.length <= maxChars) return snippet;
  const hit = snippet.toLowerCase().indexOf(query.toLowerCase());
  const center = hit < 0 ? 0 : hit + query.length / 2;
  const start = Math.max(
    0,
    Math.min(snippet.length - maxChars, Math.floor(center - maxChars / 2)),
  );
  const end = start + maxChars;
  return `${start > 0 ? "..." : ""}${snippet.slice(start, end)}${end < snippet.length ? "..." : ""}`;
}

// Serialized cost is what must shrink (JSON escapes make newline-heavy text
// cost double), so each step cuts the fraction of it that is over the cap.
const trimTranscriptText: FitStep<FitState> = (fit, { overage }) => {
  const rows = fit.transcripts;
  const textChars =
    rows?.reduce((total, row) => total + JSON.stringify(row.text).length, 0) ??
    0;
  if (!rows || textChars === 0) return fit;
  const keep = Math.max(
    0,
    (textChars - overage - FIT_MARGIN_CHARS) / textChars,
  );
  return {
    ...fit,
    transcripts: rows.map((row) => {
      const text = row.text.slice(0, Math.floor(row.text.length * keep));
      return text.length < row.text.length
        ? { ...row, text, truncated: true }
        : row;
    }),
  };
};

const shortenSnippets =
  (query: string): FitStep<FitState> =>
  (fit, { overage }) => {
    const matches = fit.matches;
    const snippetChars =
      matches?.reduce(
        (total, match) =>
          total +
          match.snippets.reduce((n, s) => n + JSON.stringify(s).length, 0),
        0,
      ) ?? 0;
    if (!matches || snippetChars === 0) return fit;
    const keep = Math.max(
      0,
      (snippetChars - overage - FIT_MARGIN_CHARS) / snippetChars,
    );
    const floor = Math.max(MIN_SNIPPET_CHARS, query.length + 40);
    return {
      ...fit,
      matches: matches.map((match) => ({
        ...match,
        snippets: match.snippets.map((snippet) =>
          snippetWindow(
            snippet,
            query,
            Math.max(floor, Math.floor(snippet.length * keep)),
          ),
        ),
      })),
    };
  };

// Keep the best-ranked matches (most hits first), in call order.
const dropLowestRankedMatches: FitStep<FitState> = (fit, { fits }) => {
  const matches = fit.matches;
  if (!matches?.length) return fit;
  const ranked = matches
    .map((match, index) => ({ match, index }))
    .sort(
      (a, b) => b.match.matchCount - a.match.matchCount || a.index - b.index,
    );
  const withTop = (count: number): FitState => ({
    ...fit,
    matches: ranked
      .slice(0, count)
      .sort((a, b) => a.index - b.index)
      .map(({ match }) => match),
    matchesTrimmed: matches.length - count,
  });
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(withTop(mid))) low = mid;
    else high = mid - 1;
  }
  return withTop(low);
};

interface SingleTranscriptFit {
  text: TranscriptExtraction;
  raw: unknown;
  rawOmitted: boolean;
}

// The raw payload goes first (it is only for debugging and export), then the
// compact text.
const dropRawTranscriptPayload: FitStep<SingleTranscriptFit> = (fit) =>
  fit.raw === undefined ? fit : { ...fit, raw: undefined, rawOmitted: true };

// `transcriptText` and its `transcript` alias both carry the trimmed text, so
// every character cut from it shrinks the result twice.
const SINGLE_TRANSCRIPT_TEXT_COPIES = 2;

const trimSingleTranscriptText: FitStep<SingleTranscriptFit> = (
  fit,
  { overage },
) => {
  const textChars = JSON.stringify(fit.text.text).length;
  if (textChars === 0) return fit;
  const keep = Math.max(
    0,
    (textChars - overage / SINGLE_TRANSCRIPT_TEXT_COPIES - FIT_MARGIN_CHARS) /
      textChars,
  );
  const text = fit.text.text.slice(0, Math.floor(fit.text.text.length * keep));
  return text.length < fit.text.text.length
    ? { ...fit, text: { ...fit.text, text, truncated: true } }
    : fit;
};

// A workspace can have thousands of users. Nested profile objects go first,
// then everything but the identity fields, then users from the end of the list.
const CORE_USER_FIELDS = [
  "id",
  "emailAddress",
  "firstName",
  "lastName",
  "title",
  "active",
  "managerId",
];

interface UsersFit {
  fields: "all" | "scalar" | "core";
  keep: number;
}

const usersWithFields = (users: GongUser[], fields: UsersFit["fields"]) =>
  fields === "all"
    ? users
    : users.map((user) =>
        Object.fromEntries(
          Object.entries(user).filter(([key, value]) =>
            fields === "core"
              ? CORE_USER_FIELDS.includes(key)
              : value === null || typeof value !== "object",
          ),
        ),
      );

function planUsers(users: GongUser[]): FitPlan {
  const narrowTo =
    (fields: UsersFit["fields"]): FitStep<UsersFit> =>
    (fit) => ({ ...fit, fields });
  const dropTrailingUsers: FitStep<UsersFit> = (fit, { fits }) => {
    let low = 0;
    let high = fit.keep;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits({ ...fit, keep: mid })) low = mid;
      else high = mid - 1;
    }
    return { ...fit, keep: low };
  };
  return {
    initial: { fields: "all", keep: users.length } satisfies UsersFit,
    build: (fit: UsersFit) => {
      const usersTrimmed = users.length - fit.keep;
      return {
        users: usersWithFields(users, fit.fields).slice(0, fit.keep),
        total: users.length,
        ...(usersTrimmed > 0 ? { usersTrimmed } : {}),
        ...(fit.fields !== "all" ? { userFieldsTrimmed: fit.fields } : {}),
        ...(usersTrimmed > 0 || fit.fields !== "all"
          ? {
              guidance: [
                fit.fields !== "all"
                  ? `User records were reduced to ${fit.fields === "core" ? CORE_USER_FIELDS.join(", ") : "their scalar fields"} to fit the output size budget.`
                  : "",
                usersTrimmed > 0
                  ? `${usersTrimmed} of ${users.length} user(s) were dropped from the end of the list (usersTrimmed); total is the true count. Look up the specific people you need through provider-api-request with provider = gong instead of listing the workspace.`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
      };
    },
    steps: [narrowTo("scalar"), narrowTo("core"), dropTrailingUsers],
    summarize: () => ({ total: users.length }),
    guidance:
      "The user list does not fit the output size budget. Look up the specific users you need through provider-api-request with provider = gong; do not treat this as an empty list.",
  };
}

function matchesTrimmedGuidance(matchesTrimmed: number): string {
  return matchesTrimmed > 0
    ? `The transcript match list is incomplete: ${matchesTrimmed} lower-ranked matching call(s) were dropped to fit the output size budget (matchingCalls is the true count). Narrow the window or query to see them.`
    : "";
}

const RESULT_TOO_LARGE_GUIDANCE =
  "The call records alone exceed the output size budget. Narrow the date range or lower the limit and retry; do not treat this as an empty result.";

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

function normalizeTranscriptQuery(query: string | undefined): string {
  return typeof query === "string" ? query.replace(/\s+/g, " ").trim() : "";
}

function countMatches(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  while ((index = lowerHaystack.indexOf(lowerNeedle, index)) >= 0) {
    count += 1;
    index += Math.max(1, lowerNeedle.length);
  }
  return count;
}

function snippetsForQuery(text: string, query: string): string[] {
  if (!query) return [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const snippets: string[] = [];
  let index = 0;

  while (
    snippets.length < MAX_TRANSCRIPT_MATCHES_PER_CALL &&
    (index = lowerText.indexOf(lowerQuery, index)) >= 0
  ) {
    const start = Math.max(0, index - MATCH_SNIPPET_RADIUS);
    const end = Math.min(
      text.length,
      index + query.length + MATCH_SNIPPET_RADIUS,
    );
    const prefix = start > 0 ? "..." : "";
    const suffix = end < text.length ? "..." : "";
    snippets.push(
      `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`,
    );
    index += Math.max(1, lowerQuery.length);
  }

  return snippets;
}

function chunkCalls(calls: GongCall[], size: number): GongCall[][] {
  const chunks: GongCall[][] = [];
  for (let i = 0; i < calls.length; i += size) {
    chunks.push(calls.slice(i, i + size));
  }
  return chunks;
}

function transcriptRowsByCallId(payload: unknown): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  const record = asRecord(payload);
  const callTranscripts = record?.callTranscripts;
  if (Array.isArray(callTranscripts)) {
    for (const row of callTranscripts) {
      const rowRecord = asRecord(row);
      const callId = stringValue(rowRecord?.callId);
      if (callId) rows.set(callId, row);
    }
  }
  return rows;
}

async function fetchTranscriptBatch(
  calls: GongCall[],
  signal?: AbortSignal,
): Promise<{
  payloads: Map<string, unknown>;
  errors: TranscriptSearchError[];
}> {
  try {
    const payload = signal
      ? await getCallTranscripts(
          calls.map((call) => call.id),
          { signal },
        )
      : await getCallTranscripts(calls.map((call) => call.id));
    const payloads = transcriptRowsByCallId(payload);
    const errors: TranscriptSearchError[] = [];
    for (const call of calls) {
      if (!payloads.has(call.id)) {
        errors.push({
          callId: call.id,
          title: call.title,
          started: call.started,
          error: "Gong did not return a transcript for this call.",
        });
      }
    }
    return { payloads, errors };
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      payloads: new Map(),
      errors: calls.map((call) => ({
        callId: call.id,
        title: call.title,
        started: call.started,
        error: err instanceof Error ? err.message : String(err),
      })),
    };
  }
}

async function fetchTranscriptBatches(
  calls: GongCall[],
  signal?: AbortSignal,
): Promise<
  Array<{
    calls: GongCall[];
    result: Awaited<ReturnType<typeof fetchTranscriptBatch>>;
  }>
> {
  const batches = chunkCalls(calls, TRANSCRIPT_BATCH_SIZE);
  const results: Array<{
    calls: GongCall[];
    result: Awaited<ReturnType<typeof fetchTranscriptBatch>>;
  }> = [];
  for (
    let index = 0;
    index < batches.length;
    index += TRANSCRIPT_BATCH_CONCURRENCY
  ) {
    results.push(
      ...(await Promise.all(
        batches
          .slice(index, index + TRANSCRIPT_BATCH_CONCURRENCY)
          .map(async (batch) => ({
            calls: batch,
            result: await fetchTranscriptBatch(batch, signal),
          })),
      )),
    );
  }
  return results;
}

async function searchTranscriptEvidence(
  calls: GongCall[],
  query: string,
  scanLimit: number,
  maxChars: number,
  signal?: AbortSignal,
): Promise<{
  inspectedCalls: number;
  matches: TranscriptSearchMatch[];
  errors: TranscriptSearchError[];
  truncatedTranscripts: number;
}> {
  const matches: TranscriptSearchMatch[] = [];
  const errors: TranscriptSearchError[] = [];
  let truncatedTranscripts = 0;
  const callsToScan = calls.slice(0, scanLimit);

  for (const {
    calls: batch,
    result: batchResult,
  } of await fetchTranscriptBatches(callsToScan, signal)) {
    errors.push(...batchResult.errors);

    for (const call of batch) {
      const transcript = batchResult.payloads.get(call.id);
      if (!transcript) continue;
      const extracted = extractTranscriptText(transcript, maxChars);
      if (extracted.truncated) truncatedTranscripts += 1;
      const matchCount = countMatches(extracted.text, query);
      if (matchCount > 0) {
        matches.push({
          callId: call.id,
          title: call.title,
          started: call.started,
          url: typeof call.url === "string" ? call.url : undefined,
          matchCount,
          snippets: snippetsForQuery(extracted.text, query),
          transcriptTruncated: extracted.truncated,
          sentenceCount: extracted.sentenceCount,
        });
      }
    }
  }

  return {
    inspectedCalls: callsToScan.length,
    matches,
    errors,
    truncatedTranscripts,
  };
}

export function extractTranscriptText(
  transcript: unknown,
  maxChars = DEFAULT_TRANSCRIPT_MAX_CHARS,
): TranscriptExtraction {
  const limit = normalizeBoundedInt(
    maxChars,
    DEFAULT_TRANSCRIPT_MAX_CHARS,
    500,
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
  signal?: AbortSignal,
): Promise<TranscriptEvidence[]> {
  const evidence: TranscriptEvidence[] = [];
  const callsToLoad = calls.slice(0, limit);
  for (const {
    calls: batch,
    result: batchResult,
  } of await fetchTranscriptBatches(callsToLoad, signal)) {
    const errorByCallId = new Map(
      batchResult.errors.map((error) => [error.callId, error.error]),
    );
    for (const call of batch) {
      const transcript = batchResult.payloads.get(call.id);
      if (transcript) {
        evidence.push({
          callId: call.id,
          title: call.title,
          started: call.started,
          ...extractTranscriptText(transcript, maxChars),
        });
      } else {
        evidence.push({
          callId: call.id,
          title: call.title,
          started: call.started,
          text: "",
          sentenceCount: 0,
          truncated: false,
          error:
            errorByCallId.get(call.id) ??
            "Gong did not return a transcript for this call.",
        });
      }
    }
  }
  return evidence;
}

function normalizeGongDate(
  value: string | undefined,
  boundary: "start" | "end" = "start",
): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  const normalized = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const ms = Date.parse(dateOnly ? `${normalized}T00:00:00.000Z` : normalized);
  if (Number.isNaN(ms)) return undefined;
  const date = new Date(ms);
  if (dateOnly && boundary === "end") date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

const gongCallsSchema = z.object({
  users: cliBoolean.optional().describe("List Gong users"),
  transcript: z.string().optional().describe("Call ID to get transcript"),
  rawTranscript: cliBoolean
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
    .max(200)
    .optional()
    .describe(
      "Max calls to return (default 8). Use 5-8 for quick checks, 20-50 for thorough account analysis, 100-200 for large-scale coverage.",
    ),
  includeTranscripts: cliBoolean
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
      "Matching calls to load transcripts for when includeTranscripts=true (default 3). Use 3-5 for a first pass, 10-20+ for thorough account analysis.",
    ),
  transcriptMaxChars: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(MAX_TRANSCRIPT_MAX_CHARS)
    .optional()
    .describe(
      "Max transcript characters per call (default 8000). Batched results also share a 40000-character aggregate excerpt budget. Use the default for analysis; raise it only when the user asks for more quoted detail.",
    ),
  transcriptQuery: z
    .string()
    .optional()
    .describe(
      "Case-insensitive phrase for a local scan of matching call transcripts after batched retrieval; not Gong's server-side keyword search. Use only for bounded account-level mention questions where the matching call set is already small. Returns coverage counts and short snippets, not full transcripts.",
    ),
  transcriptScanLimit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_TRANSCRIPT_SCAN_LIMIT)
    .optional()
    .describe(
      "Max matching calls whose transcripts are fetched and searched when transcriptQuery is set (default 50). Combine with exhaustive=true and after/before for defensible bounded coverage.",
    ),
  exhaustive: cliBoolean
    .optional()
    .describe(
      "Return EVERY matching call in the window instead of stopping at `limit`. Without company, use only for a small bounded cohort of fewer than 500 records, not a broad org-wide export. Cohorts at or above 500 fail closed with staging guidance. Metadata-only unless includeTranscripts=true, which fetches transcripts in batches and returns explicit coverage. Always bound this with after/before or a small days window.",
    ),
  after: z
    .string()
    .optional()
    .describe(
      "Only include calls on/after this date (ISO yyyy-mm-dd or full timestamp), e.g. a deal's closed-won date. Overrides `days` for the window start.",
    ),
  before: z
    .string()
    .optional()
    .describe(
      "Only include calls on/before this date (ISO yyyy-mm-dd or full timestamp).",
    ),
});

type GongCallsArgs = z.infer<typeof gongCallsSchema>;

// Every branch only plans its result: raw data plus the steps that can trim it.
// `run` is the one place a result leaves the action, so every branch is held to
// the same cap.
async function planGongResult(
  args: GongCallsArgs,
  requestOptions: { signal: AbortSignal } | undefined,
): Promise<FitPlan> {
  if (args.users) {
    const users = await getUsers();
    return planUsers(users);
  } else if (args.transcript) {
    const transcript = requestOptions
      ? await getCallTranscript(args.transcript, requestOptions)
      : await getCallTranscript(args.transcript);
    const extraction = extractTranscriptText(
      transcript,
      args.transcriptMaxChars,
    );
    const rawRequested = Boolean(args.rawTranscript);
    return {
      initial: {
        text: extraction,
        raw: rawRequested ? transcript : undefined,
        rawOmitted: false,
      },
      build: (fit: SingleTranscriptFit) => ({
        callId: args.transcript,
        transcriptText: fit.text,
        transcript: fit.text,
        ...(fit.raw !== undefined ? { rawTranscriptPayload: fit.raw } : {}),
        ...(fit.rawOmitted ? { rawTranscriptOmitted: true } : {}),
        guidance: [
          rawRequested && !fit.rawOmitted
            ? "Returned compact transcript text and the raw Gong transcript payload. Avoid passing the raw payload into save-analysis; preserve call IDs and short excerpts instead."
            : "Returned compact transcript text only. Set rawTranscript=true only for debugging or export.",
          "The transcript field is a backward-compatible alias for transcriptText; read transcriptText.",
          fit.rawOmitted
            ? "The raw Gong payload was omitted (rawTranscriptOmitted) because it did not fit the output size budget."
            : "",
          fit.text.truncated
            ? "The transcript text is truncated; raise transcriptMaxChars or search it with transcriptQuery for specifics."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      }),
      steps: [dropRawTranscriptPayload, trimSingleTranscriptText],
      summarize: () => ({ callId: args.transcript }),
      guidance:
        "The transcript does not fit the output size budget. Lower transcriptMaxChars and retry; do not treat this as an empty transcript.",
    };
  } else if (args.company) {
    const days = args.days ?? 90;
    const limit = normalizeGongCallLimit(args.limit ?? DEFAULT_GONG_CALL_LIMIT);
    const exhaustive = Boolean(args.exhaustive);
    const fromDateTime = normalizeGongDate(args.after);
    const toDateTime = normalizeGongDate(args.before, "end");
    const result = await searchCalls(args.company, days, limit, {
      exhaustive,
      ...(fromDateTime ? { fromDateTime } : {}),
      ...(toDateTime ? { toDateTime } : {}),
      ...(requestOptions ?? {}),
    });
    const shouldLoadTranscripts = Boolean(args.includeTranscripts);
    const transcriptLimit = normalizeBoundedInt(
      args.transcriptLimit,
      exhaustive
        ? Math.max(1, Math.min(result.calls.length, MAX_GONG_TRANSCRIPT_LIMIT))
        : DEFAULT_GONG_TRANSCRIPT_LIMIT,
      1,
      MAX_GONG_TRANSCRIPT_LIMIT,
    );
    const transcriptQuery = normalizeTranscriptQuery(args.transcriptQuery);
    const transcriptExcerptMaxChars = normalizeBoundedInt(
      args.transcriptMaxChars,
      DEFAULT_TRANSCRIPT_MAX_CHARS,
      1_000,
      MAX_TRANSCRIPT_MAX_CHARS,
    );
    const boundedTranscriptExcerptMaxChars = boundedTranscriptExcerptChars(
      transcriptExcerptMaxChars,
      Math.min(transcriptLimit, result.calls.length),
    );
    const transcriptSearchMaxChars = normalizeBoundedInt(
      args.transcriptMaxChars,
      transcriptQuery
        ? DEFAULT_TRANSCRIPT_SEARCH_MAX_CHARS
        : DEFAULT_TRANSCRIPT_MAX_CHARS,
      1_000,
      MAX_TRANSCRIPT_MAX_CHARS,
    );
    const transcriptScanLimit = normalizeBoundedInt(
      args.transcriptScanLimit,
      DEFAULT_TRANSCRIPT_SCAN_LIMIT,
      1,
      MAX_TRANSCRIPT_SCAN_LIMIT,
    );
    const transcriptSearch = transcriptQuery
      ? await searchTranscriptEvidence(
          result.calls,
          transcriptQuery,
          transcriptScanLimit,
          transcriptSearchMaxChars,
          requestOptions?.signal,
        )
      : undefined;
    const transcripts = shouldLoadTranscripts
      ? await loadTranscriptEvidence(
          result.calls,
          transcriptLimit,
          boundedTranscriptExcerptMaxChars,
          requestOptions?.signal,
        )
      : undefined;
    const transcriptErrors =
      transcripts?.filter((transcript) => Boolean(transcript.error)) ?? [];
    const transcriptCoverageComplete = Boolean(
      transcripts &&
      transcripts.length >= result.calls.length &&
      transcriptErrors.length === 0,
    );

    // Key order is serialization order: keep call records ahead of the bulky
    // transcripts so the tool-result cap truncates transcripts, not calls.
    const { calls: resultCalls, ...resultRest } = result;
    const buildResult = (fit: FitState) => ({
      calls: resultCalls,
      ...resultRest,
      total: result.calls.length,
      ...(transcriptSearch
        ? {
            transcriptSearch: {
              query: transcriptQuery,
              matchingCalls: transcriptSearch.matches.length,
              inspectedCalls: transcriptSearch.inspectedCalls,
              availableCalls: result.calls.length,
              coverageComplete:
                !result.truncated &&
                transcriptSearch.inspectedCalls >= result.calls.length &&
                transcriptSearch.errors.length === 0 &&
                transcriptSearch.truncatedTranscripts === 0,
              scanLimited:
                transcriptSearch.inspectedCalls < result.calls.length,
              truncatedTranscripts: transcriptSearch.truncatedTranscripts,
              matches: fit.matches,
              matchesTrimmed: fit.matchesTrimmed,
              errors: transcriptSearch.errors,
            },
          }
        : {}),
      ...(transcripts
        ? {
            transcriptCoverage: {
              availableCalls: result.calls.length,
              inspectedCalls: transcripts.length,
              successfulCalls: transcripts.length - transcriptErrors.length,
              errorCount: transcriptErrors.length,
              coverageComplete: transcriptCoverageComplete,
              scanLimited: transcripts.length < result.calls.length,
            },
          }
        : {}),
      ...(fit.transcripts ? { transcripts: fit.transcripts } : {}),
      guidance: [
        transcriptSearch
          ? `Transcript search inspected ${transcriptSearch.inspectedCalls} of ${result.calls.length} matching call(s) for "${transcriptQuery}" and found ${transcriptSearch.matches.length} matching call(s). Use coverageComplete/errors before making absence claims; if coverage is incomplete, keep any retry bounded by narrowing the window, or switch broad/exhaustive work to tracker staging or provider-corpus-job.`
          : "",
        matchesTrimmedGuidance(fit.matchesTrimmed),
        exhaustive
          ? shouldLoadTranscripts
            ? `Exhaustive discovery returned all ${result.calls.length} matching call(s) in the bounded window before loading transcripts.`
            : `Exhaustive discovery: returned all ${result.calls.length} matching call(s) in the window (metadata only). Set includeTranscripts=true to fetch the bounded set in batches, or use a provider-corpus job for a broader transcript search.`
          : callLimitGuidance(result.limit, result.truncated),
        shouldLoadTranscripts
          ? `Loaded transcript excerpts for ${transcripts?.length ?? 0} of ${result.calls.length} matching call(s) in batches (${transcriptCoverageComplete ? "complete coverage" : "partial coverage"}). Ground qualitative claims in the transcript text and cite transcriptCoverage; do not fetch these calls again one at a time.`
          : exhaustive
            ? ""
            : "For deep-dive or qualitative analysis, call this action again with includeTranscripts=true before drawing conclusions from call content.",
      ]
        .filter(Boolean)
        .join(" "),
    });
    return {
      initial: {
        transcripts,
        matches: transcriptSearch?.matches,
        matchesTrimmed: 0,
      },
      build: buildResult,
      steps: [
        trimTranscriptText,
        shortenSnippets(transcriptQuery),
        dropLowestRankedMatches,
      ],
      summarize: () => ({
        total: result.calls.length,
        limit: result.limit,
        truncated: result.truncated,
      }),
      guidance: RESULT_TOO_LARGE_GUIDANCE,
    };
  } else {
    const days = args.days ?? 30;
    const limit = normalizeGongCallLimit(args.limit ?? DEFAULT_GONG_CALL_LIMIT);
    const exhaustive = Boolean(args.exhaustive);
    const fromDateTime =
      normalizeGongDate(args.after) ??
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const toDateTime = normalizeGongDate(args.before, "end");
    const result = exhaustive
      ? requestOptions
        ? await getAllCalls(
            {
              fromDateTime,
              ...(toDateTime ? { toDateTime } : {}),
            },
            requestOptions,
          )
        : await getAllCalls({
            fromDateTime,
            ...(toDateTime ? { toDateTime } : {}),
          })
      : requestOptions
        ? await getCalls(
            {
              fromDateTime,
              ...(toDateTime ? { toDateTime } : {}),
            },
            requestOptions,
          )
        : await getCalls({
            fromDateTime,
            ...(toDateTime ? { toDateTime } : {}),
          });
    const limited = limitGongCalls(result.calls, limit);
    const returnedCalls = exhaustive ? result.calls : limited.calls;
    const truncated =
      Boolean(result.cursor) || (!exhaustive && limited.truncated);
    const shouldLoadTranscripts = Boolean(args.includeTranscripts);
    const transcriptLimit = normalizeBoundedInt(
      args.transcriptLimit,
      DEFAULT_GONG_TRANSCRIPT_LIMIT,
      1,
      MAX_GONG_TRANSCRIPT_LIMIT,
    );
    const transcriptQuery = normalizeTranscriptQuery(args.transcriptQuery);
    const transcriptExcerptMaxChars = normalizeBoundedInt(
      args.transcriptMaxChars,
      DEFAULT_TRANSCRIPT_MAX_CHARS,
      1_000,
      MAX_TRANSCRIPT_MAX_CHARS,
    );
    const boundedTranscriptExcerptMaxChars = boundedTranscriptExcerptChars(
      transcriptExcerptMaxChars,
      Math.min(transcriptLimit, returnedCalls.length),
    );
    const transcriptSearchMaxChars = normalizeBoundedInt(
      args.transcriptMaxChars,
      transcriptQuery
        ? DEFAULT_TRANSCRIPT_SEARCH_MAX_CHARS
        : DEFAULT_TRANSCRIPT_MAX_CHARS,
      1_000,
      MAX_TRANSCRIPT_MAX_CHARS,
    );
    const transcriptScanLimit = normalizeBoundedInt(
      args.transcriptScanLimit,
      DEFAULT_TRANSCRIPT_SCAN_LIMIT,
      1,
      MAX_TRANSCRIPT_SCAN_LIMIT,
    );
    const transcriptSearch = transcriptQuery
      ? await searchTranscriptEvidence(
          returnedCalls,
          transcriptQuery,
          transcriptScanLimit,
          transcriptSearchMaxChars,
          requestOptions?.signal,
        )
      : undefined;
    const transcripts = shouldLoadTranscripts
      ? await loadTranscriptEvidence(
          returnedCalls,
          transcriptLimit,
          boundedTranscriptExcerptMaxChars,
          requestOptions?.signal,
        )
      : undefined;

    const buildResult = (fit: FitState) => ({
      limit: exhaustive ? returnedCalls.length : limited.limit,
      pages: "pages" in result ? result.pages : 1,
      truncated,
      coverageTruncated: truncated,
      total: returnedCalls.length,
      calls: returnedCalls,
      ...(transcriptSearch
        ? {
            transcriptSearch: {
              query: transcriptQuery,
              matchingCalls: transcriptSearch.matches.length,
              inspectedCalls: transcriptSearch.inspectedCalls,
              availableCalls: returnedCalls.length,
              coverageComplete:
                !truncated &&
                transcriptSearch.inspectedCalls >= returnedCalls.length &&
                transcriptSearch.errors.length === 0 &&
                transcriptSearch.truncatedTranscripts === 0,
              scanLimited:
                transcriptSearch.inspectedCalls < returnedCalls.length,
              truncatedTranscripts: transcriptSearch.truncatedTranscripts,
              matches: fit.matches,
              matchesTrimmed: fit.matchesTrimmed,
              errors: transcriptSearch.errors,
            },
          }
        : {}),
      ...(fit.transcripts ? { transcripts: fit.transcripts } : {}),
      guidance: [
        transcriptSearch
          ? `Transcript search inspected ${transcriptSearch.inspectedCalls} of ${returnedCalls.length} returned call(s) for "${transcriptQuery}" and found ${transcriptSearch.matches.length} matching call(s). Use coverageComplete/errors before making absence claims; if coverage is incomplete, keep any retry bounded by narrowing the window, or switch broad/exhaustive work to tracker staging or provider-corpus-job.`
          : "",
        matchesTrimmedGuidance(fit.matchesTrimmed),
        exhaustive
          ? `Exhaustive discovery returned ${returnedCalls.length} call(s) from the date window${truncated ? ", but Gong has more pages than this request covered" : ""}.`
          : callLimitGuidance(limited.limit, truncated),
        shouldLoadTranscripts
          ? `Loaded transcript excerpts for ${transcripts?.length ?? 0} call(s). Ground qualitative claims in the transcript text and cite the inspected call count.`
          : "For deep-dive or qualitative analysis, call this action again with includeTranscripts=true before drawing conclusions from call content.",
      ]
        .filter(Boolean)
        .join(" "),
    });
    return {
      initial: {
        transcripts,
        matches: transcriptSearch?.matches,
        matchesTrimmed: 0,
      },
      build: buildResult,
      steps: [
        trimTranscriptText,
        shortenSnippets(transcriptQuery),
        dropLowestRankedMatches,
      ],
      summarize: () => ({
        total: returnedCalls.length,
        limit: limited.limit,
        truncated: truncated,
      }),
      guidance: RESULT_TOO_LARGE_GUIDANCE,
    };
  }
}

export default defineAction({
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  maxResultChars: GONG_MAX_RESULT_CHARS,
  description:
    "Query bounded Gong sales-call evidence. Pass --users for the user list, --transcript for one transcript (the text is in transcriptText; transcript is a backward-compatible alias with the same trimmed text), or --company for a bounded call search; without --company, lists calls in the date window. For broad keyword, tracker, cross-account, or absence-sensitive work, stage the raw Gong API response via provider-api-catalog/provider-api-docs/provider-api-request, then use query-staged-dataset or a Data Program; use provider-corpus-job only for durable scans that require raw transcript bodies.",
  schema: gongCallsSchema,
  http: { method: "GET" },
  grounding: true,
  run: async (args, ctx) => {
    const requestOptions = ctx?.signal ? { signal: ctx.signal } : undefined;
    const resultCap =
      ctx?.maxResultChars ??
      resolveToolMaxResultChars({ maxResultChars: GONG_MAX_RESULT_CHARS });
    return fitResult({
      ...(await planGongResult(args, requestOptions)),
      cap: resultCap,
    });
  },
});
