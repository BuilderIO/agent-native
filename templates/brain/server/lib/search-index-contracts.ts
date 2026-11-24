import { z } from "zod";

export const BRAIN_SEARCH_INDEX_VERSION = "1";

const passageQuarantineSchema = z.object({
  version: z.literal(1),
  withheldPassages: z.number().int().positive().nullable(),
});

export function parseCaptureMetadata(
  raw: string | null,
): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // coercion-ok: null is unreadable metadata; callers surface unknown completeness, never zero.
    return null;
  }
}

/** `undefined`: no receipt; `null`: a receipt whose count is unknown. */
export function readWithheldPassages(
  metadata: Record<string, unknown>,
): number | null | undefined {
  const value =
    metadata.passageQuarantine !== undefined
      ? metadata.passageQuarantine
      : metadata.zoomPassageQuarantine;
  if (value === undefined) return undefined;
  const receipt = passageQuarantineSchema.safeParse(value);
  return receipt.success ? receipt.data.withheldPassages : null;
}

const OMISSION_MARKER_LINE = /(?:^|\n)[ \t]*\[…\][ \t]*(?:\r?\n|$)/;

export function withOmissionReceipt(
  metadataJson: string | null,
  content: string | null | undefined,
  kind: string,
): string | null {
  if (kind !== "transcript" || !content || !OMISSION_MARKER_LINE.test(content))
    return metadataJson;
  const metadata = parseCaptureMetadata(metadataJson);
  if (metadata === null || readWithheldPassages(metadata) !== undefined)
    return metadataJson;
  return JSON.stringify({
    ...metadata,
    passageQuarantine: { version: 1, withheldPassages: null },
  });
}

export function withheldPassageCount(
  metadata: Record<string, unknown> | null,
  provider: string,
  kind: string,
): number | null {
  if (provider !== "zoom" && kind !== "transcript") return 0;
  if (metadata === null) return null;
  const withheld = readWithheldPassages(metadata);
  return withheld === undefined ? 0 : withheld;
}

export function publicCaptureMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> {
  if (metadata === null) return {};
  const withheld = readWithheldPassages(metadata);
  if (withheld === undefined) return metadata;
  return {
    passageQuarantine: { version: 1, withheldPassages: withheld },
  };
}

export function publicCaptureExternalId(
  externalId: string | null,
  metadata: Record<string, unknown> | null,
  kind: string,
): string | null {
  if (metadata === null) return kind === "transcript" ? null : externalId;
  return readWithheldPassages(metadata) === undefined ? externalId : null;
}

export const BRAIN_SENSITIVITY_POLICY_VERSION = "2";

export const BRAIN_SENSITIVITY_CATEGORIES = [
  "performance",
  "discipline",
  "termination",
  "layoff-reorg",
  "compensation",
  "recruiting",
  "health-accommodation",
  "investigation",
  "privileged-legal",
  "secret-credential",
  "personal",
] as const;

export type BrainSensitivityCategory =
  (typeof BRAIN_SENSITIVITY_CATEGORIES)[number];

export const BRAIN_WORKSPACE_RULE_SCORE_KEY = "workspace-rule";

export type BrainSensitivityScoreKey =
  | BrainSensitivityCategory
  | typeof BRAIN_WORKSPACE_RULE_SCORE_KEY;

export type BrainSensitivityDisposition =
  | "allowed"
  | "suppressed"
  | "quarantined";

export interface BrainSafeSegment {
  id: string;
  authorKey?: string;
  capturedAt: string;
  sourceUrl?: string;
  text: string;
  reactionCount: number;
}

export interface BrainSensitivityDecision {
  disposition: BrainSensitivityDisposition;
  categories: BrainSensitivityCategory[];
  confidenceBand: "deterministic" | "high" | "medium" | "uncertain";
  policyVersion: string;
  safeSegments: BrainSafeSegment[];
  safeContent: string;
  classifier: "deterministic" | "approved-model" | "jev";
  categoryScores?: Partial<Record<BrainSensitivityScoreKey, number>>;
}

export interface BrainAudienceAssignment {
  audienceId: string;
  aclHash: string;
  kind: "org" | "slack-private-channel" | "meeting" | "restricted";
}

export interface BrainSearchStalenessKey {
  contentHash: string;
  indexVersion: string;
  sensitivityPolicyVersion: string;
  aclHash: string;
}

export type BrainIngestOperation =
  | "distill"
  | "sync"
  | "search-index"
  | "search-unindex"
  | "slack-thread-refresh";

export interface BrainCaptureInvalidation {
  captureId: string;
  sourceId: string;
  reason:
    | "content-changed"
    | "sensitivity-changed"
    | "access-changed"
    | "source-deleted"
    | "upstream-deleted";
  previous?: Partial<BrainSearchStalenessKey>;
  next?: Partial<BrainSearchStalenessKey>;
}
