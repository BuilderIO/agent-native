import {
  controlIdSchema,
  type CapabilityDecision,
  type ControlId,
} from "./capabilities.js";

export const ANALYTICS_CONTROL_IDS = {
  createProject: controlIdSchema.parse("create-project"),
  editProject: controlIdSchema.parse("edit-project"),
  createPublishPreview: controlIdSchema.parse("create-project-publish-preview"),
  readPublishPreview: controlIdSchema.parse("get-project-publish-preview"),
  cancelPublishPreview: controlIdSchema.parse("cancel-project-publish-preview"),
  publishProject: controlIdSchema.parse("publish-project"),
  forcePublishProject: controlIdSchema.parse("force-publish-project"),
  queryNotebookTable: controlIdSchema.parse("notebook.queryTable"),
  runDraftSql: controlIdSchema.parse("run-draft-sql"),
  runDraftPython: controlIdSchema.parse("run-draft-python"),
  openPublishedApp: controlIdSchema.parse("open-published-app"),
  manageAppSharing: controlIdSchema.parse("manage-published-app-sharing"),
  readAppSchedules: controlIdSchema.parse("read-published-app-schedules"),
  manageAppSchedules: controlIdSchema.parse("manage-published-app-schedules"),
  stopAppScheduleRun: controlIdSchema.parse("stop-published-app-schedule-run"),
  dataBrowse: controlIdSchema.parse("data-browse"),
  bigQueryConnectionCreate: controlIdSchema.parse("bigquery-connection-create"),
  postgresConnectionCreate: controlIdSchema.parse("postgres-connection-create"),
  projectAppViews: controlIdSchema.parse("projects-column-app-views"),
  projectAppLastPublished: controlIdSchema.parse(
    "projects-column-app-last-published",
  ),
  projectAppLastViewed: controlIdSchema.parse(
    "projects-column-app-last-viewed",
  ),
  projectYourAccess: controlIdSchema.parse("projects-column-your-access"),
  projectSharedWith: controlIdSchema.parse("projects-column-shared-with"),
  unsupportedConnector: controlIdSchema.parse("unsupported-connector"),
  placeholderColumn: controlIdSchema.parse("projects-column-placeholder"),
  generateApp: controlIdSchema.parse("generate-app"),
  writeback: controlIdSchema.parse("writeback"),
  dbtSemanticLayer: controlIdSchema.parse("dbt-semantic-layer"),
  explore: controlIdSchema.parse("explore"),
} as const;

export function capabilityAllowed(
  decisions: readonly CapabilityDecision[] | undefined,
  controlId: ControlId,
): boolean {
  return (
    decisions?.some(
      (decision) =>
        decision.controlId === controlId && decision.status === "allowed",
    ) === true
  );
}
