import { type Resource } from "@agent-native/core/resources";
import { and, desc, eq, lt } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { factoryAutomationVersions } from "../db/schema.js";
import { FACTORY_ALIGNMENT_REVISION } from "../triage/review-skill-alignment.js";
import type { FactoryAutomationConfig } from "./factory-automation-config.js";
import {
  normalizeUserPrompt,
  OPTIONAL_DESTINATION_FRONTMATTER_FIELDS,
  readAlignmentRevision,
  readConfigSavedAt,
  readFactoryAutomationConfig,
  readFrontmatterValue,
  readPromptVersion,
} from "./factory-automation-config.js";
import { findFactoryAutomationByResourceId } from "./factory-automation-resources.js";
import {
  readAutomationDisplayName,
  setAutomationFrontmatterField,
} from "./factory-scope.js";

export type FactoryAutomationVersionSource = "save" | "restore" | "repair";

export type FactoryAutomationSnapshot = {
  userPrompt: string;
  displayName: string | null;
  config: FactoryAutomationConfig;
  promptVersion: number;
  alignmentRevision: number;
  configSavedAt: string | null;
  factoryId?: string;
};

export function snapshotFromAutomationResource(
  content: string,
  automationName: string,
  factoryId?: string,
): FactoryAutomationSnapshot {
  return {
    userPrompt: normalizeUserPrompt(content),
    displayName: readAutomationDisplayName(content),
    config: readFactoryAutomationConfig(content, automationName),
    promptVersion: readPromptVersion(content),
    alignmentRevision: readAlignmentRevision(content),
    configSavedAt: readConfigSavedAt(content),
    factoryId,
  };
}

/**
 * `""` and `null` both mean "not set" for the optional destination fields
 * (slackChannelId, repository, sentry*), but they're different JS values.
 * A save always resends every field, including these as `""` when they're
 * unset rather than omitting them, while a freshly-read config always
 * reports `null` for an absent one (`readFactoryAutomationConfig`). Without
 * this normalization, comparing the two would see a spurious "change" on
 * every save that didn't touch these fields at all, bumping the version for
 * nothing. This intentionally only affects the comparison — the values
 * written to frontmatter (`""` clears the line, `null` leaves it alone) must
 * stay exactly as the save action already computes them.
 */
function normalizeConfigForIdentity(
  config: FactoryAutomationConfig,
): FactoryAutomationConfig {
  const normalized = { ...config };
  for (const key of OPTIONAL_DESTINATION_FRONTMATTER_FIELDS) {
    const value = normalized[key as keyof FactoryAutomationConfig];
    if (!value) {
      (normalized as Record<string, unknown>)[key] = null;
    }
  }
  return normalized;
}

export function snapshotContentIdentity(
  snapshot: Pick<
    FactoryAutomationSnapshot,
    "userPrompt" | "displayName" | "config"
  >,
): string {
  return JSON.stringify({
    userPrompt: snapshot.userPrompt,
    displayName: snapshot.displayName,
    config: normalizeConfigForIdentity(snapshot.config),
  });
}

/**
 * Restoring an old version is a new save event, not a rewind: it must always
 * advance past every version seen so far, even when the restored content is
 * byte-for-byte identical to an earlier snapshot. Reusing that snapshot's old
 * number would collide with its still-present history row and make "Version
 * N" ambiguous. Only a genuine no-op (content identical to what's already
 * current) skips the bump.
 */
export function resolvePromptVersionForSnapshot(
  next: Pick<
    FactoryAutomationSnapshot,
    "userPrompt" | "displayName" | "config"
  >,
  previous: FactoryAutomationSnapshot,
): number {
  if (snapshotContentIdentity(previous) === snapshotContentIdentity(next)) {
    return previous.promptVersion;
  }
  return previous.promptVersion + 1;
}

export type FactoryAutomationVersionRow = {
  id: string;
  automationId: string;
  factoryId: string;
  version: number;
  rawContent: string;
  displayName: string | null;
  source: FactoryAutomationVersionSource;
  summary: string;
  createdAt: string;
  createdBy: string;
  ownerEmail: string;
  orgId: string | null;
};

function createVersionId(): string {
  return `favr_${globalThis.crypto.randomUUID()}`;
}

/**
 * Insert one history row from raw content, unconditionally — the full file,
 * verbatim, not a reconstructed subset of fields. Reconstructing fields by
 * hand is what let `restoreFactoryAutomationIdentityFields` become
 * necessary in the first place (the repair pipeline silently dropped
 * displayName/slackChannelId/authorIds under some conditions); storing the
 * exact file means there's no field list left to have gaps in.
 */
