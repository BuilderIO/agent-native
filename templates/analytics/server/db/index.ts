import { registerDataProgramsShareable } from "@agent-native/core/data-programs";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  ANALYTICS_ANALYSIS_AGENT_CONTEXT_ENDPOINT,
  ANALYTICS_ANALYSIS_AGENT_RESOURCE_KIND,
  ANALYTICS_DASHBOARD_AGENT_CONTEXT_ENDPOINT,
  ANALYTICS_DASHBOARD_AGENT_RESOURCE_KIND,
} from "../../shared/resource-agent-access.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

// Core data-program tables live outside analytics/schema.ts; register the
// sharing type here so get-data-program / resolveAccess work in dev, CLI, and
// extension iframes (same side-effect pattern as dashboard/analysis below).
registerDataProgramsShareable();

registerShareableResource({
  type: "dashboard",
  resourceTable: schema.dashboards,
  sharesTable: schema.dashboardShares,
  displayName: "Dashboard",
  titleColumn: "title",
  getResourcePath: (dashboard) => `/dashboards/${dashboard.id}`,
  agentReadable: {
    resourceKind: ANALYTICS_DASHBOARD_AGENT_RESOURCE_KIND,
    getContextPath: () => ANALYTICS_DASHBOARD_AGENT_CONTEXT_ENDPOINT,
  },
  getDb,
});

registerShareableResource({
  type: "analysis",
  resourceTable: schema.analyses,
  sharesTable: schema.analysisShares,
  displayName: "Analysis",
  titleColumn: "name",
  getResourcePath: (analysis) => `/analyses/${analysis.id}`,
  agentReadable: {
    resourceKind: ANALYTICS_ANALYSIS_AGENT_RESOURCE_KIND,
    getContextPath: () => ANALYTICS_ANALYSIS_AGENT_CONTEXT_ENDPOINT,
  },
  getDb,
});

registerShareableResource({
  type: "session-recording",
  resourceTable: schema.sessionRecordings,
  sharesTable: schema.sessionRecordingShares,
  displayName: "Session recording",
  titleColumn: "sessionId",
  getResourcePath: (recording) => `/sessions/${recording.id}`,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  getDb,
});
