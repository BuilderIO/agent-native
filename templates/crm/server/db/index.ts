import { createDashboardStorage } from "@agent-native/core/dashboard-storage";
import { registerDataProgramsShareable } from "@agent-native/core/data-programs";
import { createGetDb } from "@agent-native/core/db";
import { buildSettingsRoute } from "@agent-native/core/navigation";
import { registerShareableResource } from "@agent-native/core/sharing";

import { crmNavigationPath } from "../../shared/crm-navigation.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

export interface CrmDashboardConfig {
  version: 1;
  panels: Array<{
    id: string;
    title: string;
    source: "program";
    query: string;
    chartType: "metric" | "bar" | "table";
  }>;
}

export const crmDashboardStore = createDashboardStorage<
  "pipeline",
  CrmDashboardConfig
>({
  schema: {
    dashboards: schema.crmDashboards,
    dashboardRevisions: schema.crmDashboardRevisions,
    dashboardShares: schema.crmDashboardShares,
  },
  getDb,
  resourceType: "crm-dashboard",
  displayName: "CRM dashboard",
  validateKind: (kind): kind is "pipeline" => kind === "pipeline",
  getResourcePath: (dashboard) => `/dashboard?id=${dashboard.id}`,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
});

crmDashboardStore.registerShareable();

registerDataProgramsShareable();

const CONNECTIONS_SETTINGS_PATH = buildSettingsRoute("integrations");
const FIELDS_SETTINGS_PATH = crmNavigationPath({
  view: "settings",
  settingsSection: "fields",
});
const INTELLIGENCE_SETTINGS_PATH = crmNavigationPath({
  view: "settings",
  settingsSection: "intelligence",
});

const registrations = [
  [
    "crm-connection",
    schema.crmConnections,
    schema.crmConnectionShares,
    "label",
    CONNECTIONS_SETTINGS_PATH,
  ],
  [
    "crm-object",
    schema.crmObjects,
    schema.crmObjectShares,
    "label",
    FIELDS_SETTINGS_PATH,
  ],
  [
    "crm-field-policy",
    schema.crmFieldPolicies,
    schema.crmFieldPolicyShares,
    "label",
    FIELDS_SETTINGS_PATH,
  ],
  [
    "crm-attribute-option",
    schema.crmAttributeOptions,
    schema.crmAttributeOptionShares,
    "title",
    FIELDS_SETTINGS_PATH,
  ],
  [
    "crm-record",
    schema.crmRecords,
    schema.crmRecordShares,
    "displayName",
    "/records",
  ],
  [
    "crm-record-field",
    schema.crmRecordFields,
    schema.crmRecordFieldShares,
    "fieldName",
    "/records",
  ],
  ["crm-list", schema.crmLists, schema.crmListShares, "name", "/lists"],
  [
    "crm-list-entry",
    schema.crmListEntries,
    schema.crmListEntryShares,
    "id",
    "/lists",
  ],
  [
    "crm-relationship",
    schema.crmRelationships,
    schema.crmRelationshipShares,
    "relationshipType",
    "/records",
  ],
  [
    "crm-interaction",
    schema.crmInteractions,
    schema.crmInteractionShares,
    "title",
    "/records",
  ],
  [
    "crm-call-evidence",
    schema.crmCallEvidence,
    schema.crmCallEvidenceShares,
    "artifactId",
    "/records",
  ],
  [
    "crm-signal-tracker",
    schema.crmSignalTrackers,
    schema.crmSignalTrackerShares,
    "name",
    INTELLIGENCE_SETTINGS_PATH,
  ],
  [
    "crm-signal-run",
    schema.crmSignalRuns,
    schema.crmSignalRunShares,
    "id",
    "/records",
  ],
  [
    "crm-signal",
    schema.crmSignals,
    schema.crmSignalShares,
    "label",
    "/records",
  ],
  ["crm-task", schema.crmTasks, schema.crmTaskShares, "title", "/work"],
  [
    "crm-saved-view",
    schema.crmSavedViews,
    schema.crmSavedViewShares,
    "name",
    "/views",
  ],
  [
    "crm-mutation",
    schema.crmMutations,
    schema.crmMutationShares,
    "id",
    "/proposals",
  ],
  [
    "crm-sync-run",
    schema.crmSyncRuns,
    schema.crmSyncRunShares,
    "id",
    CONNECTIONS_SETTINGS_PATH,
  ],
  [
    "crm-enrichment-run",
    schema.crmEnrichmentRuns,
    schema.crmEnrichmentRunShares,
    "id",
    "/records",
  ],
] as const;

for (const [
  type,
  resourceTable,
  sharesTable,
  titleColumn,
  path,
] of registrations) {
  registerShareableResource({
    type,
    resourceTable,
    sharesTable,
    displayName: type
      .split("-")
      .slice(1)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" "),
    titleColumn,
    getResourcePath: (resource) =>
      type === "crm-record" ? `/records/${resource.id}` : path,
    allowPublic: false,
    requireOrgMemberForUserShares: true,
    getDb,
  });
}
