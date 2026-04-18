// Shared between the client and the server. Keep this small.

export const APP_NAME = "Calls";
export const BRAND_COLOR = "#111111";
export const DEFAULT_PLAYBACK_SPEED = "1.0";

export type CallStatus =
  | "uploading"
  | "processing"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "failed";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string;
  confidence?: number;
  words?: Array<{
    startMs: number;
    endMs: number;
    text: string;
    confidence?: number;
  }>;
}

export interface CallSummary {
  recap: string;
  keyPoints: Array<{ text: string; quoteMs?: number }>;
  nextSteps: Array<{
    text: string;
    owner?: string;
    dueAt?: string;
    quoteMs?: number;
  }>;
  topics: Array<{ title: string; startMs: number; endMs?: number }>;
  questions: Array<{ askedByLabel?: string; text: string; ms: number }>;
  actionItems: Array<{ text: string; owner?: string; ms?: number }>;
  sentiment?: "positive" | "neutral" | "negative";
}

export interface TrackerHit {
  id: string;
  trackerId: string;
  trackerName: string;
  trackerColor: string;
  speakerLabel: string | null;
  segmentStartMs: number;
  segmentEndMs: number;
  quote: string;
  confidence: number;
}
