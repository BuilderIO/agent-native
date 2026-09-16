import {
  deleteResourceVersionById,
  insertResourceVersion,
  type ResourceVersion,
} from "@agent-native/core/history";
import { type Resource } from "@agent-native/core/resources";

import { FACTORY_ALIGNMENT_REVISION } from "../triage/review-skill-alignment.js";
import type { FactoryAutomationConfig } from "./factory-automation-config.js";
import {
  applyAutomationConfigFrontmatter,
  normalizeUserPrompt,
  readAlignmentRevision,
  readConfigSavedAt,
  readFactoryAutomationConfig,
  readPromptVersion,
  replaceAutomationContentWithUserPrompt,
} from "./factory-automation-config.js";
import { findFactoryAutomationByResourceId } from "./factory-automation-resources.js";
import {
  readAutomationDisplayName,
  setAutomationFrontmatterField,
} from "./factory-scope.js";

export const FACTORY_AUTOMATION_RESOURCE_TYPE = "factory-automation";

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

export function snapshotContentIdentity(
  snapshot: Pick<
    FactoryAutomationSnapshot,
    "userPrompt" | "displayName" | "config"
  >,
): string {
  return JSON.stringify({
    userPrompt: snapshot.userPrompt,
    displayName: snapshot.displayName,
    config: snapshot.config,
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

export async function insertFactoryAutomationVersionIfChanged(input: {
  resourceId: string;
  orgId: string;
  userEmail: string;
  displayName: string;
  previousSnapshot: FactoryAutomationSnapshot;
  nextSnapshot: FactoryAutomationSnapshot;
  summary: string;
}): Promise<ResourceVersion | null> {
  // Compare content identity, not the full snapshot: configSavedAt is
  // rewritten on every save, so a full-snapshot comparison would treat a
  // true no-op save as a change and insert a duplicate predecessor snapshot.
  if (
    snapshotContentIdentity(input.previousSnapshot) ===
    snapshotContentIdentity(input.nextSnapshot)
  ) {
    return null;
  }
  return insertResourceVersion({
    resourceType: FACTORY_AUTOMATION_RESOURCE_TYPE,
    resourceId: input.resourceId,
    createdBy: input.userEmail,
    actorKind: "human",
    ownerEmail: input.userEmail,
    orgId: input.orgId,
    visibility: "org",
    title: input.displayName,
    summary: input.summary,
    snapshot: input.previousSnapshot,
    metadata: input.previousSnapshot.factoryId
      ? { factoryId: input.previousSnapshot.factoryId }
      : undefined,
  });
}

export function buildAutomationContentFromSnapshot(
  originalContent: string,
  automationName: string,
  factoryId: string,
  snapshot: FactoryAutomationSnapshot,
): string {
  let content = applyAutomationConfigFrontmatter(
    originalContent,
    snapshot.config,
  );
  content = replaceAutomationContentWithUserPrompt(
    content,
    snapshot.userPrompt,
    automationName,
  );
  content = setAutomationFrontmatterField(
    content,
    "promptVersion",
    String(snapshot.promptVersion),
  );
  content = setAutomationFrontmatterField(
    content,
    "alignmentRevision",
    String(FACTORY_ALIGNMENT_REVISION),
  );
  if (snapshot.configSavedAt) {
    content = setAutomationFrontmatterField(
      content,
      "configSavedAt",
      snapshot.configSavedAt,
    );
  }
  // Write unconditionally, not only when truthy: a null displayName means
  // this snapshot had no name, and the restore must clear a newer one rather
  // than silently keeping it.
  content = setAutomationFrontmatterField(
    content,
    "displayName",
    snapshot.displayName ?? "",
  );
  content = setAutomationFrontmatterField(content, "factoryId", factoryId);
  return content;
}

export type FactoryAutomationRestoreResult = {
  resource: Resource;
  promptVersion: number;
  configSavedAt: string | null;
  displayName: string | null;
};

export async function restoreFactoryAutomationSnapshot(input: {
  resource: Resource;
  automationName: string;
  factoryId: string;
  snapshot: FactoryAutomationSnapshot;
  userEmail: string;
  orgId: string;
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
  const resolvedPromptVersion = resolvePromptVersionForSnapshot(
    {
      userPrompt: input.snapshot.userPrompt,
      displayName: input.snapshot.displayName,
      config: input.snapshot.config,
    },
    previousSnapshot,
  );
  const configSavedAt = new Date().toISOString();
  const content = buildAutomationContentFromSnapshot(
    current.content,
    input.automationName,
    input.factoryId,
    { ...input.snapshot, promptVersion: resolvedPromptVersion, configSavedAt },
  );
  // Insert the predecessor snapshot before the live write commits: if the
  // live write below fails, the resource never changed and the snapshot is
  // simply an unused extra row, but if it succeeded and this insert had run
  // after it, a crash or history-insert failure here would silently discard
  // the last state before restore with no way to recover it.
  let insertedVersion: ResourceVersion | null = null;
  if (
    snapshotContentIdentity(previousSnapshot) !==
    snapshotContentIdentity(input.snapshot)
  ) {
    insertedVersion = await insertResourceVersion({
      resourceType: FACTORY_AUTOMATION_RESOURCE_TYPE,
      resourceId: current.id,
      createdBy: input.userEmail,
      actorKind: "human",
      ownerEmail: input.userEmail,
      orgId: input.orgId,
      visibility: "org",
      title: input.snapshot.displayName ?? input.automationName,
      summary: "Before restore",
      snapshot: previousSnapshot,
      metadata: { factoryId: input.factoryId },
    });
  }
  // A thrown write failure must compensate exactly like a falsy return —
  // resourcePutIfCurrent has no try/catch of its own, so a throw here would
  // otherwise skip the cleanup below and leave the inserted version orphaned.
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
    await deleteResourceVersionById(
      insertedVersion.id,
      { userEmail: input.userEmail, orgId: input.orgId },
      { bypassScope: true },
    ).catch(() => {});
  }
  if (writeError) throw writeError;
  if (!updated) {
    throw new Error(
      "Factory automation changed concurrently. Refresh and try again.",
    );
  }
  return {
    resource: updated,
    promptVersion: resolvedPromptVersion,
    configSavedAt,
    displayName: input.snapshot.displayName,
  };
}

export async function resolveFactoryAutomationForHistory(
  orgId: string,
  resourceId: string,
) {
  return findFactoryAutomationByResourceId(orgId, resourceId);
}
