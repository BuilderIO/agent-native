import { fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import {
  type CellContents,
  type CellDraft,
  type ProjectDocument,
  cellOutputSchema,
  runStatusSchema,
} from "../../app/lib/model/contracts.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { projectDocumentWithLayoutSchema } from "../../shared/project-document.js";
import { getDb, schema } from "../db/index.js";
import { getOrganizationBigQueryCredentialReadiness } from "../lib/org-bigquery-credentials.js";
import { isBuiltinSampleConnection } from "../model/data-connection-dto.js";
import {
  connectionContext,
  readDataConnection,
} from "../model/data-connections.js";
import { ensureAnalyticsDatabase } from "../model/database.js";
import {
  getAuthorizedProjectRow,
  getReadableProjectRow,
  ProjectAccessError,
  type ProjectRow,
} from "../model/project-access.js";
import {
  canEditProject,
  canManageProject,
  type ProjectAccessLevel,
  projectAccessLevel,
} from "../model/project-grant-access.js";
import {
  ensureWorkingProjectDraft,
  getReadableProjectDocument,
} from "../model/projects-store.js";
import { requireCurrentWorkspace } from "./workspace-access.js";

/**
 * Shared request plumbing for the project actions.
 *
 * Every entry here starts from the signed-in request: the account and the
 * selected organisation. A project id only becomes usable after it is matched
 * against that pair, so a guessed project from another account or another
 * organisation is indistinguishable from one that does not exist.
 */
export type ProjectScope = { ownerEmail: string; orgId: string };

type CellRow = typeof schema.cells.$inferSelect;

export type AuthorizedProject = {
  scope: ProjectScope;
  project: ProjectRow;
};

/** The output a cell currently shows, as returned to the notebook. */
export const cellOutputRecordSchema = z.object({
  cellId: z.string().min(1),
  status: runStatusSchema,
  output: cellOutputSchema.nullable(),
  ranAt: z.string(),
  sourceConnectionId: z.string().nullable().optional(),
  connectionProvenanceRecorded: z.boolean().optional(),
});

export const projectDocumentResultSchema = z.object({
  project: projectDocumentWithLayoutSchema,
});

function projectNotFound(): never {
  return fail("That project is not in this workspace.", {
    statusCode: 404,
    errorCode: "project_not_found",
  });
}

function cellNotFound(): never {
  return fail("That cell is not in this project.", {
    statusCode: 404,
    errorCode: "cell_not_found",
  });
}

export async function requireOwnedProject(
  projectId: string,
): Promise<AuthorizedProject> {
  const { ownerEmail, orgId } = await requireCurrentWorkspace();
  const scope = { ownerEmail, orgId };
  await ensureAnalyticsDatabase();
  const project = await getAuthorizedProjectRow(scope, projectId);
  if (project === null) projectNotFound();
  return { scope, project };
}

/** Resolve ownership or a grant at the required access level. */
async function projectForAccess(
  scope: ProjectScope,
  projectId: string,
  allowed: (level: ProjectAccessLevel | null) => boolean,
) {
  await ensureAnalyticsDatabase();
  const owned = await getAuthorizedProjectRow(scope, projectId);
  if (owned !== null) return { project: owned, canEdit: true };
  const project = await getReadableProjectRow(scope, projectId).catch(
    (error) => {
      if (error instanceof ProjectAccessError) projectNotFound();
      throw error;
    },
  );
  if (project === null) projectNotFound();
  const level =
    project.orgId === scope.orgId
      ? await projectAccessLevel(scope, project)
      : "read";
  if (!allowed(level)) projectNotFound();
  return {
    project,
    canEdit: project.orgId === scope.orgId && canEditProject(level),
  };
}

export async function requireReadableProject(projectId: string) {
  const { ownerEmail, orgId } = await requireCurrentWorkspace();
  const scope = { ownerEmail, orgId };
  const access = await projectForAccess(
    scope,
    projectId,
    (level) => level !== null,
  );
  return { scope, ...access };
}

export async function requireWritableProject(
  projectId: string,
): Promise<AuthorizedProject> {
  const { ownerEmail, orgId } = await requireCurrentWorkspace();
  const scope = { ownerEmail, orgId };
  return {
    scope,
    project: await ensureWorkingProjectDraft(scope, projectId).catch(
      (error) => {
        if (error instanceof ProjectAccessError) projectNotFound();
        throw error;
      },
    ),
  };
}

/**
 * Administering a project's sharing: the owner, or a grant with manage.
 */
export async function requireManageableProject(
  projectId: string,
): Promise<AuthorizedProject> {
  const current = await requireCurrentWorkspace();
  const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
  const { project } = await projectForAccess(
    scope,
    projectId,
    canManageProject,
  );
  return { scope, project };
}

/**
 * Resolves a cell inside the authorised project's current working version.
 * A cell that only exists in a published or older version is not reachable
 * from the notebook, so callers get the same not-found answer as a missing id.
 */
export async function readWorkingCell(
  project: ProjectRow,
  cellId: string,
): Promise<CellRow> {
  const rows = await getDb()
    .select()
    .from(schema.cells)
    .where(
      and(
        eq(schema.cells.id, cellId),
        eq(schema.cells.projectId, project.id),
        eq(schema.cells.versionId, project.workingVersionId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) cellNotFound();
  return row;
}

export function notebookChangeResource({ projectId }: { projectId: string }) {
  return { resourceType: "analytics-project", resourceId: projectId };
}

export async function refreshedProjectDocument(
  scope: ProjectScope,
  projectId: string,
): Promise<ProjectDocument> {
  const result = await getReadableProjectDocument(scope, projectId);
  if (result === null) {
    fail("The project could not be read back after the write.", {
      statusCode: 500,
      errorCode: "project_readback_failed",
    });
  }
  const { notebook: _notebook, ...document } = result;
  return document;
}

export function assertValidCellConnection(
  cell: CellDraft | CellContents,
): void {
  if (
    cell.kind === "sql" &&
    cell.connectionMode === "dataframes" &&
    cell.dataConnectionId !== null
  ) {
    fail("A Dataframes cell cannot also select a warehouse connection.", {
      statusCode: 400,
      errorCode: "invalid_cell_connection",
    });
  }
}

/**
 * A SQL cell may only name a connection the same data surface would offer the
 * workspace: the connection is resolved through the app's granted connection
 * model, never by trusting the id alone. Unknown, foreign and personal
 * connections surface as that model's own typed not-found failure.
 */
export async function assertGrantedDataConnection(
  connectionId: string,
): Promise<void> {
  if (connectionId.trim() === "") {
    fail("Choose a data connection from this workspace.", {
      statusCode: 400,
      errorCode: "data_connection_invalid",
    });
  }
  // The bundled sample source is offered by the picker and answered by the query
  // runner, but it is not a workspace connection row either; without this the
  // save failed and the cell's chip snapped back to its previous connection.
  if (isBuiltinSampleConnection(connectionId)) return;
  if (connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    // The workspace BigQuery source is virtual: it is not a row in the
    // workspace connection list the row lookup reads, so it resolves through
    // the organisation's own credential readiness instead.
    const ctx = connectionContext();
    if (!ctx.orgId) {
      fail("The organization BigQuery source belongs to a workspace.", {
        statusCode: 404,
        errorCode: "data_connection_not_found",
      });
    }
    const readiness = await getOrganizationBigQueryCredentialReadiness({
      orgId: ctx.orgId,
      userEmail: ctx.userEmail,
    });
    if (readiness !== "configured") {
      fail(
        "The organization BigQuery connection needs its credential reconnected.",
        {
          statusCode: 409,
          errorCode: "data_connection_not_configured",
        },
      );
    }
    return;
  }
  await readDataConnection(connectionId);
}

export async function assertGrantedMetricConnection(
  next: CellDraft | CellContents,
  stored?: CellContents,
): Promise<void> {
  if (next.kind !== "dbt-metric" || next.dataConnectionId === null) return;
  if (
    stored?.kind === "dbt-metric" &&
    stored.dataConnectionId === next.dataConnectionId
  )
    return;
  await assertGrantedDataConnection(next.dataConnectionId);
}

/** The inherited connection, but only while it still resolves for this workspace. */
export async function grantedConnectionOrNull(
  connectionId: string | null,
): Promise<string | null> {
  if (connectionId === null) return null;
  try {
    await assertGrantedDataConnection(connectionId);
    return connectionId;
  } catch {
    return null;
  }
}

export { uniqueResultVariable } from "../../shared/notebook-cell-edits.js";

export function resultVariables(
  cells: readonly { contents: CellContents }[],
): string[] {
  const names: string[] = [];
  for (const cell of cells) {
    const contents = cell.contents;
    if ("resultVariable" in contents && contents.resultVariable !== null)
      names.push(contents.resultVariable);
  }
  return names;
}
