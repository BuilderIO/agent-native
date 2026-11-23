import { createRequire } from "node:module";

import { fail, isActionContractError } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { getSettingEntry } from "@agent-native/core/settings";
import { ForbiddenError } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  SUPPORTED_TEMPLATE_TYPES,
  WAREHOUSE_TEMPLATES,
} from "../../app/components/data/connection-catalog.js";
import {
  cellContentsSchema,
  type Cell,
  type ProjectDocument,
} from "../../app/lib/model/contracts.js";
import { routeCatalog } from "../../app/routes/routing/registry.js";
import { ANALYTICS_CONTROL_IDS } from "../../shared/analytics-control-ids.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import {
  capabilityDefinitionSchema,
  capabilityScopeRefSchema,
  type CapabilityDecision,
  type CapabilityDefinition,
  type CapabilityPolicy,
  type CapabilityScopeRef,
  type ControlId,
} from "../../shared/capabilities.js";
import { getDb, schema } from "../db/index.js";
import { kernelBuildManifest } from "../execution/kernel-client.js";
import { isPostgresProviderEnabled } from "../execution/postgres-connector.js";
import { isBuiltinSampleConnection } from "../model/data-connection-dto.js";
import {
  defaultDataConnectionId,
  readDataConnection,
} from "../model/data-connections.js";
import { decodeJsonColumn } from "../model/json-column.js";
import {
  getAuthorizedProjectRow,
  getReadableProjectRow,
  resolvePublishedProjectAccess,
} from "../model/project-access.js";
import {
  canEditProject,
  canManageProject,
  projectAccessLevel,
} from "../model/project-grant-access.js";
import { namesSampleTable } from "../model/sample-query.js";
import { seededSqlSource } from "../model/seed.js";
import { getOrganizationBigQueryCredentialReadiness } from "./org-bigquery-credentials.js";
import { readWorkingCell } from "./project-action-access.js";
import {
  currentWorkspaceCapabilities,
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
  workspaceAccess,
} from "./workspace-access.js";

export { ANALYTICS_CONTROL_IDS } from "../../shared/analytics-control-ids.js";

const ids = ANALYTICS_CONTROL_IDS;

function action(actionName: keyof AgentNativeActionRegistry) {
  return { kind: "action", actionName } as const;
}

function projectColumn(controlId: ControlId, ...aliases: string[]) {
  return capabilityDefinitionSchema.parse({
    controlId,
    surfaces: ["projects", "project-column-picker"],
    aliases,
    resourceKind: "workspace",
    target: action("list-projects"),
    prerequisites: ["workspace_permission"],
    postcondition: action("list-projects"),
  });
}

const publishControls = [
  [ids.createPublishPreview, "create-project-publish-preview"],
  [ids.readPublishPreview, "get-project-publish-preview"],
  [ids.cancelPublishPreview, "cancel-project-publish-preview"],
  [ids.publishProject, "publish-project"],
  [ids.forcePublishProject, "publish-project"],
] as const;

const scheduleControls = [
  [
    ids.readAppSchedules,
    "list-published-app-schedules",
    "list-published-app-schedules",
    [],
  ],
  [
    ids.manageAppSchedules,
    "set-published-app-schedule",
    "list-published-app-schedules",
    [
      "list-published-app-schedule-recipients",
      "list-published-app-schedule-runs",
    ],
  ],
  [
    ids.stopAppScheduleRun,
    "stop-published-app-schedule-run",
    "list-published-app-schedule-runs",
    [],
  ],
] as const;

