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
  /** The live value of each source field when Content saved over it. */
  liveValues: Record<string, DocumentPropertyValue>;
  /** The live body's blocks hash when Content saved a body over it. */
  liveBlocksHash?: string;
}

export type BuilderCmsUnpublishedChangesRead =
  | { state: "none" }
  | { state: "pending"; changes: BuilderCmsUnpublishedChanges }
  | { state: "invalid" };

export type BuilderCmsEntryStatus =
  | "published"
  | "draft"
  | "unpublished_changes";

const REFERENCE_ID_KEY_PREFIX = "__agent_native_builder_reference_id:";

const BODY_BASELINE_KEYS = [
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_READABLE_MAP_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_LAST_UPDATED_KEY,
];

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
  return {
    state: "pending",
    changes: {
      liveValues: liveValues as Record<string, DocumentPropertyValue>,
      ...(liveBlocksHash ? { liveBlocksHash } : {}),
    },
  };
}

export function withBuilderCmsUnpublishedChanges(
  sourceValues: Record<string, DocumentPropertyValue>,
  changes: BuilderCmsUnpublishedChanges | null,
): Record<string, DocumentPropertyValue> {
  const next = { ...sourceValues };
  if (
    changes &&
    (Object.keys(changes.liveValues).length > 0 || changes.liveBlocksHash)
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
   * values, so those fields would look changed. The refresh that queued it
   * already applied the field rule to the same Builder read.
   */
  keepFields?: boolean;
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
  const next = { ...args.incoming };
  const liveValues: Record<string, DocumentPropertyValue> = {};
  for (const [key, liveValue] of Object.entries(read.changes.liveValues)) {
    const builderStillLive =
      args.keepFields ||
      !Object.prototype.hasOwnProperty.call(args.incoming, key) ||
      builderCmsStableValue(args.incoming[key]) ===
        builderCmsStableValue(liveValue);
    if (!builderStillLive) continue;
    for (const keptKey of [key, `${REFERENCE_ID_KEY_PREFIX}${key}`]) {
      if (Object.prototype.hasOwnProperty.call(existing, keptKey)) {
        next[keptKey] = existing[keptKey];
      }
    }
    liveValues[key] = liveValue;
  }
  let liveBlocksHash: string | undefined;
  if (read.changes.liveBlocksHash) {
    const incomingHash = args.incoming[BUILDER_CMS_BODY_BLOCKS_HASH_KEY];
    if (
      incomingHash === undefined ||
      incomingHash === read.changes.liveBlocksHash
    ) {
      for (const key of BODY_BASELINE_KEYS) {
        if (existing[key] !== undefined) next[key] = existing[key];
      }
      liveBlocksHash = read.changes.liveBlocksHash;
    }
  }
  return withBuilderCmsUnpublishedChanges(next, {
    liveValues,
    ...(liveBlocksHash ? { liveBlocksHash } : {}),
  });
}

/**
 * What stays unpublished after a write. An autosave adds the fields it wrote,
 * keeping the live value each one had before Content's first save over it;
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
  };
}): BuilderCmsUnpublishedChanges | null {
  if (args.effect === "publish" || args.effect === "unpublish") return null;
  const read = readBuilderCmsUnpublishedChanges(args.existing);
  const current: BuilderCmsUnpublishedChanges =
    read.state === "pending" ? read.changes : { liveValues: {} };
  const liveValues = { ...current.liveValues };
  let liveBlocksHash = current.liveBlocksHash;
  if (args.effect === "autosave") {
    const live = args.live.values;
    if (!live) {
      throw new Error(
        "Builder's live values were not recorded before this autosave, so Content cannot keep the saved changes.",
      );
    }
    for (const key of args.writtenFieldKeys) {
      if (Object.prototype.hasOwnProperty.call(liveValues, key)) continue;
      // A field the live entry lacks is recorded as null, which a refresh
      // that also lacks it reads as unchanged.
      liveValues[key] = Object.prototype.hasOwnProperty.call(live, key)
        ? live[key]
        : null;
    }
    if (args.wroteBody && !liveBlocksHash && args.live.blocksHash) {
      liveBlocksHash = args.live.blocksHash;
    }
  } else {
    for (const key of args.writtenFieldKeys) delete liveValues[key];
    if (args.wroteBody) liveBlocksHash = undefined;
  }
  return {
    liveValues,
    ...(liveBlocksHash ? { liveBlocksHash } : {}),
  };
}
