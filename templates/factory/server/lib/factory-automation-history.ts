import { fail } from "@agent-native/core/action";
import { isUniqueViolation } from "@agent-native/core/db";
import { type Resource } from "@agent-native/core/resources";
import { and, desc, eq, lt, max } from "drizzle-orm";

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

async function maxStoredVersion(input: {
  automationId: string;
  orgId: string;
}): Promise<number | null> {
  const [row] = await getDb()
    .select({ latest: max(factoryAutomationVersions.version) })
    .from(factoryAutomationVersions)
    .where(
      and(
        eq(factoryAutomationVersions.automationId, input.automationId),
        eq(factoryAutomationVersions.orgId, input.orgId),
      ),
    );
  return row?.latest ?? null;
}

/**
 * The version number to store the previous content under. A file's own
 * `promptVersion` is the right number until it falls behind its history: a
 * file that lost its frontmatter reads as version 0, and storing that under a
 * number the history already holds fails the whole save.
 */
export async function allocatePredecessorVersion(input: {
  automationId: string;
  orgId: string;
  fileVersion: number;
}): Promise<number> {
  const stored = await maxStoredVersion(input);
  const nextFree = stored === null ? 0 : stored + 1;
  if (input.fileVersion >= nextFree) return input.fileVersion;
  console.warn(
    `[factory-automation-history] ${input.automationId} reports promptVersion ${input.fileVersion} but versions up to ${stored} are already stored; recording its previous content as version ${nextFree}.`,
  );
  return nextFree;
}

export type PromptVersionAllocation = {
  /** The `promptVersion` the saved file carries. */
  promptVersion: number;
  /** Where the previous content is stored; null when nothing changed. */
  predecessorVersion: number | null;
};

export async function resolvePromptVersionAllocation(input: {
  automationId: string;
  orgId: string;
  next: Pick<
    FactoryAutomationSnapshot,
    "userPrompt" | "displayName" | "config"
  >;
  previous: FactoryAutomationSnapshot;
}): Promise<PromptVersionAllocation> {
  if (
    snapshotContentIdentity(input.previous) ===
    snapshotContentIdentity(input.next)
  ) {
    return {
      promptVersion: input.previous.promptVersion,
      predecessorVersion: null,
    };
  }
  const predecessorVersion = await allocatePredecessorVersion({
    automationId: input.automationId,
    orgId: input.orgId,
    fileVersion: input.previous.promptVersion,
  });
  return { promptVersion: predecessorVersion + 1, predecessorVersion };
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

export async function insertFactoryAutomationVersionRow(input: {
  automationId: string;
  factoryId: string;
  orgId: string;
  userEmail: string;
  automationName: string;
  content: string;
  summary: string;
  source: FactoryAutomationVersionSource;
  /** Pre-allocated by `resolvePromptVersionAllocation`; allocated here when omitted. */
  version?: number;
}): Promise<FactoryAutomationVersionRow> {
  const snapshot = snapshotFromAutomationResource(
    input.content,
    input.automationName,
    input.factoryId,
  );
  const version =
    input.version ??
    (await allocatePredecessorVersion({
      automationId: input.automationId,
      orgId: input.orgId,
      fileVersion: snapshot.promptVersion,
    }));
  const row: FactoryAutomationVersionRow = {
    id: createVersionId(),
    automationId: input.automationId,
    factoryId: input.factoryId,
    version,
    rawContent: input.content,
    displayName: snapshot.displayName,
    source: input.source,
    summary: input.summary,
    createdAt: new Date().toISOString(),
    createdBy: input.userEmail,
    ownerEmail: input.userEmail,
    orgId: input.orgId,
  };
  try {
    await getDb().insert(factoryAutomationVersions).values(row);
  } catch (error) {
    // Drizzle wraps the driver error, so the constraint code is on `cause`.
    if (
      isUniqueViolation(error) ||
      isUniqueViolation((error as { cause?: unknown }).cause)
    ) {
      fail(
        "Another change to this automation was saved at the same time. Refresh and try again.",
        { statusCode: 409, errorCode: "automation_version_conflict" },
      );
    }
    throw error;
  }
  return row;
}

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
  version?: number;
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
    version: input.version,
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
  const allocation = await resolvePromptVersionAllocation({
    automationId: input.automationId,
    orgId: input.orgId,
    next: restoredSnapshot,
    previous: previousSnapshot,
  });
  const resolvedVersion = allocation.promptVersion;
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
  // Versions saved before the stamp existed lack it; restoring one must not
  // take it off the live file.
  if (readFrontmatterValue(content, "triggerType") == null) {
    content = setAutomationFrontmatterField(
      content,
      "triggerType",
      readFrontmatterValue(current.content, "triggerType") ?? "schedule",
    );
  }

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
    version: allocation.predecessorVersion ?? undefined,
  });

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
