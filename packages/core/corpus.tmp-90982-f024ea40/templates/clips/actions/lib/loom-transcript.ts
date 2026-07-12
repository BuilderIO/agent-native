import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

import { normalizeLoomShareUrl } from "../../shared/loom.js";
import {
  normalizeTranscriptSegments,
  type TranscriptSegment,
} from "../../shared/transcript-segments.js";

const LOOM_TRANSCRIPT_HTML_MAX_CHARS = 2_000_000;
const LOOM_TRANSCRIPT_JSON_MAX_CHARS = 5_000_000;
const LOOM_TRANSCRIPT_SOURCE_RE = /"source_url"\s*:\s*"([^"]+)"/g;

type LoomTranscriptPhrase = {
  ts?: unknown;
  value?: unknown;
};

export type LoomTranscriptImport = {
  fullText: string;
  segments: TranscriptSegment[];
  language: string;
};

function decodeJsonStringLiteral(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  }
}

function normalizeEntityEscapedUrl(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

function parseLoomTranscriptSourceUrl(value: string): URL | null {
  try {
    const parsed = new URL(normalizeEntityEscapedUrl(value));
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "cdn.loom.com") return null;
    if (!parsed.pathname.startsWith("/mediametadata/transcription/")) {
      return null;
    }
    if (!parsed.pathname.endsWith(".json")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractLoomTranscriptSourceUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(LOOM_TRANSCRIPT_SOURCE_RE)) {
    const decoded = decodeJsonStringLiteral(match[1] ?? "");
    const parsed = parseLoomTranscriptSourceUrl(decoded);
    if (!parsed) continue;
    if (!urls.includes(parsed.href)) urls.push(parsed.href);
  }
  return urls;
}

function boundedSecondsToMs(value: unknown): number | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.max(0, Math.round(seconds * 1000));
}

function estimateSegmentDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(900, words * 420);
}

export function parseLoomTranscriptJson(
  value: unknown,
  durationMs?: number | null,
): LoomTranscriptImport | null {
  const phrases =
    value &&
    typeof value === "object" &&
    Array.isArray((value as { phrases?: unknown }).phrases)
      ? ((value as { phrases: LoomTranscriptPhrase[] }).phrases ?? [])
      : [];

  const rows = phrases
    .map((phrase) => {
      const startMs = boundedSecondsToMs(phrase?.ts);
      const text =
        typeof phrase?.value === "string"
          ? phrase.value.replace(/\s+/g, " ").trim()
          : "";
      return startMs === null || !text ? null : { startMs, text };
    })
    .filter((row): row is { startMs: number; text: string } => Boolean(row))
    .sort((a, b) => a.startMs - b.startMs);

  if (!rows.length) return null;

  const boundedDurationMs =
    typeof durationMs === "number" && Number.isFinite(durationMs)
      ? Math.max(0, Math.round(durationMs))
      : null;
  const rawSegments: TranscriptSegment[] = rows
    .map((row, index) => {
      const nextStartMs = rows[index + 1]?.startMs;
      const fallbackEndMs = row.startMs + estimateSegmentDurationMs(row.text);
      const endMs =
        nextStartMs && nextStartMs > row.startMs
          ? nextStartMs
          : boundedDurationMs && boundedDurationMs > row.startMs
            ? boundedDurationMs
            : fallbackEndMs;
      const clampedEndMs =
        boundedDurationMs && boundedDurationMs > row.startMs
          ? Math.min(endMs, boundedDurationMs)
          : endMs;
      return {
        startMs: row.startMs,
        endMs: Math.max(row.startMs + 250, clampedEndMs),
        text: row.text,
      };
    })
    .filter((segment) => segment.endMs > segment.startMs);

  const fullText = rows
    .map((row) => row.text)
    .join(" ")
    .trim();
  if (!fullText || !rawSegments.length) return null;

  return {
    fullText,
    segments: normalizeTranscriptSegments({
      segments: rawSegments,
      fullText,
      durationMs: boundedDurationMs,
    }),
    language: "en",
  };
}

async function readBoundedText(
  response: Response,
  maxChars: number,
): Promise<string> {
  const text = await response.text();
  if (text.length > maxChars) {
    throw new Error("Loom transcript response was too large to import.");
  }
  return text;
}

async function fetchText(url: string, maxChars: number): Promise<string> {
  const response = await ssrfSafeFetch(
    url,
    {
      headers: {
        Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentNativeClips/1.0; +https://agent-native.com)",
      },
      signal: AbortSignal.timeout(15_000),
    },
    { maxRedirects: 2 },
  );
  if (!response.ok) {
    throw new Error(
      `Loom transcript fetch failed (${response.status} ${response.statusText}).`,
    );
  }
  return readBoundedText(response, maxChars);
}

export async function fetchLoomTranscript({
  shareUrl,
  durationMs,
}: {
  shareUrl: string;
  durationMs?: number | null;
}): Promise<LoomTranscriptImport | null> {
  const normalizedShareUrl = normalizeLoomShareUrl(shareUrl);
  if (!normalizedShareUrl) {
    throw new Error("Invalid Loom share URL.");
  }

  const html = await fetchText(
    normalizedShareUrl,
    LOOM_TRANSCRIPT_HTML_MAX_CHARS,
  );
  const sourceUrls = extractLoomTranscriptSourceUrls(html);
  if (!sourceUrls.length) return null;

  let lastError: unknown = null;
  for (const sourceUrl of sourceUrls) {
    try {
      const transcriptText = await fetchText(
        sourceUrl,
        LOOM_TRANSCRIPT_JSON_MAX_CHARS,
      );
      const parsed = parseLoomTranscriptJson(
        JSON.parse(transcriptText),
        durationMs,
      );
      if (parsed) return parsed;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  return null;
}

export function loomTranscriptUnavailableMessage(): string {
  return "Loom transcript unavailable. Clips can import public Loom transcripts when Loom exposes one on the share page; this link did not expose an importable transcript. Retry after Loom finishes processing, or upload the original video file to use Clips transcription.";
}
