import type { TranscriptSegment } from "../../../shared/api.js";

export interface SummaryCallInput {
  id: string;
  title: string;
  description?: string | null;
  durationMs?: number | null;
  recordedAt?: string | null;
}

export interface SummaryParticipantInput {
  speakerLabel: string;
  displayName?: string | null;
  email?: string | null;
  isInternal?: boolean | null;
}

export interface BuildSummaryPromptArgs {
  call: SummaryCallInput;
  participants: SummaryParticipantInput[];
  segments: TranscriptSegment[];
}

const MIN_WORDS = 100;

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function countWords(segments: TranscriptSegment[]): number {
  let n = 0;
  for (const seg of segments) {
    if (typeof seg.text !== "string") continue;
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    n += tokens.length;
  }
  return n;
}

function formatParticipants(list: SummaryParticipantInput[]): string {
  if (!list || list.length === 0) return "(no participants identified)";
  return list
    .map((p) => {
      const name = p.displayName?.trim();
      const email = p.email?.trim();
      const internal =
        p.isInternal === true
          ? " (internal)"
          : p.isInternal === false
            ? " (external)"
            : "";
      const who = name
        ? email
          ? `${name} <${email}>`
          : name
        : email || "unknown";
      return `- ${p.speakerLabel}: ${who}${internal}`;
    })
    .join("\n");
}

function formatSegments(segments: TranscriptSegment[]): string {
  if (!segments.length) return "(empty transcript)";
  return segments
    .map(
      (seg) =>
        `[${formatMs(seg.startMs)} ${seg.speakerLabel || "Speaker 0"}] ${seg.text}`,
    )
    .join("\n");
}

export function buildSummaryPrompt(args: BuildSummaryPromptArgs): string {
  const { call, participants, segments } = args;
  const title = call.title?.trim() || "Untitled call";
  const description = call.description?.trim();
  const totalWords = countWords(segments);
  const belowThreshold = totalWords < MIN_WORDS;

  const header = [
    `Call: ${title}`,
    call.recordedAt ? `Recorded: ${call.recordedAt}` : null,
    typeof call.durationMs === "number" && call.durationMs > 0
      ? `Duration: ${formatMs(call.durationMs)}`
      : null,
    description ? `Description: ${description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const shape = `{
  "recap": "one paragraph, <= 120 words",
  "keyPoints": [{"text": "...", "quoteMs": 12345}],
  "nextSteps": [{"text": "...", "owner": "optional name", "dueAt": "optional ISO", "quoteMs": 12345}],
  "topics": [{"title": "...", "startMs": 0, "endMs": 180000}],
  "questions": [{"askedByLabel": "Speaker 0", "text": "...?", "ms": 12345}],
  "actionItems": [{"text": "...", "owner": "optional", "ms": 12345}],
  "sentiment": "positive" | "neutral" | "negative"
}`;

  const guidance = [
    "Stay grounded in the transcript — every claim must be traceable to a specific moment.",
    "Cite exact `quoteMs` / `ms` / `startMs` values that come from the transcript timestamps below.",
    "Do not invent participants, products, companies, numbers, or commitments that are not in the transcript.",
    "Keep `recap` to at most 120 words, a single cohesive paragraph.",
    "Produce between 5 and 12 `keyPoints`.",
    "`nextSteps` must be concrete and actionable (who does what by when). Skip vague aspirations.",
    "`topics` should cover the whole call with non-overlapping time ranges, ordered by `startMs`.",
    "`questions` are literal questions asked on the call, attributed to the speaker who asked them.",
    "`actionItems` are commitments made on the call — a subset of next steps is fine.",
    "`sentiment` reflects the overall tone of the prospect/customer side of the call.",
  ];

  const shortTranscriptNote = belowThreshold
    ? `\n\nThe transcript is short (${totalWords} words, below the ${MIN_WORDS}-word threshold). Still return the full JSON shape, but use empty arrays for any section you cannot ground in the transcript. Leave \`recap\` as a one-sentence description of what was said (or the empty string if nothing substantive).`
    : "";

  return `You are summarizing a sales / customer call. Return STRICT JSON — no prose, no code fences.

${header}

Participants:
${formatParticipants(participants)}

Diarized transcript (format: [mm:ss Speaker N] text):
${formatSegments(segments)}

Output shape:
${shape}

Guidance:
${guidance.map((g) => `- ${g}`).join("\n")}${shortTranscriptNote}

Return ONLY the JSON object. No explanation.`;
}
