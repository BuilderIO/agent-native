import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "dashboard",
  resourceTable: schema.dashboards,
  sharesTable: schema.dashboardShares,
  displayName: "Dashboard",
  titleColumn: "title",
  getResourcePath: (dashboard) => `/dashboards/${dashboard.id}`,
  getDb,
});

registerShareableResource({
  type: "analysis",
  resourceTable: schema.analyses,
  sharesTable: schema.analysisShares,
  displayName: "Analysis",
  titleColumn: "name",
  getResourcePath: (analysis) => `/analyses/${analysis.id}`,
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
