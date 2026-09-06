export const CLIPS_AI_REQUEST_KINDS = [
  "generate-metadata",
  "regenerate-title",
  "regenerate-summary",
  "regenerate-chapters",
  "remove-filler-words",
  "remove-silences",
] as const;

export type ClipsAiRequestKind = (typeof CLIPS_AI_REQUEST_KINDS)[number];

export interface ClipsAiRequestStatus {
  kind?: ClipsAiRequestKind;
  status?: "queued" | "working" | "completed" | "failed";
  message?: string | null;
  requestedAt?: string;
  updatedAt?: string;
}