export async function insertFactoryAutomationVersionRow(input: {
  automationId: string;
  factoryId: string;
  orgId: string;
  userEmail: string;
  automationName: string;
  content: string;
  summary: string;
  source: FactoryAutomationVersionSource;
}): Promise<FactoryAutomationVersionRow> {
  const snapshot = snapshotFromAutomationResource(
    input.content,
    input.automationName,
    input.factoryId,
  );
  const row: FactoryAutomationVersionRow = {
    id: createVersionId(),
    automationId: input.automationId,
    factoryId: input.factoryId,
    version: snapshot.promptVersion,
    rawContent: input.content,
    displayName: snapshot.displayName,
    source: input.source,
    summary: input.summary,
    createdAt: new Date().toISOString(),
    createdBy: input.userEmail,
    ownerEmail: input.userEmail,
    orgId: input.orgId,
  };
  await getDb().insert(factoryAutomationVersions).values(row);
  return row;
}

/**
 * Same insert, skipped when the save/restore would be a true no-op: two
 * different raw files (e.g. differing only in a rewritten configSavedAt)
 * can still represent the identical user-facing prompt/config, and that
 * case must not crowd meaningful history out of the picker. Body repair
 * uses `insertFactoryAutomationVersionRow` directly instead, because its
 * whole purpose is recording a change (deduped injected blocks) that this
 * identity check is specifically designed to ignore.
 */
export async function insertFactoryAutomationVersionIfChanged(input: {
  automationId: string;
  factoryId: string;
  orgId: string;
  userEmail: string;
  automationName: string;
  previousContent: string;
  nextContent: string;
  summary: string;
  source: FactoryAutomationVersionSource;
}): Promise<FactoryAutomationVersionRow | null> {
  const previousSnapshot = snapshotFromAutomationResource(
    input.previousContent,
    input.automationName,
    input.factoryId,
  );
  const nextSnapshot = snapshotFromAutomationResource(
    input.nextContent,
    input.automationName,
    input.factoryId,
  );
  // Compare content identity, not the full snapshot: configSavedAt is
  // rewritten on every save, so a full-snapshot comparison would treat a
  // true no-op save as a change and insert a duplicate predecessor row.
  if (
    snapshotContentIdentity(previousSnapshot) ===
    snapshotContentIdentity(nextSnapshot)
  ) {
    return null;
  }
  return insertFactoryAutomationVersionRow({
    automationId: input.automationId,
    factoryId: input.factoryId,
    orgId: input.orgId,
    userEmail: input.userEmail,
    automationName: input.automationName,
    content: input.previousContent,
    summary: input.summary,
    source: input.source,
  });
}

export async function listFactoryAutomationVersionRows(input: {
  automationId: string;
  orgId: string;
  limit: number;
  beforeVersion?: number;
}): Promise<{ rows: FactoryAutomationVersionRow[]; hasMore: boolean }> {
  const rows = await getDb()
    .select()
    .from(factoryAutomationVersions)
    .where(
      and(
        eq(factoryAutomationVersions.automationId, input.automationId),
        eq(factoryAutomationVersions.orgId, input.orgId),
        input.beforeVersion === undefined
          ? undefined
          : lt(factoryAutomationVersions.version, input.beforeVersion),
      ),
    )
    .orderBy(desc(factoryAutomationVersions.version))
    .limit(input.limit + 1);
  return {
    rows: rows.slice(0, input.limit) as FactoryAutomationVersionRow[],
    hasMore: rows.length > input.limit,
  };
}

export async function getFactoryAutomationVersionRow(input: {
  id: string;
  orgId: string;
}): Promise<FactoryAutomationVersionRow | null> {
  const row = (
    await getDb()
      .select()
      .from(factoryAutomationVersions)
      .where(
        and(
          eq(factoryAutomationVersions.id, input.id),
          eq(factoryAutomationVersions.orgId, input.orgId),
        ),
      )
      .limit(1)
  )[0];
  return (row as FactoryAutomationVersionRow) ?? null;
}

export async function deleteFactoryAutomationVersionRow(input: {
  id: string;
  orgId: string;
}): Promise<boolean> {
  const deleted = await getDb()
    .delete(factoryAutomationVersions)
    .where(
      and(
        eq(factoryAutomationVersions.id, input.id),
        eq(factoryAutomationVersions.orgId, input.orgId),
      ),
    )
    .returning({ id: factoryAutomationVersions.id });
  return deleted.length > 0;
}

