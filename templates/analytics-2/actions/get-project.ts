import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { withoutPendingCellEdit } from "../app/lib/model/contracts.js";
import {
  ANALYTICS_CONTROL_IDS,
  evaluateNotebookCapabilities,
  requireCapability,
} from "../server/lib/analytics-capabilities.js";
import {
  cellOutputRecordSchema,
  requireReadableProject,
} from "../server/lib/project-action-access.js";
import {
  readProjectSelectedConnections,
  selectedConnectionSchema,
} from "../server/lib/project-selected-connections.js";
import { listProjectConnectionLinks } from "../server/model/project-connection-links.js";
import {
  canEditProject,
  projectAccessLevel,
} from "../server/model/project-grant-access.js";
import { readAccessibleProjectOutputs } from "../server/model/project-output-access.js";
import {
  getProjectQueryStates,
  projectQueryStateSchema,
} from "../server/model/project-query.js";
import { recordProjectView } from "../server/model/project-views.js";
import {
  getReadableProjectDocument,
  readableProjectVersion,
} from "../server/model/projects-store.js";
import { readSeededSampleCell } from "../server/model/seed.js";
import {
  capabilityDecisionSchema,
  capabilityScopeRefSchema,
} from "../shared/capabilities.js";
import { notebookSnapshotSchema } from "../shared/notebook-operations.js";
import { projectDocumentWithLayoutSchema } from "../shared/project-document.js";

export default defineAction({
  mcpTool: true,
  description:
    "Read a project notebook and the output each of its cells currently shows. Pass only projectId to read the working notebook; omit surface, version and viewId (they are for the published app view only, which the browser sets).",
  schema: z
    .object({
      projectId: z.string().min(1),
      version: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Published version id or latest; omit to read the working notebook.",
        ),
      surface: z
        .enum(["app"])
        .optional()
        .describe("Browser-only: published app view. Agents omit this."),
      viewId: z
        .string()
        .uuid()
        .optional()
        .describe("Browser-only app view id. Agents omit this."),
    })
    .strict(),
  outputSchema: z.object({
    project: projectDocumentWithLayoutSchema,
    notebook: notebookSnapshotSchema.nullable().optional(),
    outputs: z.record(z.string(), cellOutputRecordSchema),
    queryStates: z.record(z.string(), projectQueryStateSchema),
    canEdit: z.boolean(),
    canViewSource: z.boolean().optional(),
    capabilities: z.array(capabilityDecisionSchema),
    viewer: z.object({ email: z.string(), orgId: z.string() }),
    selectedConnections: z.array(selectedConnectionSchema),
    importedConnectionIds: z.array(z.string()),
  }),
  http: { method: "GET" },
  persistInBrowser: false,
  readOnly: true,
  run: async ({ projectId, version, surface, viewId }, context) => {
    const { scope, project, canEdit } = await requireReadableProject(projectId);
    const effectiveVersion = await readableProjectVersion(
      scope,
      project,
      version,
    );
    if (surface === "app" && (version === undefined || viewId === undefined))
      fail(
        "An app view requires a published version. Call get-project with only projectId to read the notebook.",
        {
          statusCode: 400,
          errorCode: "project_version_required",
        },
      );
    const releaseDecision =
      surface === "app" && version !== undefined
        ? await requireCapability(
            ANALYTICS_CONTROL_IDS.openPublishedApp,
            capabilityScopeRefSchema.parse({
              kind: "release",
              workspaceId: scope.orgId,
              projectId: project.id,
              releaseId: version,
            }),
          )
        : undefined;
    const result = await getReadableProjectDocument(
      scope,
      project.id,
      effectiveVersion,
      surface === "app" ? "published" : undefined,
    );
    if (result === null) {
      fail("That published version is not available.", {
        statusCode: 404,
        errorCode: "project_version_not_found",
      });
    }
    const { notebook, ...document } = result;
    const selectedConnectionsPromise = readProjectSelectedConnections(document);
    const importedConnectionIdsPromise = listProjectConnectionLinks({
      orgId: project.orgId ?? scope.orgId,
      projectId: project.id,
    });
    const canRunDraft =
      effectiveVersion === undefined &&
      project.orgId === scope.orgId &&
      (canEdit || canEditProject(await projectAccessLevel(scope, project)));
    const capabilities = releaseDecision
      ? [releaseDecision]
      : await evaluateNotebookCapabilities(
          scope.orgId,
          document,
          canEdit && effectiveVersion === undefined,
          canRunDraft && project.trashedAt === null,
        );
    let outputVersionId: string | undefined;
    if (effectiveVersion !== undefined) {
      const selected =
        effectiveVersion === "latest"
          ? document.publishedVersionId
          : effectiveVersion;
      if (selected === null)
        fail("That published version is not available.", {
          statusCode: 404,
          errorCode: "project_version_not_found",
        });
      outputVersionId = selected;
    }
    const cellIds = new Set(document.cells.map((cell) => cell.id));
    const outputs = await readAccessibleProjectOutputs(
      scope,
      project.id,
      outputVersionId,
      cellIds,
      context?.caller ?? "unknown",
    );
    const queryStates = canRunDraft
      ? Object.fromEntries(
          Object.entries(await getProjectQueryStates(project.id)).filter(
            ([cellId]) => cellIds.has(cellId),
          ),
        )
      : {};
    const seedScope = { ...scope, ownerEmail: document.ownerEmail };
    const canViewSource =
      surface !== "app" ||
      (project.orgId === scope.orgId &&
        canEditProject(await projectAccessLevel(scope, project)));
    document.cells = document.cells.map((cell) => {
      const result = readSeededSampleCell(seedScope, cell, outputs[cell.id]);
      if (result.output) outputs[cell.id] = result.output;
      if (canViewSource) return result.cell;
      const contents = withoutPendingCellEdit(result.cell.contents);
      return contents.kind === "sql" || contents.kind === "code"
        ? { ...result.cell, contents: { ...contents, source: "" } }
        : result.cell;
    });
    if (!notebook) {
      try {
        await recordProjectView(
          scope,
          project.id,
          scope.ownerEmail,
          surface,
          surface === "app" ? viewId : undefined,
        );
      } catch (error) {
        console.error("Could not record project view", error);
      }
    }
    return {
      project: document,
      notebook: notebook ?? null,
      outputs,
      queryStates,
      canEdit,
      ...(surface === "app" ? { canViewSource } : {}),
      capabilities,
      viewer: { email: scope.ownerEmail, orgId: scope.orgId },
      selectedConnections: await selectedConnectionsPromise,
      importedConnectionIds: await importedConnectionIdsPromise,
    };
  },
});
