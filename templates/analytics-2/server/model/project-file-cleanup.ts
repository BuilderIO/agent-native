import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  attachmentFailureToError,
  deleteAttachment,
  resolveAttachment,
} from "@agent-native/core/private-blob";
import {
  ensureTable as ensureResourcesTable,
  resourceDeleteIfCurrent,
  resourceGetByPath,
  resourceListContentByOwnersAndPrefixes,
} from "@agent-native/core/resources";

import { projectFileCleanupMessages } from "../../app/i18n/messages/project-file-cleanup.js";
import { getDb } from "../db/index.js";
import { sweepDataframeBlobs } from "./dataframe-lifecycle.js";
import {
  getAuthorizedProjectRow,
  ProjectAccessError,
} from "./project-access.js";
import {
  projectFilePrefix,
  storedProjectFileSchema,
} from "./project-file-metadata.js";
import { requireWorkspaceScope, type WorkspaceScope } from "./scope.js";

const messages = projectFileCleanupMessages.projectFileCleanup;

export async function withProjectFileGuard<T>(
  scopeInput: WorkspaceScope,
  projectId: string,
  run: () => Promise<T>,
): Promise<T> {
  const scope = requireWorkspaceScope(scopeInput);
  await ensureResourcesTable();
  // Drizzle owns the transaction so pooled Drizzle and DbExec calls share its connection.
  return getDb().transaction(async () => {
    await getDbExec().execute({
      sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
      args: [
        `analytics-2:project-files:${scope.ownerEmail}:${scope.orgId}:${projectId}`,
      ],
    });
    return run();
  });
}

export async function assertProjectFileParent(
  scope: WorkspaceScope,
  projectId: string,
) {
  if (!(await getAuthorizedProjectRow(scope, projectId))) {
    throw new ProjectAccessError();
  }
}

function prefixPattern(prefix: string) {
  return `${prefix.replace(/[!%_]/g, (value) => `!${value}`)}%`;
}

/** Caller holds the project guard until metadata and its project commit together. */
export async function purgeProjectFiles(
  scopeInput: WorkspaceScope,
  projectId: string,
) {
  const scope = requireWorkspaceScope(scopeInput);
  const prefix = projectFilePrefix(scope.orgId, projectId);
  const rows = await resourceListContentByOwnersAndPrefixes(
    [scope.ownerEmail],
    [prefix],
    { orgId: scope.orgId },
  );
  const files = rows.map((row) => {
    try {
      const metadata = storedProjectFileSchema.parse(JSON.parse(row.content));
      if (row.path !== prefix + metadata.id || row.owner !== scope.ownerEmail)
        throw new Error("Invalid file identity");
      return { row, metadata };
    } catch {
      return fail(messages.unreadable, {
        statusCode: 500,
        errorCode: "project_file_metadata_unreadable",
      });
    }
  });
  const refs = [...new Set(files.map((file) => file.metadata.ref))].sort();
  for (const ref of refs) {
    await getDbExec().execute({
      sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
      args: [
        `analytics-2:project-file-ref:${scope.ownerEmail}:${scope.orgId}:${createHash("sha256").update(ref).digest("hex")}`,
      ],
    });
  }
  let retainedSharedAttachments = 0;
  for (const { row, metadata } of files) {
    const snapshot = await resourceGetByPath(scope.ownerEmail, row.path, {
      orgId: scope.orgId,
    });
    if (
      !snapshot ||
      snapshot.id !== row.id ||
      snapshot.content !== row.content
    ) {
      fail(messages.changed, {
        statusCode: 409,
        errorCode: "project_file_cleanup_conflict",
      });
    }
    // File metadata always serializes refs with JSON.stringify; inspect only this owner's project-file namespace.
    const shared = await getDbExec().execute({
      sql: "SELECT id FROM resources WHERE owner = ? AND path LIKE ? ESCAPE '!' AND path NOT LIKE ? ESCAPE '!' AND strpos(content, ?) > 0 LIMIT 1",
      args: [
        scope.ownerEmail,
        prefixPattern(`project-files/${encodeURIComponent(scope.orgId)}/`),
        prefixPattern(prefix),
        JSON.stringify(metadata.ref),
      ],
    });
    if (shared.rows.length > 0) {
      retainedSharedAttachments += 1;
    } else {
      const deleted = await deleteAttachment(metadata.ref, scope);
      if (deleted.status !== "ok") throw attachmentFailureToError(deleted);
      if (!deleted.deleted) {
        const remaining = await resolveAttachment(metadata.ref, scope);
        if (remaining.status !== "notFound") {
          if (remaining.status !== "ok")
            throw attachmentFailureToError(remaining);
          fail(messages.unavailable, {
            statusCode: 503,
            errorCode: "project_file_storage_delete_unconfirmed",
          });
        }
      }
    }
    if (!(await resourceDeleteIfCurrent(snapshot))) {
      fail(messages.changed, {
        statusCode: 409,
        errorCode: "project_file_cleanup_conflict",
      });
    }
  }
  const remaining = await resourceListContentByOwnersAndPrefixes(
    [scope.ownerEmail],
    [prefix],
    { orgId: scope.orgId },
  );
  if (remaining.length > 0)
    fail(messages.changed, {
      statusCode: 409,
      errorCode: "project_file_cleanup_conflict",
    });
  return {
    projectId,
    status: files.length === 0 ? ("absent" as const) : ("purged" as const),
    removedFiles: files.length,
    retainedSharedAttachments,
  };
}

export async function purgeDeletedProjectFiles(
  scopeInput: WorkspaceScope,
  projectId: string,
) {
  const scope = requireWorkspaceScope(scopeInput);
  return withProjectFileGuard(scope, projectId, async () => {
    if (await getAuthorizedProjectRow(scope, projectId)) {
      fail(messages.requiresDeletedProject, {
        statusCode: 409,
        errorCode: "project_file_cleanup_requires_deleted_project",
      });
    }
    return purgeProjectFiles(scope, projectId);
  });
}

/** Finishes private dataframe cleanup left behind by a failed project delete. */
export async function purgeDeletedProjectDataframes(
  scopeInput: WorkspaceScope,
  projectId: string,
) {
  const scope = requireWorkspaceScope(scopeInput);
  if (await getAuthorizedProjectRow(scope, projectId)) {
    fail(messages.requiresDeletedProject, {
      statusCode: 409,
      errorCode: "project_file_cleanup_requires_deleted_project",
    });
  }
  return sweepDataframeBlobs(scope, projectId);
}
