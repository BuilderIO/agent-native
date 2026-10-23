import type {
  BuilderCmsWriteEffect,
  DocumentPropertyValue,
} from "../shared/api.js";
import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LAST_UPDATED_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_READABLE_MAP_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
  BUILDER_CMS_HAS_AUTOSAVES_KEY,
  BUILDER_CMS_REFERENCE_ID_KEY_PREFIX,
  builderCmsReferenceIdKey,
} from "./_builder-cms-source-adapter.js";

/**
 * Builder keeps the unpublished changes on a published entry out of its read
 * API, so every refresh reads the live values back. Content records the live
 * value each field had when it saved unpublished changes over it; while
 * Builder still reports that live value, the saved value stays the row's
 * baseline instead of snapping back.
 */
export const BUILDER_CMS_UNPUBLISHED_CHANGES_KEY =
  "__agent_native_builder_unpublished_changes";

export interface BuilderCmsUnpublishedChanges {
  /**
   * The live value of each source field when Content last saved over it,
   * with a reference field's id under its reference-id key.
   */
  liveValues: Record<string, DocumentPropertyValue>;
  /** The live body's blocks hash when Content last saved a body over it. */
  liveBlocksHash?: string;
  /** Builder's lastUpdated when Content last saved a body over it. */
  liveLastUpdated?: number | string;
}

export type BuilderCmsUnpublishedChangesRead =
  | { state: "none" }
  | { state: "pending"; changes: BuilderCmsUnpublishedChanges }
  | { state: "invalid" };

export type BuilderCmsEntryStatus =
  | "published"
  | "draft"
  | "unpublished_changes";

const BODY_BASELINE_KEYS = [
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_READABLE_MAP_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_LAST_UPDATED_KEY,
];

