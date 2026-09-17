import { accessFilter } from "@agent-native/core/sharing";
import { and, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { parseJson } from "./brain.js";

export type SourceTrustTier = "blessed" | "standard" | "untrusted";
export type SourceConflictBehavior =
  | "prefer-higher-authority"
  | "surface-conflicts"
  | "require-review";

export interface SourceAnswerPolicy {
  trustTier: SourceTrustTier;
  answerEligible: boolean;
  authority: number;
  freshnessWindowDays: number | null;
  reviewRequired: boolean;
  conflictBehavior: SourceConflictBehavior;
}

export interface SourcePolicySnapshot extends SourceAnswerPolicy {
  sourceId: string;
  provider: string;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export interface EvaluatedSourceAnswerPolicy extends SourceAnswerPolicy {
  sourceIds: string[];
  eligible: boolean;
  freshness: "fresh" | "stale" | "not-configured";
  exclusionReasons: Array<"answer-ineligible" | "stale" | "review-required">;
}

export const DEFAULT_SOURCE_ANSWER_POLICY: SourceAnswerPolicy = {
  trustTier: "standard",
  answerEligible: true,
  authority: 50,
  freshnessWindowDays: null,
  reviewRequired: false,
  conflictBehavior: "prefer-higher-authority",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTrustTier(value: unknown): value is SourceTrustTier {
  return ["blessed", "standard", "untrusted"].includes(String(value));
}

function isConflictBehavior(value: unknown): value is SourceConflictBehavior {
  return [
    "prefer-higher-authority",
    "surface-conflicts",
    "require-review",
  ].includes(String(value));
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function normalizeSourceAnswerPolicy(
  value: unknown,
  base: SourceAnswerPolicy = DEFAULT_SOURCE_ANSWER_POLICY,
): SourceAnswerPolicy {
  if (!isRecord(value)) return { ...base };
  const trustTier = isTrustTier(value.trustTier)
    ? value.trustTier
    : base.trustTier;
  const tierChanged =
    isTrustTier(value.trustTier) && trustTier !== base.trustTier;
  const answerEligible =
    typeof value.answerEligible === "boolean"
      ? value.answerEligible
      : tierChanged
        ? trustTier !== "untrusted"
        : base.answerEligible;
  const reviewRequired =
    typeof value.reviewRequired === "boolean"
      ? value.reviewRequired
      : tierChanged
        ? trustTier === "untrusted"
        : base.reviewRequired;
  const freshnessWindowDays =
    value.freshnessWindowDays === null
      ? null
      : value.freshnessWindowDays === undefined
        ? base.freshnessWindowDays
        : boundedInteger(value.freshnessWindowDays, 0, 0, 3650);

  return {
    trustTier,
    answerEligible,
    authority: boundedInteger(value.authority, base.authority, 0, 100),
    freshnessWindowDays,
    reviewRequired,
    conflictBehavior: isConflictBehavior(value.conflictBehavior)
      ? value.conflictBehavior
      : base.conflictBehavior,
  };
}

export function sourceAnswerPolicyFromConfig(
  config: Record<string, unknown>,
): SourceAnswerPolicy {
  return normalizeSourceAnswerPolicy(config.answerPolicy);
}

export function withSourceAnswerPolicy(
  config: Record<string, unknown>,
  input: unknown,
): Record<string, unknown> {
  const current = sourceAnswerPolicyFromConfig(config);
  return {
    ...config,
    answerPolicy: normalizeSourceAnswerPolicy(input, current),
  };
}

export async function loadAccessibleSourcePolicySnapshots(
  sourceIds: string[],
): Promise<Map<string, SourcePolicySnapshot>> {
  const ids = Array.from(new Set(sourceIds.filter(Boolean)));
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select()
    .from(schema.brainSources)
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        inArray(schema.brainSources.id, ids),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        sourceId: row.id,
        provider: row.provider,
        lastSyncedAt: row.lastSyncedAt,
        updatedAt: row.updatedAt,
        ...sourceAnswerPolicyFromConfig(
          parseJson<Record<string, unknown>>(row.configJson, {}),
        ),
      },
    ]),
  );
}

const TRUST_RANK: Record<SourceTrustTier, number> = {
  blessed: 3,
  standard: 2,
  untrusted: 1,
};

function primaryPolicy(policies: SourcePolicySnapshot[]): SourceAnswerPolicy {
  const [primary] = [...policies].sort(
    (left, right) =>
      TRUST_RANK[right.trustTier] - TRUST_RANK[left.trustTier] ||
      right.authority - left.authority,
  );
  return primary ?? DEFAULT_SOURCE_ANSWER_POLICY;
}

export function evaluateSourceAnswerPolicy(args: {
  sourceIds: string[];
  sourcePolicies: Map<string, SourcePolicySnapshot>;
  contentUpdatedAt: string;
  resultType: "knowledge" | "capture";
  reviewed?: boolean;
  now?: Date;
}): EvaluatedSourceAnswerPolicy {
  const sourceIds = Array.from(new Set(args.sourceIds.filter(Boolean)));
  const effectivePolicies = sourceIds.length
    ? sourceIds.map(
        (id) =>
          args.sourcePolicies.get(id) ?? {
            sourceId: id,
            provider: "legacy",
            lastSyncedAt: null,
            updatedAt: args.contentUpdatedAt,
            ...DEFAULT_SOURCE_ANSWER_POLICY,
          },
      )
    : [
        {
          sourceId: "",
          provider: "legacy",
          lastSyncedAt: null,
          updatedAt: args.contentUpdatedAt,
          ...DEFAULT_SOURCE_ANSWER_POLICY,
        },
      ];
  const primary = primaryPolicy(effectivePolicies);
  const now = (args.now ?? new Date()).getTime();
  const updatedAt = Date.parse(args.contentUpdatedAt);
  const stale = effectivePolicies.some((policy) => {
    if (policy.freshnessWindowDays === null) return false;
    if (!Number.isFinite(updatedAt)) return true;
    return now - updatedAt > policy.freshnessWindowDays * 24 * 60 * 60 * 1000;
  });
  const answerIneligible = effectivePolicies.some(
    (policy) => !policy.answerEligible,
  );
  const missingRequiredReview =
    !args.reviewed &&
    effectivePolicies.some(
      (policy) =>
        policy.reviewRequired || policy.conflictBehavior === "require-review",
    );
  const exclusionReasons: EvaluatedSourceAnswerPolicy["exclusionReasons"] = [];
  if (answerIneligible) exclusionReasons.push("answer-ineligible");
  if (stale) exclusionReasons.push("stale");
  if (missingRequiredReview) exclusionReasons.push("review-required");

  return {
    ...primary,
    sourceIds,
    reviewRequired: effectivePolicies.some((policy) => policy.reviewRequired),
    freshnessWindowDays: effectivePolicies.reduce<number | null>(
      (minimum, policy) => {
        if (policy.freshnessWindowDays === null) return minimum;
        return minimum === null
          ? policy.freshnessWindowDays
          : Math.min(minimum, policy.freshnessWindowDays);
      },
      null,
    ),
    eligible: exclusionReasons.length === 0,
    freshness: effectivePolicies.every(
      (policy) => policy.freshnessWindowDays === null,
    )
      ? "not-configured"
      : stale
        ? "stale"
        : "fresh",
    exclusionReasons,
  };
}

export function compareEvaluatedSourcePolicies(
  left: EvaluatedSourceAnswerPolicy,
  right: EvaluatedSourceAnswerPolicy,
) {
  return (
    TRUST_RANK[right.trustTier] - TRUST_RANK[left.trustTier] ||
    right.authority - left.authority
  );
}