export const analyticsCapabilityDefinitions: readonly CapabilityDefinition[] = [
  capabilityDefinitionSchema.parse({
    controlId: ids.createProject,
    surfaces: ["home", "projects", "workspace-sidebar", "shortcut", "agent"],
    aliases: ["new-project", "create-notebook"],
    resourceKind: "workspace",
    target: action("create-project"),
    prerequisites: ["workspace_permission"],
    postcondition: action("get-project"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.generateApp,
    surfaces: ["home", "agent"],
    aliases: ["generate-an-app"],
    resourceKind: "workspace",
    target: action("create-project"),
    prerequisites: ["workspace_permission"],
    postcondition: action("get-project"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.runDraftSql,
    surfaces: ["notebook", "cell-menu", "shortcut", "agent"],
    aliases: ["run-cell", "run-project-cell"],
    resourceKind: "cell",
    target: action("run-project-cell"),
    prerequisites: [
      "resource_permission",
      "source_permission",
      "provider_ready",
      "worker_ready",
    ],
    postcondition: action("get-project"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.runDraftPython,
    surfaces: ["notebook", "cell-menu", "shortcut", "agent"],
    aliases: [],
    resourceKind: "cell",
    target: action("start-notebook-run"),
    prerequisites: ["resource_permission", "worker_ready"],
    postcondition: action("get-notebook-execution-snapshot"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.editProject,
    surfaces: ["notebook", "app-builder", "shortcut", "agent", "direct-url"],
    aliases: ["open-app-builder"],
    resourceKind: "project",
    target: action("update-project"),
    prerequisites: ["resource_permission"],
    postcondition: action("get-project"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.queryNotebookTable,
    surfaces: ["notebook", "agent"],
    aliases: [],
    resourceKind: "project",
    target: action("query-notebook-table"),
    prerequisites: ["resource_permission"],
    postcondition: action("get-notebook-operation"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.openPublishedApp,
    surfaces: ["notebook", "projects", "library", "direct-url"],
    aliases: ["view-app", "app-latest", "open-published-version"],
    resourceKind: "release",
    target: { kind: "route", routeId: "app" },
    prerequisites: ["resource_permission"],
    postcondition: action("open-published-app-session"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.manageAppSharing,
    surfaces: ["published-app", "agent"],
    aliases: ["list-published-app-access", "find-published-app-colleagues"],
    resourceKind: "project",
    target: { kind: "action", actionName: "set-published-app-access" },
    prerequisites: ["resource_permission"],
    postcondition: { kind: "action", actionName: "list-published-app-access" },
  }),
  ...scheduleControls.map(([controlId, actionName, readback, aliases]) =>
    capabilityDefinitionSchema.parse({
      controlId,
      surfaces: ["published-app", "agent"],
      aliases,
      resourceKind: "project",
      target: { kind: "action", actionName },
      prerequisites: ["resource_permission"],
      postcondition: { kind: "action", actionName: readback },
    }),
  ),
  ...publishControls.map(([controlId, actionName]) =>
    capabilityDefinitionSchema.parse({
      controlId,
      surfaces: ["notebook", "app-builder", "agent"],
      aliases: [],
      resourceKind: "project",
      target: { kind: "action", actionName },
      prerequisites: ["resource_permission"],
      postcondition: {
        kind: "action",
        actionName:
          actionName === "publish-project"
            ? "get-project"
            : "get-project-publish-preview",
      },
    }),
  ),
  capabilityDefinitionSchema.parse({
    controlId: ids.dataBrowse,
    surfaces: ["workspace-sidebar", "notebook", "direct-url"],
    aliases: ["data-browser", "browse-data"],
    resourceKind: "workspace",
    target: { kind: "route", routeId: "data-browser" },
    prerequisites: ["workspace_permission"],
    postcondition: action("get-data-browser-catalog"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.bigQueryConnectionCreate,
    surfaces: ["data-sources", "data-browser", "notebook"],
    aliases: [
      "bigquery",
      "add-bigquery-connection",
      "create-workspace-warehouse-form",
    ],
    resourceKind: "workspace",
    target: action("create-workspace-warehouse-form"),
    prerequisites: ["workspace_permission"],
    postcondition: action("get-workspace-warehouse-connection-operation"),
  }),
  capabilityDefinitionSchema.parse({
    controlId: ids.postgresConnectionCreate,
    surfaces: ["data-sources", "data-browser", "notebook"],
    aliases: ["postgres", "add-postgres-connection"],
    resourceKind: "workspace",
    target: action("create-workspace-warehouse-form"),
    prerequisites: ["workspace_permission", "provider_ready"],
    postcondition: action("get-workspace-warehouse-connection-operation"),
  }),
  projectColumn(ids.projectAppViews, "appViews"),
  projectColumn(
    ids.projectAppLastPublished,
    "dateLastPublished",
    "appLastPublished",
  ),
  projectColumn(
    ids.projectAppLastViewed,
    "datePublishedAppLastViewed",
    "appLastViewed",
  ),
  projectColumn(ids.projectYourAccess, "myAccess"),
  projectColumn(ids.projectSharedWith, "sharedWith"),
];

type Unavailable = Extract<CapabilityDecision, { status: "unavailable" }>;

const unavailableControls = [
  {
    controlId: ids.unsupportedConnector,
    aliases: WAREHOUSE_TEMPLATES.filter(
      ({ type }) =>
        type !== "postgres" && !SUPPORTED_TEMPLATE_TYPES.includes(type),
    ).flatMap(({ type }) => [type, `${type}-connection-create`]),
    resourceKind: "workspace",
    reason: "unsupported",
  },
  {
    controlId: ids.placeholderColumn,
    aliases: [],
    resourceKind: "workspace",
    reason: "unsupported",
  },
  {
    controlId: ids.writeback,
    aliases: ["run-writeback-cell", "allowWriteback"],
    resourceKind: "workspace",
    reason: "missing_backing",
  },
  {
    controlId: ids.dbtSemanticLayer,
    aliases: ["useDbtJdbcDriver"],
    resourceKind: "workspace",
    reason: "unsupported",
  },
  {
    controlId: ids.explore,
    aliases: ["explore-new", "open-exploration"],
    resourceKind: "project",
    reason: "missing_backing",
  },
] as const satisfies readonly {
  controlId: ControlId;
  aliases: readonly string[];
  resourceKind: CapabilityScopeRef["kind"];
  reason: Unavailable["reason"];
}[];

const definitions = new Map(
  analyticsCapabilityDefinitions.flatMap((definition) =>
    [definition.controlId, ...definition.aliases].map((id) => [id, definition]),
  ),
);
const projectColumnControls = new Set([
  ids.projectAppViews,
  ids.projectAppLastPublished,
  ids.projectAppLastViewed,
  ids.projectYourAccess,
  ids.projectSharedWith,
]);
const unavailable = new Map<string, (typeof unavailableControls)[number]>(
  unavailableControls.flatMap((control) =>
    [control.controlId, ...control.aliases].map((id) => [id, control]),
  ),
);
const routes = new Set(
  routeCatalog
    .filter((route) => route.transport === "client" && route.path !== null)
    .map(({ id }) => id),
);

type Workspace = Awaited<ReturnType<typeof requireCurrentWorkspace>>;
type Status = Exclude<CapabilityDecision["status"], "allowed">;
type Refusal = {
  [S in Status]: Pick<
    Extract<CapabilityDecision, { status: S }>,
    "status" | "reason"
  >;
}[Status];

const accessDenied = { status: "denied", reason: "access_denied" } as const;
const sourceDenied = {
  status: "denied",
  reason: "source_access_denied",
} as const;
const missingBacking = {
  status: "unavailable",
  reason: "missing_backing",
} as const;
const notFound = { status: "absent", reason: "not_found" } as const;
const notReady = { status: "pending", reason: "not_ready" } as const;
const readFailed = { status: "unreadable", reason: "read_failed" } as const;
const readinessUnknown = {
  status: "unreadable",
  reason: "readiness_unknown",
} as const;

const dataBrowserSettings = z.object({
  allowNewConnections: z.boolean().optional(),
});
const requireModule = createRequire(import.meta.url);

function sampleWorkerReadiness(): Refusal | null {
  try {
    requireModule.resolve("@electric-sql/pglite");
    return null;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "MODULE_NOT_FOUND"
    )
      return missingBacking;
    return readinessUnknown;
  }
}

const createProjectReads = new WeakMap<Workspace, Promise<Refusal | null>>();

function createProjectRefusal(workspace: Workspace): Promise<Refusal | null> {
  let read = createProjectReads.get(workspace);
  if (!read) {
    read = workspaceAccess
      .assertPermission(["create-project"], {
        userEmail: workspace.ownerEmail,
        orgId: workspace.orgId,
      })
      .then(
        () => null,
        (error: unknown) => {
          if (error instanceof ForbiddenError) return accessDenied;
          throw error;
        },
      );
    createProjectReads.set(workspace, read);
  }
  return read;
}

async function checkWorkspaceControl(
  controlId: ControlId,
  workspace: Workspace,
) {
  if (controlId === ids.createProject || controlId === ids.generateApp)
    return createProjectRefusal(workspace);
  if (controlId === ids.dataBrowse) {
    const capabilities = await currentWorkspaceCapabilities(workspace);
    return capabilities.allows("context-studio") ? null : accessDenied;
  }
  if (
    controlId === ids.bigQueryConnectionCreate ||
    controlId === ids.postgresConnectionCreate
  ) {
    if (!isWorkspaceAdministrator(workspace)) return accessDenied;
    if (
      controlId === ids.postgresConnectionCreate &&
      !isPostgresProviderEnabled()
    )
      return missingBacking;
    const settings = await getSettingEntry(
      `o:${workspace.orgId}:analytics.data.browser`,
      {
        bypassCache: true,
      },
    );
    if (!settings.found) return null;
    const parsed = dataBrowserSettings.safeParse(settings.value);
    if (!parsed.success) return readFailed;
    return parsed.data.allowNewConnections === false ? accessDenied : null;
  }
  return projectColumnControls.has(controlId) ? null : missingBacking;
}

async function checkWarehouseSource(
  connectionId: string,
  workspace: Workspace,
) {
  if (connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    try {
      const readiness = await getOrganizationBigQueryCredentialReadiness({
        orgId: workspace.orgId,
        userEmail: workspace.ownerEmail,
      });
      return readiness === "configured" ? null : notReady;
    } catch (error) {
      if (
        isActionContractError(error) &&
        error.errorCode === "bigquery_credentials_unavailable"
      )
        return readinessUnknown;
      throw error;
    }
  }
  try {
    const connection = await readDataConnection(connectionId);
    if (connection.orgId !== workspace.orgId) return sourceDenied;
    return connection.status === "connected" && connection.config.draft !== true
      ? null
      : notReady;
  } catch (error) {
    if (isActionContractError(error)) {
      if (
        error.errorCode === "data_connection_not_found" ||
        (error.errorCode === "data_connection_unavailable" &&
          error.statusCode === 403)
      )
        return sourceDenied;
      if (
        error.errorCode === "data_connection_unavailable" &&
        error.statusCode === 503
      )
        return readinessUnknown;
    }
    throw error;
  }
}

async function checkDraftSql(
  scope: Extract<CapabilityScopeRef, { kind: "cell" }>,
  workspace: Workspace,
): Promise<Refusal | null> {
  const project = await getAuthorizedProjectRow(workspace, scope.projectId);
  if (project === null) return accessDenied;
  const row = await readWorkingCell(project, scope.cellId);
  const contents = decodeJsonColumn(row.contents, cellContentsSchema);
  if (contents === null) return readFailed;
  return draftSourceCheck(workspace)({ ...row, contents });
}

async function checkDraftPython(
  scope: Extract<CapabilityScopeRef, { kind: "cell" }>,
  workspace: Workspace,
): Promise<Refusal | null> {
  const project = await getAuthorizedProjectRow(workspace, scope.projectId);
  if (project === null) return accessDenied;
  const row = await readWorkingCell(project, scope.cellId);
  const contents = decodeJsonColumn(row.contents, cellContentsSchema);
  return contents === null ? readFailed : draftPythonReadiness(contents);
}

function draftPythonReadiness(contents: Cell["contents"]): Refusal | null {
  if (contents.kind !== "code" || contents.language !== "python")
    return missingBacking;
  return kernelBuildManifest().builds.length === 0 ? notReady : null;
}

type DraftSqlCell = Pick<Cell, "id" | "projectId" | "contents">;

function draftSourceCheck(workspace: Workspace) {
  const sources = new Map<string, Promise<Refusal | null>>();
  let defaultSource: ReturnType<typeof defaultDataConnectionId> | undefined;
  return async (
    cell: DraftSqlCell,
    effectiveConnectionId?: string | null,
  ): Promise<Refusal | null> => {
    const { contents } = cell;
    if (contents.kind !== "sql") return missingBacking;
    if (contents.connectionMode === "dataframes")
      return contents.dataConnectionId === null
        ? sampleWorkerReadiness()
        : readFailed;

    const connectionId =
      effectiveConnectionId === undefined
        ? (contents.dataConnectionId ??
          seededSqlSource(workspace, cell) ??
          (await (defaultSource ??= defaultDataConnectionId())))
        : effectiveConnectionId;
    if (connectionId === null)
      return namesSampleTable(contents.source)
        ? sampleWorkerReadiness()
        : notReady;
    if (isBuiltinSampleConnection(connectionId)) return sampleWorkerReadiness();
    const readiness =
      sources.get(connectionId) ??
      checkWarehouseSource(connectionId, workspace);
    sources.set(connectionId, readiness);
    return readiness;
  };
}

export function evaluatePreparedDraftSqlCapability(
  workspace: Workspace,
  cell: DraftSqlCell,
  connectionId: string | null,
) {
  const scope = capabilityScopeRefSchema.parse({
    kind: "cell",
    workspaceId: workspace.orgId,
    projectId: cell.projectId,
    cellId: cell.id,
  });
  return decide(ids.runDraftSql, scope, workspace, () =>
    draftSourceCheck(workspace)(cell, connectionId),
  );
}

export async function requirePreparedDraftSqlCapability(
  workspace: Workspace,
  cell: DraftSqlCell,
  connectionId: string | null,
) {
  assertAllowed(
    await evaluatePreparedDraftSqlCapability(workspace, cell, connectionId),
  );
}

export async function requirePreparedNotebookSqlSource(
  workspace: Workspace,
  cell: DraftSqlCell,
  connectionId: string | null,
) {
  const refusal = await draftSourceCheck(workspace)(cell, connectionId);
  if (!refusal) return;
  assertAllowed({
    ...refusal,
    controlId: ids.runDraftSql,
    scope: capabilityScopeRefSchema.parse({
      kind: "cell",
      workspaceId: workspace.orgId,
      projectId: cell.projectId,
      cellId: cell.id,
    }),
  });
}

async function checkReleasedApp(
  scope: Extract<CapabilityScopeRef, { kind: "release" }>,
  workspace: Workspace,
): Promise<Refusal | null> {
  const access = await resolvePublishedProjectAccess(
    workspace,
    scope.projectId,
  );
  if (
    !access ||
    (!access.appOnly &&
      (await projectAccessLevel(workspace, access.project)) === null)
  )
    return accessDenied;
  const { project } = access;
  const versionId =
    scope.releaseId === "latest" ? project.publishedVersionId : scope.releaseId;
  if (versionId === null) return missingBacking;
  const [release] = await getDb()
    .select({ id: schema.projectVersions.id })
    .from(schema.projectVersions)
    .where(
      and(
        eq(schema.projectVersions.projectId, project.id),
        eq(schema.projectVersions.id, versionId),
        eq(schema.projectVersions.kind, "published"),
      ),
    )
    .limit(1);
  return release ? null : missingBacking;
}

async function checkDraftPermission(
  projectId: string,
  workspace: Workspace,
  requiresManagement: boolean,
) {
  const project = await getReadableProjectRow(workspace, projectId);
  if (
    !project ||
    project.orgId !== workspace.orgId ||
    project.trashedAt !== null
  )
    return accessDenied;
  const level = await projectAccessLevel(workspace, project);
  return (requiresManagement ? canManageProject(level) : canEditProject(level))
    ? null
    : accessDenied;
}

export async function evaluateDraftRunPermission(
  controlId: ControlId,
  scope: Extract<CapabilityScopeRef, { kind: "project" }>,
): Promise<CapabilityDecision> {
  const workspace = await readWorkspace(scope);
  const scoped = { controlId, scope };
  if ("status" in workspace) return { ...scoped, ...workspace };
  const refusal = await checkDraftPermission(scope.projectId, workspace, false);
  return refusal
    ? { ...scoped, ...refusal }
    : {
        ...scoped,
        status: "allowed",
        target: { kind: "action", actionName: controlId },
      };
}

async function checkCapability(
  definition: CapabilityDefinition,
  scope: CapabilityScopeRef,
  workspace: Workspace,
): Promise<Refusal | null> {
  const { target, postcondition } = definition;
  if (
    (target.kind === "route" && !routes.has(target.routeId)) ||
    (postcondition.kind === "route" && !routes.has(postcondition.routeId))
  )
    return missingBacking;
  switch (scope.kind) {
    case "workspace":
      return checkWorkspaceControl(definition.controlId, workspace);
    case "cell":
      if (definition.controlId === ids.runDraftSql)
        return checkDraftSql(scope, workspace);
      if (definition.controlId === ids.runDraftPython)
        return checkDraftPython(scope, workspace);
      return missingBacking;
    case "release":
      return definition.controlId === ids.openPublishedApp
        ? checkReleasedApp(scope, workspace)
        : missingBacking;
    case "project":
      if (scheduleControls.some(([id]) => id === definition.controlId)) {
        const access = await resolvePublishedProjectAccess(
          workspace,
          scope.projectId,
        );
        if (!access || access.project.orgId !== workspace.orgId)
          return accessDenied;
        if (!access.project.publishedVersionId) return missingBacking;
        if (definition.controlId === ids.readAppSchedules) return null;
        const level = access.appOnly
          ? null
          : await projectAccessLevel(workspace, access.project);
        return canManageProject(level) ? null : accessDenied;
      }
      if (
        definition.controlId === ids.manageAppSharing ||
        definition.controlId === ids.queryNotebookTable ||
        publishControls.some(([id]) => id === definition.controlId)
      )
        return checkDraftPermission(
          scope.projectId,
          workspace,
          definition.controlId === ids.forcePublishProject ||
            definition.controlId === ids.manageAppSharing,
        );
      if (definition.controlId !== ids.editProject) return missingBacking;
      const project = await getAuthorizedProjectRow(workspace, scope.projectId);
      return !project || project.trashedAt !== null ? accessDenied : null;
    case "connection":
      return missingBacking;
  }
}

async function readWorkspace(
  scope: CapabilityScopeRef,
): Promise<Workspace | Refusal> {
  try {
    const current = await requireCurrentWorkspace();
    return current.orgId === scope.workspaceId
      ? current
      : { status: "denied", reason: "wrong_workspace" };
  } catch (error) {
    if (isActionContractError(error) && [401, 403].includes(error.statusCode))
      return accessDenied;
    return readFailed;
  }
}

async function decide(
  controlId: ControlId,
  scope: CapabilityScopeRef,
  workspace: Workspace | Refusal,
  check?: () => Promise<Refusal | null>,
): Promise<CapabilityDecision> {
  const scoped = { controlId, scope };
  if ("status" in workspace) return { ...scoped, ...workspace };
  const definition = definitions.get(controlId);
  if (!definition) {
    const disabled = unavailable.get(controlId);
    if (!disabled)
      return { ...scoped, status: "absent", reason: "unknown_control" };
    if (disabled.resourceKind !== scope.kind) return { ...scoped, ...notFound };
    return { ...scoped, status: "unavailable", reason: disabled.reason };
  }
  if (definition.resourceKind !== scope.kind) return { ...scoped, ...notFound };
  try {
    const refusal = await (check
      ? check()
      : checkCapability(definition, scope, workspace));
    return refusal
      ? { ...scoped, ...refusal }
      : { ...scoped, status: "allowed", target: definition.target };
  } catch (error) {
    if (isActionContractError(error) && error.errorCode === "cell_not_found")
      return { ...scoped, ...notFound };
    return { ...scoped, ...readFailed };
  }
}

export async function evaluateNotebookCapabilities(
  workspaceId: string,
  project: ProjectDocument,
  canEditDraft: boolean,
  canRunDraft: boolean,
): Promise<CapabilityDecision[]> {
  const workspaceScope = capabilityScopeRefSchema.parse({
    kind: "workspace",
    workspaceId,
  });
  const releaseScope = capabilityScopeRefSchema.parse({
    kind: "release",
    workspaceId,
    projectId: project.id,
    releaseId: "latest",
  });
  const projectScope = capabilityScopeRefSchema.parse({
    kind: "project",
    workspaceId,
    projectId: project.id,
  });
  const workspace = await readWorkspace(workspaceScope);
  const checkSource =
    "status" in workspace ? undefined : draftSourceCheck(workspace);
  return Promise.all([
    decide(ids.dataBrowse, workspaceScope, workspace),
    decide(ids.openPublishedApp, releaseScope, workspace),
    decide(ids.editProject, projectScope, workspace, async () =>
      canEditDraft ? null : accessDenied,
    ),
    decide(ids.queryNotebookTable, projectScope, workspace, async () =>
      canEditDraft ? null : accessDenied,
    ),
    ...publishControls.map(([controlId]) =>
      decide(controlId, projectScope, workspace, async () => {
        if ("status" in workspace || !canEditDraft) return accessDenied;
        return checkDraftPermission(
          project.id,
          workspace,
          controlId === ids.forcePublishProject,
        );
      }),
    ),
    ...project.cells
      .filter((cell) => cell.contents.kind === "sql")
      .map((cell) =>
        decide(
          ids.runDraftSql,
          capabilityScopeRefSchema.parse({
            kind: "cell",
            workspaceId,
            projectId: project.id,
            cellId: cell.id,
          }),
          workspace,
          async () =>
            canRunDraft && checkSource ? checkSource(cell) : accessDenied,
        ),
      ),
    ...project.cells
      .filter(
        ({ contents }) =>
          contents.kind === "code" && contents.language === "python",
      )
      .map((cell) =>
        decide(
          ids.runDraftPython,
          capabilityScopeRefSchema.parse({
            kind: "cell",
            workspaceId,
            projectId: project.id,
            cellId: cell.id,
          }),
          workspace,
          async () =>
            canRunDraft ? draftPythonReadiness(cell.contents) : accessDenied,
        ),
      ),
  ]);
}

function decideCapabilities(
  scope: CapabilityScopeRef,
  workspace: Workspace | Refusal,
  controlIds?: readonly ControlId[],
): Promise<CapabilityDecision[]> {
  const requested = controlIds?.length
    ? controlIds
    : [...analyticsCapabilityDefinitions, ...unavailableControls]
        .filter(({ resourceKind }) => resourceKind === scope.kind)
        .map(({ controlId }) => controlId);
  const decisions = new Map<ControlId, Promise<CapabilityDecision>>();
  return Promise.all(
    [...new Set(requested)].map(async (controlId) => {
      const canonicalId =
        definitions.get(controlId)?.controlId ??
        unavailable.get(controlId)?.controlId ??
        controlId;
      const decision =
        decisions.get(canonicalId) ?? decide(canonicalId, scope, workspace);
      decisions.set(canonicalId, decision);
      return { ...(await decision), controlId };
    }),
  );
}

export async function evaluateCapabilities(
  scope: CapabilityScopeRef,
  controlIds?: readonly ControlId[],
): Promise<CapabilityDecision[]> {
  return decideCapabilities(scope, await readWorkspace(scope), controlIds);
}

export function evaluateWorkspaceCapabilities(
  workspace: Workspace,
  controlIds?: readonly ControlId[],
) {
  const scope = capabilityScopeRefSchema.parse({
    kind: "workspace",
    workspaceId: workspace.orgId,
  });
  return decideCapabilities(scope, workspace, controlIds);
}

export const evaluateCapability: CapabilityPolicy["evaluateCapability"] =
  async (controlId, scope) =>
    decide(controlId, scope, await readWorkspace(scope));

const refusalStatus: Record<Status, number> = {
  absent: 404,
  unavailable: 404,
  denied: 403,
  unreadable: 503,
  pending: 409,
};

export const requireCapability: CapabilityPolicy["requireCapability"] = async (
  controlId,
  scope,
) => assertAllowed(await evaluateCapability(controlId, scope));

export async function requireCurrentWorkspaceCapability(controlId: ControlId) {
  const workspace = await requireCurrentWorkspace();
  const scope = capabilityScopeRefSchema.parse({
    kind: "workspace",
    workspaceId: workspace.orgId,
  });
  assertAllowed(await decide(controlId, scope, workspace));
  return workspace;
}

function assertAllowed(decision: CapabilityDecision) {
  if (decision.status === "allowed") return decision;
  const controlId = definitions.get(decision.controlId)?.controlId;
  let message = "Workspace permissions are unavailable.";
  if (decision.status === "denied") {
    if (controlId === ids.createProject)
      message = "Requires analytics-2 permission create-project";
    if (controlId === ids.dataBrowse)
      message =
        "You do not have permission to browse workspace data connections.";
  }
  return fail(message, {
    errorCode: decision.reason,
    statusCode: refusalStatus[decision.status],
    details: { controlId: decision.controlId, status: decision.status },
  });
}