function hasKey(
  record: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  return !!record && Object.prototype.hasOwnProperty.call(record, key);
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function builderCmsStableValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(builderCmsStableValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${builderCmsStableValue(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether `values` holds the same value for a source field as `expected`. A
 * reference compares by id: its stored value is a display label that two
 * references can share, and a saved row holds the reference object instead.
 */
export function builderCmsSourceFieldMatches(args: {
  key: string;
  values: Record<string, DocumentPropertyValue> | null | undefined;
  expected: Record<string, DocumentPropertyValue> | null | undefined;
}): boolean {
  const referenceKey = builderCmsReferenceIdKey(args.key);
  const compared =
    hasKey(args.values, referenceKey) || hasKey(args.expected, referenceKey)
      ? referenceKey
      : args.key;
  return (
    builderCmsStableValue(args.values?.[compared]) ===
    builderCmsStableValue(args.expected?.[compared])
  );
}

export function readBuilderCmsUnpublishedChanges(
  sourceValues: Record<string, DocumentPropertyValue> | null | undefined,
): BuilderCmsUnpublishedChangesRead {
  const raw = sourceValues?.[BUILDER_CMS_UNPUBLISHED_CHANGES_KEY];
  if (raw === undefined || raw === null) return { state: "none" };
  if (typeof raw !== "string") return { state: "invalid" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "invalid" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { state: "invalid" };
  }
  const record = parsed as Record<string, unknown>;
  const liveValues = record.liveValues;
  if (
    !liveValues ||
    typeof liveValues !== "object" ||
    Array.isArray(liveValues)
  ) {
    return { state: "invalid" };
  }
  const liveBlocksHash = record.liveBlocksHash;
  if (liveBlocksHash !== undefined && typeof liveBlocksHash !== "string") {
    return { state: "invalid" };
  }
  const liveLastUpdated = record.liveLastUpdated;
  if (
    liveLastUpdated !== undefined &&
    typeof liveLastUpdated !== "string" &&
    typeof liveLastUpdated !== "number"
  ) {
    return { state: "invalid" };
  }
  return {
    state: "pending",
    changes: {
      liveValues: liveValues as Record<string, DocumentPropertyValue>,
      ...(liveBlocksHash ? { liveBlocksHash } : {}),
      ...(liveLastUpdated !== undefined ? { liveLastUpdated } : {}),
    },
  };
}

function hasBodyRecord(changes: BuilderCmsUnpublishedChanges) {
  return !!changes.liveBlocksHash || changes.liveLastUpdated !== undefined;
}

export function withBuilderCmsUnpublishedChanges(
  sourceValues: Record<string, DocumentPropertyValue>,
  changes: BuilderCmsUnpublishedChanges | null,
): Record<string, DocumentPropertyValue> {
  const next = { ...sourceValues };
  if (
    changes &&
    (Object.keys(changes.liveValues).length > 0 || hasBodyRecord(changes))
  ) {
    next[BUILDER_CMS_UNPUBLISHED_CHANGES_KEY] = JSON.stringify(changes);
  } else {
    delete next[BUILDER_CMS_UNPUBLISHED_CHANGES_KEY];
  }
  return next;
}

/**
 * Builder's own status words for an entry, as its content list shows them.
 * Unpublished changes are Content's saves or Builder's own autosaves.
 */
export function builderCmsEntryStatus(
  sourceValues: Record<string, DocumentPropertyValue> | null | undefined,
): BuilderCmsEntryStatus | null {
  const published = sourceValues?.published;
  if (published === "draft") return "draft";
  if (published !== "published") return null;
  return readBuilderCmsUnpublishedChanges(sourceValues).state === "pending" ||
    sourceValues?.[BUILDER_CMS_HAS_AUTOSAVES_KEY] === true
    ? "unpublished_changes"
    : "published";
}

/**
 * Whether a Builder read still reports the body Content saved over. Reads
 * that project the body differently hash it differently, so an unchanged
 * lastUpdated also counts: Builder has saved nothing since.
 */
export function builderCmsBodyStillSavedOver(
  changes: BuilderCmsUnpublishedChanges,
  incoming: Record<string, DocumentPropertyValue>,
): boolean {
  if (!hasBodyRecord(changes)) return false;
  const incomingHash = incoming[BUILDER_CMS_BODY_BLOCKS_HASH_KEY];
  if (incomingHash === undefined || incomingHash === null) return true;
  if (changes.liveBlocksHash && incomingHash === changes.liveBlocksHash) {
    return true;
  }
  const recordedEpoch = epochMs(changes.liveLastUpdated);
  return (
    recordedEpoch !== null && epochMs(incoming.lastUpdated) === recordedEpoch
  );
}

/**
 * The baseline a refresh or body read should keep. A field keeps Content's
 * saved value while Builder still reports the live value it was saved over;
 * once Builder publishes, discards, or edits that field, Builder's value wins.
 * A field Builder did not return says nothing about a change, so it keeps
 * Content's value too.
 */
export function builderSourceValuesKeepingUnpublishedChanges(args: {
  incoming: Record<string, DocumentPropertyValue>;
  existing: Record<string, DocumentPropertyValue> | null | undefined;
  /**
   * A body read fills fields Builder did not return with the row's stored
   * values, so a field that equals Content's saved value says nothing.
   */
  incomingFilledFromRow?: boolean;
  /**
   * Builder's own values for the body check, when `incoming` has had the
   * stored body put back: that body's hash never matches the live one.
   */
  builderBodyValues?: Record<string, DocumentPropertyValue>;
}): Record<string, DocumentPropertyValue> {
  const read = readBuilderCmsUnpublishedChanges(args.existing);
  if (read.state === "invalid") {
    console.warn(
      "Dropping an unreadable Builder unpublished-changes record; Builder's values win.",
    );
  }
  if (read.state !== "pending" || !args.existing) {
    return withBuilderCmsUnpublishedChanges(args.incoming, null);
  }
  if (
    args.incoming.published !== "published" ||
    args.incoming[BUILDER_CMS_HAS_AUTOSAVES_KEY] === false
  ) {
    return withBuilderCmsUnpublishedChanges(args.incoming, null);
  }
  const existing = args.existing;
  const recorded = read.changes;
  const next = { ...args.incoming };
  const liveValues: Record<string, DocumentPropertyValue> = {};
  for (const key of Object.keys(recorded.liveValues)) {
    if (key.startsWith(BUILDER_CMS_REFERENCE_ID_KEY_PREFIX)) continue;
    const referenceKey = builderCmsReferenceIdKey(key);
    const builderReturned =
      hasKey(args.incoming, key) || hasKey(args.incoming, referenceKey);
    const builderStillLive =
      !builderReturned ||
      builderCmsSourceFieldMatches({
        key,
        values: args.incoming,
        expected: recorded.liveValues,
      }) ||
      (!!args.incomingFilledFromRow &&
        builderCmsSourceFieldMatches({
          key,
          values: args.incoming,
          expected: existing,
        }));
    if (!builderStillLive) continue;
    for (const keptKey of [key, referenceKey]) {
      if (hasKey(existing, keptKey)) next[keptKey] = existing[keptKey];
      if (hasKey(recorded.liveValues, keptKey)) {
        liveValues[keptKey] = recorded.liveValues[keptKey];
      }
    }
  }
  const bodyKept = builderCmsBodyStillSavedOver(
    recorded,
    args.builderBodyValues ?? args.incoming,
  );
  if (bodyKept) {
    for (const key of BODY_BASELINE_KEYS) {
      if (existing[key] !== undefined) next[key] = existing[key];
    }
  }
  return withBuilderCmsUnpublishedChanges(next, {
    liveValues,
    ...(bodyKept && recorded.liveBlocksHash
      ? { liveBlocksHash: recorded.liveBlocksHash }
      : {}),
    ...(bodyKept && recorded.liveLastUpdated !== undefined
      ? { liveLastUpdated: recorded.liveLastUpdated }
      : {}),
  });
}

/**
 * What stays unpublished after a write. An autosave records the live values
 * its own live check read for the fields it wrote, so a value Builder
 * published since an earlier save is what the next refresh compares against;
 * any other write puts its fields live, so they leave the record.
 */
export function builderCmsUnpublishedChangesAfterWrite(args: {
  existing: Record<string, DocumentPropertyValue> | null | undefined;
  effect: BuilderCmsWriteEffect;
  writtenFieldKeys: string[];
  wroteBody: boolean;
  live: {
    values: Record<string, DocumentPropertyValue> | null;
    blocksHash: string | null;
    lastUpdated: number | string | null;
  };
}): BuilderCmsUnpublishedChanges | null {
  if (args.effect === "publish" || args.effect === "unpublish") return null;
  const read = readBuilderCmsUnpublishedChanges(args.existing);
  const current: BuilderCmsUnpublishedChanges =
    read.state === "pending" ? read.changes : { liveValues: {} };
  const liveValues = { ...current.liveValues };
  let liveBlocksHash = current.liveBlocksHash;
  let liveLastUpdated = current.liveLastUpdated;
  if (args.effect === "autosave") {
    const live = args.live.values;
    if (!live) {
      // The live check blocks an autosave Builder returned no values for.
      // guard:allow-bare-error — invariant: reaching this is a bug.
      throw new Error(
        "Builder's live values were not recorded before this autosave, so Content cannot keep the saved changes.",
      );
    }
    for (const key of args.writtenFieldKeys) {
      // A field the live entry lacks is recorded as null, which a refresh
      // that also lacks it reads as unchanged.
      liveValues[key] = hasKey(live, key) ? live[key] : null;
      const referenceKey = builderCmsReferenceIdKey(key);
      if (hasKey(live, referenceKey)) {
        liveValues[referenceKey] = live[referenceKey];
      } else {
        delete liveValues[referenceKey];
      }
    }
    if (args.wroteBody) {
      liveBlocksHash = args.live.blocksHash ?? undefined;
      liveLastUpdated = args.live.lastUpdated ?? undefined;
    }
  } else {
    for (const key of args.writtenFieldKeys) {
      delete liveValues[key];
      delete liveValues[builderCmsReferenceIdKey(key)];
    }
    if (args.wroteBody) {
      liveBlocksHash = undefined;
      liveLastUpdated = undefined;
    }
  }
  return {
    liveValues,
    ...(liveBlocksHash ? { liveBlocksHash } : {}),
    ...(liveLastUpdated !== undefined ? { liveLastUpdated } : {}),
  };
}