/**
 * Fields the scheduler owns, not the editor: a restore rewinds prompt/config
 * content, never execution bookkeeping. Without this, restoring an old
 * version could resurrect a stale lastRun/nextRun/remote-dispatch state that
 * has nothing to do with what the user actually wanted rolled back.
 *
 * `enabled` belongs here too even though the editor sets it: it's a live
 * on/off switch the user can flip at any time, not part of the prompt/config
 * content being rolled back. Restoring an old version must not silently
 * re-enable an automation the user has since paused (or vice versa).
 */
const OPERATIONAL_FRONTMATTER_FIELDS = [
  "lastRun",
  "lastCheck",
  "lastStatus",
  "lastError",
  "nextRun",
  "remoteRequestId",
  "remoteCommandId",
  "remoteRunId",
  "remoteAutomationRunId",
  "remoteAdvanceSchedule",
  "enabled",
] as const;

function preserveOperationalFrontmatterFields(
  restoredContent: string,
  currentContent: string,
): string {
  let next = restoredContent;
  for (const key of OPERATIONAL_FRONTMATTER_FIELDS) {
    next = setAutomationFrontmatterField(
      next,
      key,
      readFrontmatterValue(currentContent, key) ?? "",
    );
  }
  return next;
}

export type FactoryAutomationRestoreResult = {
  resource: Resource;
  version: number;
  configSavedAt: string;
  displayName: string | null;
};

export async function restoreFactoryAutomationVersion(input: {
  resource: Resource;
  automationId: string;
  automationName: string;
  factoryId: string;
  historicalContent: string;
  userEmail: string;
  orgId: string;
  summary: string;
}): Promise<FactoryAutomationRestoreResult> {
  const { resourceGetByPath, resourcePutIfCurrent } =
    await import("@agent-native/core/resources");
  const current = await resourceGetByPath(
    input.resource.owner,
    input.resource.path,
  );
  if (!current) {
    throw new Error("Factory automation not found.");
  }

  const previousSnapshot = snapshotFromAutomationResource(
    current.content,
    input.automationName,
    input.factoryId,
  );
  const restoredSnapshot = snapshotFromAutomationResource(
    input.historicalContent,
    input.automationName,
    input.factoryId,
  );
  const resolvedVersion = resolvePromptVersionForSnapshot(
    restoredSnapshot,
    previousSnapshot,
  );
  const configSavedAt = new Date().toISOString();

  let content = preserveOperationalFrontmatterFields(
    input.historicalContent,
    current.content,
  );
  content = setAutomationFrontmatterField(
    content,
    "promptVersion",
    String(resolvedVersion),
  );
  content = setAutomationFrontmatterField(
    content,
    "alignmentRevision",
    String(FACTORY_ALIGNMENT_REVISION),
  );
  content = setAutomationFrontmatterField(
    content,
    "configSavedAt",
    configSavedAt,
  );
  content = setAutomationFrontmatterField(
    content,
    "factoryId",
    input.factoryId,
  );

  // Insert the predecessor's raw content before the live write commits: if
  // the write below fails, this is just an unused extra row, but the
  // reverse order could silently discard the pre-restore state if the
  // history insert then failed.
  const insertedVersion = await insertFactoryAutomationVersionIfChanged({
    automationId: input.automationId,
    factoryId: input.factoryId,
    orgId: input.orgId,
    userEmail: input.userEmail,
    automationName: input.automationName,
    previousContent: current.content,
    nextContent: content,
    summary: input.summary,
    source: "restore",
  });

  // A thrown write failure must compensate exactly like a falsy return —
  // resourcePutIfCurrent has no try/catch of its own.
  let updated: Awaited<ReturnType<typeof resourcePutIfCurrent>> = null;
  let writeError: unknown;
  try {
    updated = await resourcePutIfCurrent({
      owner: current.owner,
      path: current.path,
      content,
      mimeType: "text/markdown",
      expectedId: current.id,
      expectedUpdatedAt: current.updatedAt,
      expectedContent: current.content,
    });
  } catch (error) {
    writeError = error;
  }
  if (!updated && insertedVersion) {
    await deleteFactoryAutomationVersionRow({
      id: insertedVersion.id,
      orgId: input.orgId,
    }).catch((cleanupError) => {
      console.error(
        `[factory-automation-history] failed to remove orphaned predecessor version ${insertedVersion.id} after a failed restore write:`,
        cleanupError,
      );
    });
  }
  if (writeError) throw writeError;
  if (!updated) {
    throw new Error(
      "Factory automation changed concurrently. Refresh and try again.",
    );
  }
  return {
    resource: updated,
    version: resolvedVersion,
    configSavedAt,
    displayName: restoredSnapshot.displayName,
  };
}

export async function resolveFactoryAutomationForHistory(
  orgId: string,
  resourceId: string,
) {
  return findFactoryAutomationByResourceId(orgId, resourceId);
}
